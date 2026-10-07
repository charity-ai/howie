import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ARRIVAL_HASH, configured, supabase } from './lib/supabase';
import { useLang } from './lib/i18n';
import { SetPassword, SignIn } from './pages/SignIn';
import Howie from './pages/Howie';

export interface Profile {
  role: 'member' | 'admin';
  lang: 'en' | 'es';
  full_name: string | null;
}

const arrivedByEmailLink = /type=(invite|recovery)/.test(ARRIVAL_HASH);

export default function App() {
  const { t } = useLang('en');
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mustSetPassword, setMustSetPassword] = useState(arrivedByEmailLink);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setMustSetPassword(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    supabase
      .from('profiles')
      .select('role,lang,full_name')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile((data as Profile | null) ?? { role: 'member', lang: 'en', full_name: null }));
  }, [session]);

  if (!configured) return <main className="center"><p className="notice">{t('configMissing')}</p></main>;
  if (session === undefined) return <main className="center"><p>{t('loading')}</p></main>;
  if (!session) return <SignIn />;
  if (mustSetPassword) {
    return (
      <SetPassword
        onDone={() => {
          history.replaceState(null, '', window.location.pathname);
          setMustSetPassword(false);
        }}
      />
    );
  }
  if (!profile) return <main className="center"><p>{t('loading')}</p></main>;
  return <Howie profile={profile} />;
}
