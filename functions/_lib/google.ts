import { unzipSync } from 'fflate';
import type { Env } from './env';
import { readPdf } from './gemini';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const PDF_LIMIT = 7 * 1024 * 1024;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  size?: string;
  path: string;
}

function parseAccount(env: Env): ServiceAccount {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set.');
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error('Service account JSON is missing fields.');
  return { client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, '\n') };
}

const b64url = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pemToBuffer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

let cached: { token: string; exp: number } | null = null;

/** Signs in as the service account (read-only Drive) and returns an access token. */
export async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const sa = parseAccount(env);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

export const serviceAccountEmail = (env: Env): string => parseAccount(env).client_email;

async function driveGet(token: string, path: string): Promise<Response> {
  return fetch(`${DRIVE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Lists every file under the client's folder (subfolders up to 4 deep). */
export async function listLibrary(env: Env, token: string, rootId: string): Promise<DriveFile[]> {
  const rootCheck = await driveGet(token, `/files/${rootId}?fields=id,name,mimeType&supportsAllDrives=true`);
  if (!rootCheck.ok) {
    throw new Error(
      `Howie cannot see that folder. In Google Drive, share it with ${serviceAccountEmail(env)} as Viewer, then press Sync now.`,
    );
  }
  const out: DriveFile[] = [];
  const walk = async (id: string, path: string, depth: number): Promise<void> => {
    let pageToken = '';
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
      const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size)');
      const res = await driveGet(
        token,
        `/files?q=${q}&fields=${fields}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${
          pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
        }`,
      );
      if (!res.ok) throw new Error(`Drive list failed (${res.status}).`);
      const j = (await res.json()) as {
        nextPageToken?: string;
        files?: Omit<DriveFile, 'path'>[];
      };
      for (const f of j.files ?? []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          if (depth < 4) await walk(f.id, `${path}/${f.name.replace(/\//g, '-')}`, depth + 1);
        } else if (out.length < 2000) {
          out.push({ ...f, path });
        }
      }
      pageToken = j.nextPageToken ?? '';
    } while (pageToken);
  };
  await walk(rootId, 'Knowledge Base', 0);
  return out;
}

async function driveText(token: string, path: string): Promise<string> {
  const res = await driveGet(token, path);
  if (!res.ok) throw new Error(`Drive read failed (${res.status}).`);
  return res.text();
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function docxToText(buf: ArrayBuffer): string {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === 'word/document.xml' });
  const xml = new TextDecoder().decode(files['word/document.xml']);
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Returns the full text of a file, or empty text with a note when it can only be found by name. */
export async function readFileText(
  env: Env,
  token: string,
  f: DriveFile,
): Promise<{ text: string; note?: string }> {
  const m = f.mimeType;
  const id = encodeURIComponent(f.id);

  if (m === 'application/vnd.google-apps.document' || m === 'application/vnd.google-apps.presentation') {
    return { text: await driveText(token, `/files/${id}/export?mimeType=text/plain`) };
  }
  if (m === 'application/vnd.google-apps.spreadsheet') {
    return { text: await driveText(token, `/files/${id}/export?mimeType=text/csv`) };
  }
  if (m === 'application/pdf') {
    if (Number(f.size ?? 0) > PDF_LIMIT) return { text: '', note: 'PDF is over 7 MB. Split it or add a Google Doc version.' };
    const res = await driveGet(token, `/files/${id}?alt=media&supportsAllDrives=true`);
    if (!res.ok) throw new Error(`Drive download failed (${res.status}).`);
    return { text: await readPdf(env, toBase64(await res.arrayBuffer())) };
  }
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const res = await driveGet(token, `/files/${id}?alt=media&supportsAllDrives=true`);
    if (!res.ok) throw new Error(`Drive download failed (${res.status}).`);
    return { text: docxToText(await res.arrayBuffer()) };
  }
  if (m.startsWith('text/') || /\.(txt|md|csv)$/i.test(f.name)) {
    return { text: await driveText(token, `/files/${id}?alt=media&supportsAllDrives=true`) };
  }
  return { text: '', note: 'This file type is found by name only.' };
}
