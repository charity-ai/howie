import { supabase } from './supabase';

export interface Source {
  title: string;
  url: string | null;
  category: string;
  directions: string;
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
