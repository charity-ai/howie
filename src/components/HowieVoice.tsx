import { useEffect, useRef, useState } from 'react';
import { Conversation } from '@elevenlabs/client';
import { api, type Source } from '../lib/api';
import type { Lang, T } from '../lib/i18n';

interface Passages {
  document_content: string;
  how_to_answer: string;
  link_shown_on_screen: boolean;
  sources: Source[];
}

interface Props {
  agentId: string;
  lang: Lang;
  t: T;
  onSources: (s: Source[]) => void;
}

export default function HowieVoice({ agentId, lang, t, onSources }: Props) {
  const [state, setState] = useState<'idle' | 'connecting' | 'live'>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [err, setErr] = useState('');
  const conv = useRef<Conversation | null>(null);

  // wake the answer endpoint so the first spoken question is not slow; end the call on leave
  useEffect(() => {
    fetch('/api/kb-ask').catch(() => undefined);
    return () => {
      conv.current?.endSession().catch(() => undefined);
    };
  }, []);

  async function start() {
    setErr('');
    setState('connecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
    } catch {
      setErr(t('micDenied'));
      setState('idle');
      return;
    }
    try {
      conv.current = await Conversation.startSession({
        agentId,
        connectionType: 'webrtc',
        overrides: { agent: { language: lang } },
        clientTools: {
          // must match the tool name in ElevenLabs exactly (case-sensitive)
          ask_broker: async (params: { query?: string }) => {
            const query = String(params?.query ?? '').trim();
            if (!query) return 'No question was received.';
            const ctrl = new AbortController();
            const timeout = window.setTimeout(() => ctrl.abort(), 9000);
            try {
              const r = await api<Passages>('/api/kb-ask', { query, lang, mode: 'passages' }, ctrl.signal);
              onSources(r.sources);
              return JSON.stringify({
                document_content: r.document_content,
                how_to_answer: r.how_to_answer,
                link_shown_on_screen: r.link_shown_on_screen,
              });
            } catch {
              return 'The search took too long or failed. Ask the person to try again.';
            } finally {
              window.clearTimeout(timeout);
            }
          },
        },
        onConnect: () => setState('live'),
        onDisconnect: () => {
          setState('idle');
          setSpeaking(false);
        },
        onError: (m: string) => {
          setErr(String(m));
          setState('idle');
        },
        onModeChange: (m: { mode: string }) => setSpeaking(m.mode === 'speaking'),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'));
      setState('idle');
    }
  }

  async function stop() {
    await conv.current?.endSession().catch(() => undefined);
    conv.current = null;
    setState('idle');
    setSpeaking(false);
  }

  const label =
    state === 'connecting' ? t('connecting') : state === 'live' ? (speaking ? t('speaking') : t('listening')) : t('talk');

  return (
    <div className="stack">
      <button
        className={`primary ${state === 'live' ? 'live' : ''}`}
        onClick={state === 'idle' ? start : stop}
        disabled={state === 'connecting'}
        type="button"
      >
        {label}
      </button>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
