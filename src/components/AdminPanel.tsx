import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api, extractFolderId } from '../lib/api';
import type { T } from '../lib/i18n';

interface Doc {
  name: string;
  folder_path: string;
  status: string;
  error: string | null;
}
interface Unanswered {
  query: string;
  channel: string;
  created_at: string;
}

export default function AdminPanel({ t }: { t: T }) {
  const [folder, setFolder] = useState('');
  const [agent, setAgent] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [unanswered, setUnanswered] = useState<Unanswered[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [syncing, setSyncing] = useState(false);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [s, d, u] = await Promise.all([
      supabase.from('settings').select('key,value'),
      supabase
        .from('kb_documents')
        .select('name,folder_path,status,error')
        .neq('status', 'removed')
        .order('folder_path')
        .order('name'),
      supabase
        .from('kb_queries')
        .select('query,channel,created_at')
        .eq('answered', false)
        .order('created_at', { ascending: false })
        .limit(25),
    ]);
    const rows = (s.data ?? []) as { key: string; value: unknown }[];
    const f = rows.find((r) => r.key === 'kb_drive_folder')?.value;
    const a = rows.find((r) => r.key === 'voice_agent_id')?.value;
    setFolder((cur) => (cur ? cur : typeof f === 'string' ? f : ''));
    setAgent((cur) => (cur ? cur : typeof a === 'string' ? a : ''));
    setDocs((d.data ?? []) as Doc[]);
    setUnanswered((u.data ?? []) as Unanswered[]);
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [refresh]);

  async function saveSetting(key: 'kb_drive_folder' | 'voice_agent_id', value: string) {
    setMsg('');
    setErr('');
    const { error } = await supabase.rpc('update_setting', { p_key: key, p_value: value });
    if (error) setErr(error.message);
    else setMsg(t('saved'));
  }

  async function saveFolder() {
    const id = extractFolderId(folder);
    if (!id) {
      setErr(t('badFolder'));
      return;
    }
    setFolder(id);
    await saveSetting('kb_drive_folder', id);
  }

  async function saveAgent() {
    const v = agent.trim();
    if (!v.startsWith('agent_')) {
      setErr(t('badAgent'));
      return;
    }
    await saveSetting('voice_agent_id', v);
  }

  async function syncNow() {
    setErr('');
    setMsg('');
    setSyncing(true);
    try {
      await api('/api/kb-ingest', { hop: 0, source: 'manual' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
      setSyncing(false);
      return;
    }
    // watch statuses move for up to 5 minutes
    let ticks = 0;
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      ticks += 1;
      refresh();
      if (ticks >= 60 && timer.current) {
        window.clearInterval(timer.current);
        setSyncing(false);
      }
    }, 5000);
  }

  return (
    <section className="card">
      <h2>{t('admin')}</h2>

      <label className="stack">
        {t('libraryFolder')}
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="1AbCdEfGh…" />
        <span className="muted small">{t('folderHelp')}</span>
      </label>
      <button className="secondary" onClick={saveFolder} type="button">{t('save')}</button>

      <label className="stack">
        {t('voiceAgentId')}
        <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="agent_…" autoComplete="off" />
        <span className="muted small">{t('voiceHelp')}</span>
      </label>
      <button className="secondary" onClick={saveAgent} type="button">{t('save')}</button>

      {msg && <p className="ok" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}

      <div className="row between wrap">
        <button className="primary" onClick={syncNow} disabled={syncing} type="button">{t('syncNow')}</button>
        <button className="link" onClick={refresh} type="button">{t('refresh')}</button>
      </div>
      {syncing && <p className="muted small">{t('syncing')}</p>}

      <h3>{t('library')} ({docs.length})</h3>
      {docs.length === 0 ? (
        <p className="muted">{t('noDocs')}</p>
      ) : (
        <ul className="docs">
          {docs.map((d) => (
            <li key={d.folder_path + d.name}>
              <span className={`pill ${d.status}`}>{d.status}</span> {d.name}
              <div className="muted small">
                {d.folder_path}
                {d.error ? ` · ${d.error}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>{t('unanswered')}</h3>
      {unanswered.length === 0 ? (
        <p className="muted">{t('noneUnanswered')}</p>
      ) : (
        <ul className="docs">
          {unanswered.map((q) => (
            <li key={q.created_at + q.query}>
              {q.query}
              <div className="muted small">
                {q.channel} · {new Date(q.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
