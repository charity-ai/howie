-- ════════════════════════════════════════════════════════════════════════
-- HOWIE · DATABASE (one Supabase project per client)
-- Supabase → SQL Editor → New query → paste → Run.  Safe to run twice.
--
-- Creates: members + roles, settings, the document library (pgvector),
-- the question log, every function the web app and the sync worker call,
-- the sync secret (generated inside the vault, never shown), and the
-- weekly sync schedule (Mondays 13:00 UTC).
--
-- BEFORE RUNNING: replace  YOUR-SITE.pages.dev  (1 place, in kb_cron_sync
-- near the bottom) with the client's real site address, e.g.
-- oakhollow.howie.charitylovesai.com . No https:// , no trailing slash.
-- If you run it before the site exists, run it again after Phase 6.
--
-- AFTER RUNNING: you should see "Success. No rows returned".
-- Check:  select jobname, schedule from cron.job;   → kb-weekly-sync · 0 13 * * 1
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto  with schema extensions;
create extension if not exists vector    with schema extensions;
create extension if not exists pg_net    with schema extensions;
create extension if not exists pg_cron;

-- ── 1 · members ─────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       text not null default 'member' check (role in ('member', 'admin')),
  lang       text not null default 'en'     check (lang in ('en', 'es')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select role = 'admin' from profiles where id = (select auth.uid())), false)
$$;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

-- every new user (invited or signed up) gets a profile with role 'member'
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.profiles (id, full_name, lang)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data->>'lang' = 'es' then 'es' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2 · settings (the Drive folder ID, the ElevenLabs agent ID) ──────────
create table if not exists public.settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz default now()
);
alter table public.settings enable row level security;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);

insert into public.settings (key, value)
values ('kb_drive_folder', 'null'::jsonb), ('voice_agent_id', 'null'::jsonb)
on conflict (key) do nothing;

create or replace function public.update_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_key not in ('kb_drive_folder', 'voice_agent_id') then raise exception 'unknown setting'; end if;
  insert into settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ── 3 · the library ─────────────────────────────────────────────────────
create table if not exists public.kb_documents (
  id                uuid primary key default gen_random_uuid(),
  file_id           text unique not null,
  name              text,
  mime              text,
  folder_path       text default 'Knowledge Base',
  share_url         text,
  route             text,
  drive_modified_at timestamptz,
  last_ingested_at  timestamptz,
  chunk_count       int default 0,
  status            text not null default 'pending'
                    check (status in ('pending', 'ready', 'card_only', 'error', 'removed')),
  error             text,
  content_hash      text,
  created_at        timestamptz not null default now()
);

create table if not exists public.kb_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  kind        text not null default 'doc' check (kind in ('card', 'doc', 'platform', 'guide')),
  seq         int  not null default 0,
  text        text not null,
  embedding   extensions.vector(768) not null
);
-- page the passage starts on (PDFs only; added for the document panel; safe on older installs)
alter table public.kb_chunks add column if not exists page int;
create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists kb_chunks_document_idx on public.kb_chunks (document_id);

create table if not exists public.kb_queries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  query      text not null,
  channel    text default 'text',
  answered   boolean,
  top_title  text,
  top_url    text,
  score      numeric,
  created_at timestamptz not null default now()
);

alter table public.kb_documents enable row level security;
alter table public.kb_chunks    enable row level security;
alter table public.kb_queries   enable row level security;

drop policy if exists kb_docs_read on public.kb_documents;
create policy kb_docs_read on public.kb_documents for select to authenticated using (true);

drop policy if exists kb_queries_admin_read on public.kb_queries;
create policy kb_queries_admin_read on public.kb_queries for select to authenticated
  using ((select public.is_admin()));

-- kb_chunks has no read policy on purpose: the browser never reads vectors;
-- kb_match (below) does, on the user's behalf.

-- the sync secret — generated here inside the vault, never typed, never shown
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'kb_sync_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'), 'kb_sync_secret', 'Howie library sync');
  end if;
end $$;

-- may the caller write to the library?  an admin, or the sync worker with the secret
create or replace function public.kb_write_allowed(p_secret text) returns boolean
language plpgsql stable security definer set search_path to 'public', 'vault' as $$
declare v text;
begin
  if is_admin() then return true; end if;
  if p_secret is null or p_secret = '' then return false; end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = 'kb_sync_secret';
  return v is not null and p_secret = v;
end $$;

-- what the sync worker needs to know: folder ID + what is already stored
create or replace function public.kb_config(p_secret text default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not kb_write_allowed(p_secret) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'folder_id', (select value #>> '{}' from settings where key = 'kb_drive_folder'),
    'docs', (select coalesce(jsonb_agg(jsonb_build_object(
                'file_id', file_id, 'drive_modified_at', drive_modified_at,
                'status', status, 'error', error)), '[]'::jsonb)
             from kb_documents where status <> 'removed'));
end $$;

-- save one document and all of its passages (replaces the old passages)
create or replace function public.kb_upsert_document(p_secret text, p_doc jsonb, p_chunks jsonb)
returns uuid
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_id uuid; c jsonb; v_seq int = 0;
begin
  if not kb_write_allowed(p_secret) then raise exception 'not allowed'; end if;

  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    -- a failed re-read keeps the passages it already had
    update kb_documents set
      name = p_doc->>'name', mime = p_doc->>'mime',
      folder_path = coalesce(p_doc->>'folder_path', 'Knowledge Base'),
      share_url = p_doc->>'share_url', route = nullif(p_doc->>'route', ''),
      status = coalesce(p_doc->>'status', 'error'), error = p_doc->>'error',
      last_ingested_at = now()
    where file_id = p_doc->>'file_id'
    returning id into v_id;
    return v_id;
  end if;

  insert into kb_documents (file_id, name, mime, folder_path, share_url, drive_modified_at,
                            last_ingested_at, chunk_count, status, error, content_hash, route)
  values (p_doc->>'file_id', p_doc->>'name', p_doc->>'mime',
          coalesce(p_doc->>'folder_path', 'Knowledge Base'), p_doc->>'share_url',
          nullif(p_doc->>'drive_modified_at', '')::timestamptz, now(),
          jsonb_array_length(p_chunks),
          coalesce(p_doc->>'status', 'ready'), p_doc->>'error', p_doc->>'content_hash',
          nullif(p_doc->>'route', ''))
  on conflict (file_id) do update set
    name = excluded.name, mime = excluded.mime, folder_path = excluded.folder_path,
    share_url = excluded.share_url, drive_modified_at = excluded.drive_modified_at,
    last_ingested_at = now(), chunk_count = excluded.chunk_count, status = excluded.status,
    error = excluded.error, content_hash = excluded.content_hash, route = excluded.route
  returning id into v_id;

  delete from kb_chunks where document_id = v_id;

  for c in select * from jsonb_array_elements(p_chunks) loop
    insert into kb_chunks (document_id, kind, seq, text, page, embedding)
    values (
      v_id,
      coalesce(c->>'kind', 'doc'),
      v_seq,
      c->>'text',
      nullif(c->>'page', '')::int,
      (select ('[' || string_agg(e::text, ',') || ']')::extensions.vector(768)
         from jsonb_array_elements_text(c->'embedding') e)
    );
    v_seq = v_seq + 1;
  end loop;

  return v_id;
end $$;

-- after a full sync: anything no longer in the folder drops out of answers
create or replace function public.kb_mark_removed(p_secret text, p_seen jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not kb_write_allowed(p_secret) then raise exception 'not allowed'; end if;
  with gone as (
    update kb_documents set status = 'removed', chunk_count = 0
    where status <> 'removed'
      and file_id not like 'platform:%' and file_id not like 'guide:%'
      and not (file_id in (select jsonb_array_elements_text(p_seen)))
    returning id),
  purged as (
    delete from kb_chunks where document_id in (select id from gone))
  select count(*) into n from gone;
  return n;
end $$;

-- the search: the question's vector in, the closest passages out (signed-in users only)
-- (dropped first because its columns changed when page was added)
drop function if exists public.kb_match(jsonb, int, text);
create function public.kb_match(p_query jsonb, p_k int default 8, p_lang text default 'en')
returns table(title text, url text, category text, directions text, snippet text, passage text,
              kind text, mime text, file_id text, score double precision, route text, page int)
language sql stable security definer set search_path to 'public', 'extensions' as $$
  with q as (
    select ('[' || string_agg(e::text, ',') || ']')::extensions.vector(768) as v
    from jsonb_array_elements_text(p_query) e)
  select d.name,
         d.share_url,
         coalesce(nullif(btrim(split_part(d.folder_path, '/', 2)), ''), 'Knowledge Base'),
         'Open ' || d.folder_path || ' and select ' || d.name || '.',
         left(c.text, 220),
         left(c.text, 4000),
         c.kind, d.mime, d.file_id,
         1 - (c.embedding <=> (select v from q)),
         d.route,
         c.page
  from kb_chunks c join kb_documents d on d.id = c.document_id
  where (select auth.uid()) is not null and d.status <> 'removed'
  order by c.embedding <=> (select v from q)
  limit greatest(1, least(p_k, 12))
$$;

-- the document list (for "what documents do you have?")
create or replace function public.kb_catalog() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select case when auth.uid() is null then '[]'::jsonb else coalesce(jsonb_agg(
           jsonb_build_object('name', d.name, 'folder', d.folder_path,
                              'status', d.status, 'url', d.share_url)
           order by d.folder_path, d.name), '[]'::jsonb) end
  from kb_documents d where d.status <> 'removed'
$$;

-- the question log (feeds the admin "Unanswered" list)
create or replace function public.kb_log_query(
  p_query text, p_channel text, p_answered boolean,
  p_top_title text default null, p_top_url text default null, p_score numeric default null)
returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into kb_queries (user_id, query, channel, answered, top_title, top_url, score)
  values (auth.uid(), left(p_query, 500), coalesce(p_channel, 'text'), p_answered,
          p_top_title, p_top_url, p_score);
end $$;

-- ── 4 · who may call what ───────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon;

grant execute on function
  public.is_admin(),
  public.kb_match(jsonb, int, text),
  public.kb_catalog(),
  public.kb_log_query(text, text, boolean, text, text, numeric),
  public.update_setting(text, jsonb)
to authenticated;

-- the sync worker calls these with the public key + the secret; each refuses without the secret
grant execute on function
  public.kb_write_allowed(text),
  public.kb_config(text),
  public.kb_upsert_document(text, jsonb, jsonb),
  public.kb_mark_removed(text, jsonb)
to anon, authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;

-- ── 5 · the weekly sync (Mondays 13:00 UTC) ─────────────────────────────
-- ► REPLACE  YOUR-SITE.pages.dev  below with the client's site address
create or replace function public.kb_cron_sync() returns void
language plpgsql security definer set search_path to 'public', 'vault' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'kb_sync_secret';
  if v is null then return; end if;
  perform net.http_post(
    url     := 'https://YOUR-SITE.pages.dev/api/kb-ingest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-KB-Secret', v),
    body    := '{"source":"cron","hop":0}'::jsonb,
    timeout_milliseconds := 25000);
end $$;
revoke execute on function public.kb_cron_sync() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kb-weekly-sync';
select cron.schedule('kb-weekly-sync', '0 13 * * 1', $$select public.kb_cron_sync();$$);

-- ════════════════════════════════════════════════════════════════════════
-- MAKE THE CLIENT'S FIRST ADMIN  (run separately, AFTER they have an account)
-- Replace the email, then run just these lines:
--
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'admin@clientdomain.com');
--
-- INVITE-ONLY: after the first admin exists, turn OFF
-- Authentication → Sign In / Providers → "Allow new users to sign up",
-- then add people with Authentication → Users → Invite user.
-- ════════════════════════════════════════════════════════════════════════
