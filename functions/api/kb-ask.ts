import { json, type Env } from '../_lib/env';
import { bearer, getUser, rpc } from '../_lib/supabase';
import { embed, generate } from '../_lib/gemini';

interface MatchRow {
  title: string;
  url: string | null;
  category: string;
  directions: string;
  snippet: string;
  passage: string;
  kind: string;
  mime: string;
  file_id: string;
  score: number;
  route: string | null;
}

interface CatalogRow {
  name: string;
  folder: string;
  status: string;
  url: string | null;
}

const ANSWERED_ABOVE = 0.35;
const PASSAGE_CHAR_CAP = 14000;
const INDEX_CHAR_CAP = 6000;

const rules = (company: string, lang: 'en' | 'es') =>
  `You are Howie, the document assistant for ${company}. Answer in 1-4 plain, direct sentences. ${
    lang === 'es'
      ? 'Reply in Spanish (informal tú); translate faithfully; document titles stay as written.'
      : 'Reply in English.'
  } Hard rules:
1. Facts, numbers, and policy come ONLY from the PASSAGES. Never invent or use outside knowledge.
2. Quote every number, dollar amount, percentage, and date EXACTLY as written — never round, estimate, or infer one. If the exact figure is not in the passages, say which document to open.
3. Name the source document in your answer (for example: "per the Rules and Regulations...").
4. Questions about which documents exist, their titles, or where they live: answer from the LIBRARY INDEX — it is the complete, authoritative list.
5. If two passages disagree, say which document says what.
6. If neither the passages nor the index answers it, say so in one sentence and name the closest document.
7. Never give legal advice. For legal questions, point to the governing document and suggest asking the board or an attorney.`;

// GET = keep-warm ping from the voice component (no data returned)
export const onRequestGet: PagesFunction<Env> = async () => json({ ok: true });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GEMINI_API_KEY || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return json({ error: 'not_configured', message: "Howie isn't switched on yet. An admin needs to finish setup." }, 503);
  }
  const token = bearer(request);
  if (!token) return json({ error: 'sign_in', message: 'Please sign in.' }, 401);
  const user = await getUser(env, token);
  if (!user) return json({ error: 'sign_in', message: 'Please sign in again.' }, 401);

  let body: { query?: unknown; lang?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const query = String(body.query ?? '').trim().slice(0, 500);
  if (!query) return json({ error: 'bad_request', message: 'Type a question.' }, 400);
  const lang: 'en' | 'es' = body.lang === 'es' ? 'es' : 'en';
  const mode = body.mode === 'passages' ? 'passages' : 'answer';
  const channel = mode === 'passages' ? 'voice' : 'text';

  try {
    const [qv] = await embed(env, [query], 'RETRIEVAL_QUERY');
    const rows = (await rpc<MatchRow[]>(env, 'kb_match', { p_query: qv, p_k: 8, p_lang: lang }, token)) ?? [];

    const top = rows[0];
    const score = top?.score ?? 0;
    const answered = score > ANSWERED_ABOVE;

    // passages, capped
    const blocks: string[] = [];
    let used = 0;
    rows.forEach((r, i) => {
      const b = `[${i + 1}] ${r.title} (${r.category})\n${r.passage}`;
      if (used + b.length <= PASSAGE_CHAR_CAP) {
        blocks.push(b);
        used += b.length;
      }
    });

    // up to 3 distinct documents to link
    const seen = new Set<string>();
    const sources: { title: string; url: string | null; category: string; directions: string }[] = [];
    if (answered) {
      for (const r of rows) {
        if (seen.has(r.file_id)) continue;
        seen.add(r.file_id);
        sources.push({ title: r.title, url: r.url, category: r.category, directions: r.directions });
        if (sources.length === 3) break;
      }
    }

    // log it (feeds the admin "Unanswered" list); never block the answer on this
    rpc(env, 'kb_log_query', {
      p_query: query,
      p_channel: channel,
      p_answered: answered,
      p_top_title: top?.title ?? null,
      p_top_url: top?.url ?? null,
      p_score: score,
    }, token).catch(() => undefined);

    if (mode === 'passages') {
      return json({
        document_content: blocks.length ? blocks.join('\n\n---\n\n') : 'NO PASSAGES FOUND',
        how_to_answer:
          'Answer ONLY from document_content in 1 to 3 short spoken sentences. Say numbers, dollar amounts, percentages and dates exactly as written. If the answer is not there, say so in one sentence and name the closest document.',
        link_shown_on_screen: answered && sources.length > 0,
        sources,
      });
    }

    const catalog = (await rpc<CatalogRow[]>(env, 'kb_catalog', {}, token)) ?? [];
    let index = '';
    for (const d of catalog) {
      const line = `- ${d.name} (${d.folder})\n`;
      if (index.length + line.length > INDEX_CHAR_CAP) break;
      index += line;
    }

    const company = env.COMPANY_NAME || 'your association';
    const prompt = `LIBRARY INDEX:\n${index || '(empty)'}\n\nPASSAGES:\n${
      blocks.length ? blocks.join('\n\n') : '(none found)'
    }\n\nQUESTION: ${query}`;
    const answer = await generate(env, rules(company, lang), prompt);

    return json({ answer, sources, answered, score });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Something went wrong.';
    return json({ error: 'failed', message }, 502);
  }
};
