import { useCallback, useState } from 'react';

export type Lang = 'en' | 'es';

const en = {
  tagline: 'Ask about your documents. Howie answers only from what is in your library.',
  signIn: 'Sign in',
  signingIn: 'Signing in…',
  email: 'Email',
  password: 'Password',
  forgot: 'Forgot password?',
  sendReset: 'Email me a reset link',
  resetSent: 'Check your email for a reset link.',
  back: 'Back to sign in',
  inviteOnly: 'Access is by invitation. Ask your administrator for an invite.',
  setPasswordTitle: 'Choose your password',
  newPassword: 'New password (at least 8 characters)',
  savePassword: 'Save password',
  passwordSaved: 'Password saved.',
  signOut: 'Sign out',
  language: 'Language',
  askPlaceholder: 'Ask a question, e.g. "What is the pet policy?"',
  ask: 'Ask Howie',
  asking: 'Looking it up…',
  sources: 'From these documents',
  openDoc: 'Open document',
  talk: 'Talk to Howie',
  connecting: 'Connecting…',
  listening: 'Listening… tap to stop',
  speaking: 'Howie is speaking… tap to stop',
  micDenied: 'Microphone is blocked. Allow it in your browser settings and try again.',
  voiceSources: 'On screen from your voice question',
  admin: 'Admin',
  libraryFolder: 'Library folder (Google Drive)',
  folderHelp: 'Paste the folder address or ID. The folder must be shared with the Howie service account as Viewer.',
  voiceAgentId: 'Voice agent ID',
  voiceHelp: 'Starts with agent_. Never paste a key that starts with sk_ or xi_.',
  save: 'Save',
  saved: 'Saved',
  badFolder: 'That does not look like a Drive folder address or ID.',
  badAgent: 'Use the Agent ID that starts with agent_ (not an API key).',
  syncNow: 'Sync now',
  syncing: 'Syncing… statuses update every few seconds',
  library: 'Library',
  noDocs: 'No documents yet. Set the folder, then press Sync now.',
  unanswered: 'Unanswered questions',
  noneUnanswered: 'Nothing here. Every question so far was answered.',
  refresh: 'Refresh',
  errorGeneric: 'Something went wrong. Please try again.',
  configMissing: 'This site is not configured yet (missing Supabase values).',
  loading: 'Loading…',
  showDoc: 'Show document',
  showing: 'Showing',
  docPanel: 'Document',
  quoteTitle: 'The part Howie used',
  page: 'Page',
  openFull: 'Open full screen',
  download: 'Download',
  docLoading: 'Opening the document…',
  close: 'Close',
  notViewable: 'This file type cannot be shown here. Download it, or add a PDF or Google Doc version to the library.',
};

const es: typeof en = {
  tagline: 'Pregunta sobre tus documentos. Howie responde solo con lo que hay en tu biblioteca.',
  signIn: 'Iniciar sesión',
  signingIn: 'Entrando…',
  email: 'Correo electrónico',
  password: 'Contraseña',
  forgot: '¿Olvidaste tu contraseña?',
  sendReset: 'Envíame un enlace para restablecerla',
  resetSent: 'Revisa tu correo para el enlace de restablecimiento.',
  back: 'Volver a iniciar sesión',
  inviteOnly: 'El acceso es por invitación. Pide una invitación a tu administrador.',
  setPasswordTitle: 'Elige tu contraseña',
  newPassword: 'Nueva contraseña (mínimo 8 caracteres)',
  savePassword: 'Guardar contraseña',
  passwordSaved: 'Contraseña guardada.',
  signOut: 'Cerrar sesión',
  language: 'Idioma',
  askPlaceholder: 'Haz una pregunta, p. ej. "¿Cuál es la política de mascotas?"',
  ask: 'Preguntar a Howie',
  asking: 'Buscando…',
  sources: 'De estos documentos',
  openDoc: 'Abrir documento',
  talk: 'Hablar con Howie',
  connecting: 'Conectando…',
  listening: 'Escuchando… toca para detener',
  speaking: 'Howie está hablando… toca para detener',
  micDenied: 'El micrófono está bloqueado. Permítelo en la configuración del navegador e inténtalo de nuevo.',
  voiceSources: 'En pantalla por tu pregunta de voz',
  admin: 'Administración',
  libraryFolder: 'Carpeta de la biblioteca (Google Drive)',
  folderHelp: 'Pega la dirección o el ID de la carpeta. Debe estar compartida con la cuenta de servicio de Howie como Lector.',
  voiceAgentId: 'ID del agente de voz',
  voiceHelp: 'Empieza con agent_. Nunca pegues una clave que empiece con sk_ o xi_.',
  save: 'Guardar',
  saved: 'Guardado',
  badFolder: 'Eso no parece una dirección ni un ID de carpeta de Drive.',
  badAgent: 'Usa el ID del agente que empieza con agent_ (no una clave de API).',
  syncNow: 'Sincronizar ahora',
  syncing: 'Sincronizando… los estados se actualizan cada pocos segundos',
  library: 'Biblioteca',
  noDocs: 'Aún no hay documentos. Define la carpeta y pulsa Sincronizar ahora.',
  unanswered: 'Preguntas sin respuesta',
  noneUnanswered: 'Nada aquí. Todas las preguntas se respondieron.',
  refresh: 'Actualizar',
  errorGeneric: 'Algo salió mal. Inténtalo de nuevo.',
  configMissing: 'Este sitio aún no está configurado (faltan valores de Supabase).',
  loading: 'Cargando…',
  showDoc: 'Ver documento',
  showing: 'En pantalla',
  docPanel: 'Documento',
  quoteTitle: 'La parte que usó Howie',
  page: 'Página',
  openFull: 'Abrir en pantalla completa',
  download: 'Descargar',
  docLoading: 'Abriendo el documento…',
  close: 'Cerrar',
  notViewable: 'Este tipo de archivo no se puede mostrar aquí. Descárgalo o agrega una versión en PDF o Google Docs a la biblioteca.',
};

export type Key = keyof typeof en;
const dict = { en, es };

function readStored(): Lang | null {
  try {
    const v = localStorage.getItem('howie_lang');
    return v === 'es' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

export function useLang(initial: Lang = 'en') {
  const [lang, setLangState] = useState<Lang>(() => readStored() ?? initial);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('howie_lang', l);
    } catch {
      /* private window: ignore */
    }
  }, []);
  const t = useCallback((k: Key) => dict[lang][k], [lang]);
  return { lang, setLang, t };
}

export type T = (k: Key) => string;
