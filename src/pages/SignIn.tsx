import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';

function Brand({ tagline }: { tagline: string }) {
  return (
    <div className="brand">
      <img src="/howie.svg" alt="" width={56} height={56} />
      <h1>Howie</h1>
      <p className="muted">{tagline}</p>
    </div>
  );
}

export function SignIn() {
  const { lang, setLang, t } = useLang('en');
  const [mode, setMode] = useState<'in' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setMsg('');
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setErr(error.message);
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) setErr(error.message);
      else setMsg(t('resetSent'));
    }
    setBusy(false);
  }

  return (
    <main className="center">
      <div className="card narrow">
        <div className="row end">
          <button className="link" onClick={() => setLang(lang === 'en' ? 'es' : 'en')} type="button">
            {lang === 'en' ? 'Español' : 'English'}
          </button>
        </div>
        <Brand tagline={t('tagline')} />
        <form onSubmit={submit} className="stack">
          <label>
            {t('email')}
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode === 'in' && (
            <label>
              {t('password')}
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {err && <p className="error" role="alert">{err}</p>}
          {msg && <p className="ok" role="status">{msg}</p>}
          <button className="primary" disabled={busy} type="submit">
            {busy ? t('signingIn') : mode === 'in' ? t('signIn') : t('sendReset')}
          </button>
        </form>
        <div className="row between">
          {mode === 'in' ? (
            <button className="link" type="button" onClick={() => setMode('reset')}>
              {t('forgot')}
            </button>
          ) : (
            <button className="link" type="button" onClick={() => setMode('in')}>
              {t('back')}
            </button>
          )}
        </div>
        <p className="muted small">{t('inviteOnly')}</p>
      </div>
    </main>
  );
}

export function SetPassword({ onDone }: { onDone: () => void }) {
  const { t } = useLang('en');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setErr(t('newPassword'));
      return;
    }
    setBusy(true);
    setErr('');
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setErr(error.message);
    else onDone();
  }

  return (
    <main className="center">
      <div className="card narrow">
        <Brand tagline={t('setPasswordTitle')} />
        <form onSubmit={submit} className="stack">
          <label>
            {t('newPassword')}
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {err && <p className="error" role="alert">{err}</p>}
          <button className="primary" disabled={busy} type="submit">
            {t('savePassword')}
          </button>
        </form>
      </div>
    </main>
  );
}
