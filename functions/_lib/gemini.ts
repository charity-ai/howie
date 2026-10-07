import type { Env } from './env';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIMS = 768;

export const answerModel = (env: Env) => env.GEMINI_ANSWER_MODEL || 'gemini-3.6-flash';
export const readerModel = (env: Env) => env.GEMINI_READER_MODEL || answerModel(env);

async function gpost<T>(env: Env, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 404) {
      throw new Error(
        `Gemini model not found (${path.split(':')[0]}). Check GEMINI_ANSWER_MODEL against ai.google.dev/gemini-api/docs/models.`,
      );
    }
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

/** Text → 768-number vectors (normalized). Batches of 100. */
export async function embed(
  env: Env,
  texts: string[],
  taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT',
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const r = await gpost<{ embeddings: { values: number[] }[] }>(
      env,
      `/models/${EMBED_MODEL}:batchEmbedContents`,
      {
        requests: batch.map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: EMBED_DIMS,
        })),
      },
    );
    for (const e of r.embeddings) out.push(normalize(e.values));
  }
  return out;
}

interface GenResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export async function generate(env: Env, system: string, user: string): Promise<string> {
  const r = await gpost<GenResponse>(env, `/models/${answerModel(env)}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2500 },
  });
  const text = (r.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty answer.');
  return text;
}

/** Reads every word out of a PDF (scanned pages too). */
export async function readPdf(env: Env, base64: string): Promise<string> {
  const r = await gpost<GenResponse>(env, `/models/${readerModel(env)}:generateContent`, {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: base64 } },
          {
            text: 'Transcribe all the text in this document exactly as written. Keep numbers, dollar amounts, percentages and dates exactly. Write tables as plain text rows. Do not summarize or add commentary. Output the text only.',
          },
        ],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 60000 },
  });
  return (r.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
}
