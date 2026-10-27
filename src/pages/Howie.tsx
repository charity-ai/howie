import { FormEvent, lazy, Suspense, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api, type AskResult, type Source } from '../lib/api';
import { useLang } from '../lib/i18n';
import type { Profile } from '../App';
import AdminPanel from '../components/AdminPanel';

// the voice library is large, so it only loads when a voice agent is set
const HowieVoice = lazy(() => import('../components/HowieVoice'));

function SourceList({ sources, title, t }: { sources: Source[]; title: string; t: (k: 'openDoc') => string }) {
  if (!sources.length) return null;
  return (
    <div className="sources">
      <h3>{title}</h3>
      <ul>
        {sources.map((s) => (
          <li key={s.title + (s.url ?? '')}>
            <strong>{s.title}</strong>
            <span className="muted small"> · {s.category}</span>
            <div className="small muted">{s.directions}</div>
            {s.url && (
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {t('openDoc')}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Howie({ profile }: { profile: Profile }) {
  const { lang, setLang, t } = useLang(profile.lang);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [err, setErr] = useState('');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [voiceSources, setVoiceSources] = useState<Source[]>([]);

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', 'voice_agent_id')
      .maybeSingle()
      .then(({ data }) => {
        const v = (data as { value: unknown } | null)?.value;
        setAgentId(typeof v === 'string' && v.startsWith('agent_') ? v : null);
      });
  }, []);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      setResult(await api<AskResult>('/api/kb-ask', { query, lang }));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('errorGeneric'));
    }
    setBusy(false);
  }

  return (
    <main className="page">
      <header className="topbar">
        <div className="row">
          <img src="/howie-avatar-128.png" alt="" width={36} height={36} />
          <strong>Howie</strong>
        </div>
        <div className="row">
          <button className="link" onClick={() => setLang(lang === 'en' ? 'es' : 'en')} type="button">
            {lang === 'en' ? 'Español' : 'English'}
          </button>
          <button className="link" onClick={() => supabase.auth.signOut()} type="button">
            {t('signOut')}
          </button>
        </div>
      </header>

      <section className="card">
        <p className="muted">{t('tagline')}</p>
        <form onSubmit={ask} className="stack">
          <textarea
            rows={3}
            maxLength={500}
            value={query}
            placeholder={t('askPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('ask')}
          />
          <button className="primary" disabled={busy || !query.trim()} type="submit">
            {busy ? t('asking') : t('ask')}
          </button>
        </form>
        {err && <p className="error" role="alert">{err}</p>}
        {result && (
          <div className="answer" aria-live="polite">
            <p className="answer-text">{result.answer}</p>
            <SourceList sources={result.sources} title={t('sources')} t={t} />
          </div>
        )}
      </section>

      {agentId && (
        <section className="card">
          <Suspense fallback={<p className="muted">{t('loading')}</p>}>
            <HowieVoice agentId={agentId} lang={lang} t={t} onSources={setVoiceSources} />
          </Suspense>
          <SourceList sources={voiceSources} title={t('voiceSources')} t={t} />
        </section>
      )}

      {profile.role === 'admin' && <AdminPanel t={t} />}
    </main>
  );
}
