import { useEffect, useState } from 'react';
import { fetchDocument, viewable, type Source } from '../lib/api';
import type { T } from '../lib/i18n';

interface Props {
  source: Source;
  t: T;
  onClose: () => void;
}

/**
 * Shows the document Howie answered from, opened at the page the passage is on,
 * with the exact passage above it. Files load through the signed-in site, so the
 * Drive folder never has to be shared with board members.
 */
export default function DocumentPanel({ source, t, onClose }: Props) {
  const canView = viewable(source.mime);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // load the file whenever a different document is shown (PDF-able files only)
  useEffect(() => {
    setUrl(null);
    setErr('');
    if (!canView) return;
    const ctrl = new AbortController();
    let made: string | null = null;
    setBusy(true);
    fetchDocument(source.file_id, ctrl.signal)
      .then((blob) => {
        made = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'application/pdf' }));
        setUrl(made);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : t('errorGeneric'));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBusy(false);
      });
    return () => {
      ctrl.abort();
      if (made) URL.revokeObjectURL(made);
    };
    // reload only when a different document is shown (not when the language changes)
  }, [source.file_id, canView]);

  async function download() {
    setErr('');
    setBusy(true);
    try {
      const blob = await fetchDocument(source.file_id);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = source.title;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
    }
    setBusy(false);
  }

  const pageHash = source.page && source.page > 1 ? `#page=${source.page}` : '';
  const full = url ? url + pageHash : null;

  return (
    <section className="card doc-panel" aria-label={t('docPanel')}>
      <div className="row between doc-head">
        <div className="doc-title">
          <span className="pill">{source.category}</span>
          <h2>{source.title}</h2>
          {source.page && (
            <span className="muted small">
              {t('page')} {source.page}
            </span>
          )}
        </div>
        <button className="link" onClick={onClose} type="button" aria-label={t('close')}>
          {t('close')}
        </button>
      </div>

      {source.quote && (
        <blockquote className="doc-quote">
          <div className="small muted">{t('quoteTitle')}</div>
          {source.quote}
        </blockquote>
      )}

      {canView ? (
        <>
          {busy && <p className="muted">{t('docLoading')}</p>}
          {full && (
            <>
              <iframe key={full} className="doc-frame" src={full} title={source.title} />
              <div className="row end">
                <a className="small" href={full} target="_blank" rel="noopener noreferrer">
                  {t('openFull')}
                </a>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="stack">
          <p className="muted small">{t('notViewable')}</p>
          <button className="secondary" onClick={download} disabled={busy} type="button">
            {busy ? t('docLoading') : t('download')}
          </button>
        </div>
      )}
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
    </section>
  );
}
