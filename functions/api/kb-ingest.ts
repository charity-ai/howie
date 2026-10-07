import { extractFolderId, json, type Env } from '../_lib/env';
import { bearer, rpc } from '../_lib/supabase';
import { getAccessToken, listLibrary, readFileText, type DriveFile } from '../_lib/google';
import { embed } from '../_lib/gemini';
import { chunkText } from '../_lib/chunk';

const MAX_HOPS = 60;

interface KnownDoc {
  file_id: string;
  drive_modified_at: string | null;
  status: string;
  error: string | null;
}
interface Config {
  folder_id: string | null;
  docs: KnownDoc[];
}

/**
 * One document per call, then the function calls itself for the next one (up to 60 times).
 * Callable two ways: the weekly database schedule (X-KB-Secret header) or a signed-in admin (Sync now).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const secret = request.headers.get('X-KB-Secret') || '';
  const token = bearer(request);
  if (!secret && !token) return json({ error: 'unauthorized' }, 401);

  let cfg: Config;
  try {
    cfg = await rpc<Config>(env, 'kb_config', { p_secret: secret }, secret ? null : token);
  } catch {
    return json({ error: 'forbidden', message: 'Only an admin can sync the library.' }, 403);
  }

  let body: { hop?: number; done?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  const hop = Number(body.hop ?? 0);
  const done = Array.isArray(body.done) ? body.done.map(String).slice(0, MAX_HOPS) : [];
  if (hop >= MAX_HOPS) return json({ finished: false, message: 'Hop limit reached. Press Sync now to continue.' });

  const folderId = extractFolderId(cfg.folder_id);
  if (!folderId) return json({ error: 'no_folder', message: 'Set the library folder first.' }, 400);

  try {
    const gToken = await getAccessToken(env);
    const files = await listLibrary(env, gToken, folderId);

    // an empty listing with documents already stored almost always means sharing broke: do not wipe the library
    if (files.length === 0 && cfg.docs.length > 0) {
      return json({ error: 'empty_folder', message: 'The folder looks empty. Check that it is still shared with Howie.' }, 409);
    }

    const known = new Map(cfg.docs.map((d) => [d.file_id, d]));
    const modifiedDiffers = (f: DriveFile, k: KnownDoc) =>
      !k.drive_modified_at || new Date(k.drive_modified_at).getTime() !== new Date(f.modifiedTime).getTime();

    // priority: retry errors, then new files, then changed files, then anything still pending
    const todo = files
      .filter((f) => !done.includes(f.id))
      .map((f) => {
        const k = known.get(f.id);
        let p: number | null = null;
        if (!k) p = 1;
        else if (k.status === 'error') p = 0;
        else if (modifiedDiffers(f, k)) p = 2;
        else if (k.status === 'pending') p = 3;
        return { f, p };
      })
      .filter((x): x is { f: DriveFile; p: number } => x.p !== null)
      .sort((a, b) => a.p - b.p);

    if (todo.length === 0) {
      const removed = await rpc<number>(
        env,
        'kb_mark_removed',
        { p_secret: secret, p_seen: files.map((f) => f.id) },
        secret ? null : token,
      );
      return json({ finished: true, total: files.length, removed });
    }

    const file = todo[0].f;
    const existed = known.has(file.id);
    let status: 'ready' | 'card_only' | 'error' = 'ready';
    let error: string | null = null;
    let chunks: { kind: string; text: string; embedding: number[] }[] | null = [];

    try {
      const r = await readFileText(env, gToken, file);
      const pieces: { kind: 'card' | 'doc'; text: string }[] = [
        { kind: 'card', text: `Document: ${file.name}. Folder: ${file.path}.` },
      ];
      if (r.text.trim()) {
        for (const t of chunkText(r.text)) pieces.push({ kind: 'doc', text: t });
      } else {
        status = 'card_only';
        error = r.note ?? 'No readable text found.';
      }
      const vectors = await embed(
        env,
        pieces.map((p) => (p.kind === 'card' ? p.text : `${file.name}\n${p.text}`)),
        'RETRIEVAL_DOCUMENT',
      );
      chunks = pieces.map((p, i) => ({ kind: p.kind, text: p.text, embedding: vectors[i] }));
    } catch (e) {
      status = 'error';
      error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      chunks = existed ? null : []; // keep old passages if the document was already stored
    }

    await rpc(
      env,
      'kb_upsert_document',
      {
        p_secret: secret,
        p_doc: {
          file_id: file.id,
          name: file.name,
          mime: file.mimeType,
          folder_path: file.path,
          share_url: file.webViewLink ?? null,
          drive_modified_at: file.modifiedTime,
          status,
          error,
        },
        p_chunks: chunks,
      },
      secret ? null : token,
    );

    // chain to the next document
    if (todo.length > 1 && hop + 1 < MAX_HOPS) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (secret) headers['X-KB-Secret'] = secret;
      if (token) headers['Authorization'] = `Bearer ${token}`;
      waitUntil(
        fetch(`${new URL(request.url).origin}/api/kb-ingest`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ hop: hop + 1, done: [...done, file.id] }),
        }).catch(() => undefined),
      );
    }

    return json({ hop, processed: file.name, status, remaining: todo.length - 1 });
  } catch (e) {
    return json({ error: 'failed', message: e instanceof Error ? e.message : 'Sync failed.' }, 502);
  }
};
