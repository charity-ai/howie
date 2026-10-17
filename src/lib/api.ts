import { supabase } from './supabase';

export interface Source {
  title: string;
  url: string | null;
  category: string;
  directions: string;
  file_id: string;
  mime: string;
  /** PDF page the passage starts on, when known */
  page: number | null;
  /** the passage Howie used */
  quote: string;
}

/** Can the document panel show this file inline? (PDFs, and Google Docs/Slides/Sheets as PDF) */
export const viewable = (mime: string): boolean =>
  mime === 'application/pdf' ||
  mime === 'application/vnd.google-apps.document' ||
  mime === 'application/vnd.google-apps.presentation' ||
  mime === 'application/vnd.google-apps.spreadsheet';

/** Downloads a library document through the signed-in site (the Drive folder stays private). */
export async function fetchDocument(fileId: string, signal?: AbortSignal): Promise<Blob> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in again.');
  const res = await fetch(`/api/kb-file?id=${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(j.message || `Error ${res.status}`);
  }
  return res.blob();
}

export interface AskResult {
  answer: string;
  sources: Source[];
  answered: boolean;
}

export async function api<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in again.');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) throw new Error(j.message || j.error || `Error ${res.status}`);
  return j as T;
}

/** Accepts a bare Drive folder ID or a full folder address; returns the ID or null. */
export function extractFolderId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/folders\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(s) ? s : null;
}
