import { FormEvent, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api, type AskResult, type Source } from '../lib/api';
import { useLang, type T } from '../lib/i18n';
import type { Profile } from '../App';
import AdminPanel from '../components/AdminPanel';
import DocumentPanel from '../components/DocumentPanel';

// the voice library is large, so it only loads when a voice agent is set
const HowieVoice = lazy(() => import('../components/HowieVoice'));

function SourceList({
  sources,
  title,
  t,
  shownId,
  onShow,
}: {
  sources: Source[];
  title: string;
  t: T;
  shownId: string | null;
  onShow: (s: Source) => void;
}) {
  if (!sources.length) return null;
  return (
    <div className="sources">
      <h3>{title}</h3>
      <ul>
        {sources.map((s) => (
          <li key={s.file_id}>
            <strong>{s.title}</strong>
            <span className="muted small"> · {s.category}</span>
            {s.page && (
              <span className="muted small">
                {' '}
                · {t('page')} {s.page}
              </span>
            )}
            <div>
              {shownId === s.file_id ? (
                <span className="small ok">{t('showing')}</span>
              ) : (
                <button className="link" onClick={() => onShow(s)} type="button">
                  {t('showDoc')}
                </button>
              )}
            </div>
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
  // the document open beside the answer
  const [shown, setShown] = useState<Source | null>(null);

  // while Howie is speaking, bring up the document he is quoting
  const onVoiceSources = useCallback((s: Source[]) => {
    setVoiceSources(s);
    if (s[0]) setShown(s[0]);
  }, []);

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
      const r = await api<AskResult>('/api/kb-ask', { query, lang });
      setResult(r);
      setShown(r.sources[0] ?? null);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('errorGeneric'));
    }
    setBusy(false);
  }

  return (
    <main className={`page ${shown ? 'with-doc' : ''}`}>
      <header className="topbar">
        <div className="row">
          <img src="/howie.svg" alt="" width={36} height={36} />
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

      <div className="layout">
        <div className="layout-main">
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
            {err && (
              <p className="error" role="alert">
                {err}
              </p>
            )}
            {result && (
              <div className="answer" aria-live="polite">
                <p className="answer-text">{result.answer}</p>
                <SourceList
                  sources={result.sources}
                  title={t('sources')}
                  t={t}
                  shownId={shown?.file_id ?? null}
                  onShow={setShown}
                />
              </div>
            )}
          </section>

          {agentId && (
            <section className="card">
              <Suspense fallback={<p className="muted">{t('loading')}</p>}>
                <HowieVoice agentId={agentId} lang={lang} t={t} onSources={onVoiceSources} />
              </Suspense>
              <SourceList
                sources={voiceSources}
                title={t('voiceSources')}
                t={t}
                shownId={shown?.file_id ?? null}
                onShow={setShown}
              />
            </section>
          )}

          {profile.role === 'admin' && <AdminPanel t={t} />}
        </div>

        {shown && (
          <div className="layout-doc">
            <DocumentPanel source={shown} t={t} onClose={() => setShown(null)} />
          </div>
        )}
      </div>
    </main>
  );
}
