import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://mwicplgacecjaeyzbuhx.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13aWNwbGdhY2VjamFleXpidWh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MjU1MTYsImV4cCI6MjA5MjAwMTUxNn0.MkxJ2Pkcs-t4OArgIzC5RxBZ-PWWL_tAme2IgcFvU8Q';

export const SUPABASE_URL: string =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || DEFAULT_SUPABASE_URL;

export const SUPABASE_ANON_KEY: string =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  DEFAULT_SUPABASE_ANON_KEY;

export function getSupabaseProjectRef(): string | null {
  const match = SUPABASE_URL.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match ? match[1] : null;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Restituisce l'URL base pulito dell'app (compatibile sia con GitHub Pages `/todolist/`
 * sia con dominio root `/`).
 */
export function getAppBaseUrl(): string {
  const { origin, pathname } = window.location;
  const cleanPath = pathname.endsWith('/index.html')
    ? pathname.slice(0, -'index.html'.length)
    : pathname.endsWith('/')
      ? pathname
      : `${pathname}/`;
  return `${origin}${cleanPath}`;
}

export function getAuthRedirectUrl(pendingInviteToken?: string | null): string {
  const base = getAppBaseUrl();
  if (pendingInviteToken) {
    return `${base}?invito=${encodeURIComponent(pendingInviteToken)}`;
  }
  return base;
}

export function buildInviteUrl(token: string): string {
  return `${getAppBaseUrl()}?invito=${encodeURIComponent(token)}`;
}

/**
 * Estrae il token d'invito sia da un URL completo (`https://...?invito=abc123`)
 * sia da un codice incollato direttamente (`abc123`).
 */
export function extractInviteToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const url = new URL(trimmed);
      const fromQuery = url.searchParams.get('invito') || url.searchParams.get('invite');
      if (fromQuery?.trim()) return fromQuery.trim();
    }
  } catch {
    // non è un URL valido, prosegui come testo
  }

  const queryMatch = trimmed.match(/[?&](?:invito|invite)=([a-zA-Z0-9_-]+)/);
  if (queryMatch) return queryMatch[1];

  if (/^[a-zA-Z0-9_-]{8,128}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

const PENDING_INVITE_STORAGE_KEY = 'conti_insieme_pending_invite';

export function readAndStoreUrlInviteToken(): string | null {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('invito') || url.searchParams.get('invite');
    if (token && token.trim()) {
      const clean = token.trim();
      localStorage.setItem(PENDING_INVITE_STORAGE_KEY, clean);
      return clean;
    }
    return localStorage.getItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearPendingInviteToken(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
    const url = new URL(window.location.href);
    if (url.searchParams.has('invito') || url.searchParams.has('invite')) {
      url.searchParams.delete('invito');
      url.searchParams.delete('invite');
      const next =
        url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '') + url.hash;
      window.history.replaceState({}, '', next);
    }
  } catch {
    // ignore
  }
}

export function isRecoveryUrl(): boolean {
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    return hash.includes('type=recovery') || search.includes('type=recovery');
  } catch {
    return false;
  }
}

export function consumeUrlAuthError(): string | null {
  try {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const errCode = url.searchParams.get('error_code') || hashParams.get('error_code');
    const errDesc =
      url.searchParams.get('error_description') || hashParams.get('error_description');
    if (!errCode && !errDesc) return null;

    url.searchParams.delete('error');
    url.searchParams.delete('error_code');
    url.searchParams.delete('error_description');
    const clean =
      url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '');
    window.history.replaceState({}, '', clean);

    if (errCode === 'otp_expired' || (errDesc && errDesc.toLowerCase().includes('expired'))) {
      return "Il link ricevuto via email è scaduto o è già stato utilizzato. Accedi o richiedine uno nuovo.";
    }
    return 'Il link di verifica non è più valido. Riprova o richiedi un nuovo invio.';
  } catch {
    return null;
  }
}

export function isMissingSchemaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; details?: string };
  const code = e.code || '';
  const msg = `${e.message || ''} ${e.details || ''}`.toLowerCase();
  return (
    code === 'PGRST205' ||
    code === 'PGRST202' ||
    code === '42P01' ||
    code === '42883' ||
    msg.includes('could not find the table') ||
    msg.includes('could not find the function') ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

export function translateErrorIT(err: unknown): string {
  if (!err) return 'Si è verificato un errore imprevisto.';
  const raw =
    typeof err === 'string'
      ? err
      : typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'Si è verificato un errore imprevisto.';

  const lower = raw.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'Email o password non corretti.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Devi prima confermare il tuo indirizzo email. Controlla la posta in arrivo o richiedi un nuovo link.';
  }
  if (lower.includes('user already registered')) {
    return 'Esiste già un account associato a questa email. Prova ad accedere.';
  }
  if (lower.includes('password should be at least')) {
    return 'La password deve contenere almeno 6 caratteri.';
  }
  if (lower.includes('new password should be different')) {
    return 'La nuova password deve essere diversa da quella attuale.';
  }
  if (lower.includes('email rate limit exceeded') || lower.includes('over_email_send_rate_limit') || lower.includes('for security purposes, you can only request this after')) {
    return 'Hai inviato troppe richieste ravvicinate. Attendi qualche istante e riprova.';
  }
  if (lower.includes('unable to validate email address') || lower.includes('invalid email')) {
    return 'Inserisci un indirizzo email valido.';
  }
  if (lower.includes('signup is disabled') || lower.includes('signups not allowed')) {
    return 'Le nuove registrazioni sono disabilitate nelle impostazioni di autenticazione Supabase.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Impossibile contattare il server. Controlla la connessione internet e riprova.';
  }
  if (lower.includes('idx_group_categories_unique_name') || lower.includes('duplicate key')) {
    return 'Esiste già una voce con questo nome.';
  }

  return raw;
}
