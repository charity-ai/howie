import { createClient } from '@supabase/supabase-js';

// Captured BEFORE the Supabase client reads and clears the address, so we can tell
// when someone arrived from an invite or password-reset email and must choose a password.
export const ARRIVAL_HASH = typeof window !== 'undefined' ? window.location.hash : '';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);
export const supabase = createClient(url || 'http://localhost', key || 'missing');
