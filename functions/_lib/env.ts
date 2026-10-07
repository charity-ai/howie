export interface Env {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_ANSWER_MODEL?: string;
  GEMINI_READER_MODEL?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  COMPANY_NAME?: string;
}

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** Accepts a bare folder ID or a full Drive folder address; returns the ID or null. */
export function extractFolderId(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/folders\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(s) ? s : null;
}
