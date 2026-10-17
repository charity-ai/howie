import { json, type Env } from '../_lib/env';
import { bearer, getUser } from '../_lib/supabase';
import { fetchForViewer, getAccessToken, viewableAsPdf } from '../_lib/google';

interface DocRow {
  name: string | null;
  mime: string | null;
  status: string;
}

/**
 * GET /api/kb-file?id=<Drive file ID>
 * Streams one library document to a signed-in user for the document panel, using Howie's
 * service account, so the Drive folder never has to be shared with board members.
 * Only files that are in this client's library (kb_documents) can be fetched.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = bearer(request);
  if (!token) return json({ error: 'sign_in', message: 'Please sign in.' }, 401);
  const user = await getUser(env, token);
  if (!user) return json({ error: 'sign_in', message: 'Please sign in again.' }, 401);

  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return json({ error: 'bad_request' }, 400);

  // must be a live document in this client's library (read as the user, so row security applies)
  const res = await fetch(
    `${env.VITE_SUPABASE_URL}/rest/v1/kb_documents?select=name,mime,status&file_id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return json({ error: 'failed', message: 'Could not check the library.' }, 502);
  const doc = ((await res.json()) as DocRow[])[0];
  if (!doc || doc.status === 'removed') {
    return json({ error: 'not_found', message: 'That document is no longer in the library.' }, 404);
  }

  const mime = doc.mime ?? 'application/octet-stream';
  const asPdf = viewableAsPdf(mime);
  try {
    const gToken = await getAccessToken(env);
    const file = await fetchForViewer(gToken, id, mime);
    if (!file.ok || !file.body) {
      return json({ error: 'failed', message: `Google Drive would not send the file (${file.status}).` }, 502);
    }
    let name = (doc.name ?? 'document').replace(/[\r\n"]/g, '');
    if (asPdf && !/\.pdf$/i.test(name)) name += '.pdf';
    return new Response(file.body, {
      headers: {
        'content-type': asPdf ? 'application/pdf' : mime,
        'content-disposition': `${asPdf ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    return json({ error: 'failed', message: e instanceof Error ? e.message : 'Could not open the document.' }, 502);
  }
};
