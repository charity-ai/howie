import type { Env } from './env';

export function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Call a Postgres function through Supabase's REST API. token = the signed-in user's access token. */
export async function rpc<T = unknown>(
  env: Env,
  fn: string,
  args: Record<string, unknown>,
  token: string | null,
): Promise<T> {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token ?? env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Confirms the token belongs to a real signed-in user. */
export async function getUser(env: Env, token: string): Promise<{ id: string } | null> {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const u = (await res.json()) as { id?: string };
  return u.id ? { id: u.id } : null;
}
