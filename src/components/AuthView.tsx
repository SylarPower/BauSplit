import { AlertCircle, CheckCircle2, Eye, EyeOff, Link2, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  getAuthRedirectUrl,
  supabase,
  translateErrorIT,
} from '../lib/supabase';
import { AppLogo } from './Icon';

export type AuthMode = 'login' | 'signup' | 'forgot' | 'verify_sent' | 'reset_password';

interface AuthViewProps {
  initialMode?: AuthMode;
  pendingInviteToken: string | null;
  onPasswordResetDone: () => void;
  onStartDemo: () => void;
  authNotice?: string | null;
  initialError?: string | null;
}

export function AuthView({
  initialMode = 'login',
  pendingInviteToken,
  onPasswordResetDone,
  onStartDemo,
  authNotice,
  initialError,
}: AuthViewProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [info, setInfo] = useState<string | null>(authNotice ?? null);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setNeedsEmailConfirm(false);
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setNeedsEmailConfirm(false);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError('Inserisci email e password.');
      return;
    }

    setBusy(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (signInErr) {
        if (signInErr.message.toLowerCase().includes('email not confirmed')) {
          setNeedsEmailConfirm(true);
        }
        setError(translateErrorIT(signInErr));
      }
    } catch (err) {
      setError(translateErrorIT(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const cleanName = displayName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) {
      setError('Inserisci il tuo nome (sarà visibile negli elenchi spese).');
      return;
    }
    if (!cleanEmail) {
      setError('Inserisci un indirizzo email valido.');
      return;
    }
    if (password.length < 8) {
      setError('Scegli una password di almeno 8 caratteri.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Le due password non coincidono.');
      return;
    }

    setBusy(true);
    try {
      const redirectTo = getAuthRedirectUrl(pendingInviteToken);
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            display_name: cleanName,
          },
        },
      });

      if (signUpErr) {
        setError(translateErrorIT(signUpErr));
        return;
      }

      // Supabase restituisce identities vuote se l'email è già registrata e confermata
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError('Questo indirizzo email risulta già registrato. Accedi oppure recupera la password.');
        return;
      }

      // Se la verifica email è attiva, session è null finché l'utente non clicca il link ricevuto
      if (!data.session) {
        setPassword('');
        setConfirmPassword('');
        setMode('verify_sent');
      }
    } catch (err) {
      setError(translateErrorIT(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Inserisci il tuo indirizzo email per ricevere di nuovo il link.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: cleanEmail,
        options: {
          emailRedirectTo: getAuthRedirectUrl(pendingInviteToken),
        },
      });
      if (resendErr) {
        setError(translateErrorIT(resendErr));
      } else {
        setInfo(`Abbiamo inviato una nuova email di verifica a ${cleanEmail}.`);
      }
    } catch (err) {
      setError(translateErrorIT(err));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Inserisci l’indirizzo email del tuo account.');
      return;
    }

    setBusy(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: getAuthRedirectUrl(pendingInviteToken),
      });
      if (resetErr) {
        setError(translateErrorIT(resetErr));
      } else {
        setInfo(
          `Se esiste un account associato a ${cleanEmail}, riceverai a breve un'email con il link per reimpostare la password.`
        );
      }
    } catch (err) {
      setError(translateErrorIT(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUpdatePassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (password.length < 8) {
      setError('La nuova password deve contenere almeno 8 caratteri.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Le due password non coincidono.');
      return;
    }

    setBusy(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) {
        setError(translateErrorIT(updErr));
        return;
      }
      setPassword('');
      setConfirmPassword('');
      onPasswordResetDone();
    } catch (err) {
      setError(translateErrorIT(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-wrap">
        <div className="auth-header">
          <AppLogo size={42} />
          <h1 className="auth-title">Conti Insieme</h1>
          <p className="auth-subtitle">
            Spese condivise, saldi semplificati e rimborsi in ordine, senza complicazioni.
          </p>
        </div>

        {pendingInviteToken && mode !== 'reset_password' && (
          <div className="alert alert-info">
            <Link2 size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Hai aperto un link d&apos;invito a un gruppo. Accedi o crea il tuo account per
              visualizzarlo e decidere se accettarlo.
            </span>
          </div>
        )}

        <div className="card auth-card">
          {(mode === 'login' || mode === 'signup') && (
            <div className="segmented" style={{ marginBottom: 18 }}>
              <button
                type="button"
                className={`segmented-btn ${mode === 'login' ? 'active' : ''}`}
                onClick={() => switchMode('login')}
              >
                Accedi
              </button>
              <button
                type="button"
                className={`segmented-btn ${mode === 'signup' ? 'active' : ''}`}
                onClick={() => switchMode('signup')}
              >
                Crea account
              </button>
            </div>
          )}

          {error && (
            <div className="alert alert-error" style={{ marginBottom: 14 }}>
              <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>{error}</span>
                {needsEmailConfirm && (
                  <button
                    type="button"
                    className="link-btn"
                    style={{ textAlign: 'left', color: 'inherit', textDecoration: 'underline' }}
                    onClick={handleResendVerification}
                    disabled={busy}
                  >
                    Invia di nuovo l&apos;email di verifica
                  </button>
                )}
              </div>
            </div>
          )}

          {info && (
            <div className="alert alert-success" style={{ marginBottom: 14 }}>
              <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{info}</span>
            </div>
          )}

          {mode === 'login' && (
            <form className="form-stack" onSubmit={handleLogin}>
              <label className="field">
                <span className="field-label">Email</span>
                <input
                  type="email"
                  className="input"
                  placeholder="nome@esempio.it"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span className="field-label">
                  <span>Password</span>
                  <button
                    type="button"
                    className="link-btn"
                    style={{ fontSize: 12.5 }}
                    onClick={() => switchMode('forgot')}
                  >
                    Password dimenticata?
                  </button>
                </span>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input"
                    style={{ paddingRight: 40 }}
                    placeholder="La tua password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="btn-icon"
                    style={{
                      position: 'absolute',
                      right: 3,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 32,
                      height: 32,
                    }}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={busy}>
                {busy ? 'Accesso in corso…' : 'Accedi'}
              </button>
            </form>
          )}

          {mode === 'signup' && (
            <form className="form-stack" onSubmit={handleSignup}>
              <label className="field">
                <span className="field-label">Il tuo nome</span>
                <input
                  type="text"
                  className="input"
                  placeholder="Es. Marco"
                  autoComplete="name"
                  maxLength={60}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span className="field-label">Email</span>
                <input
                  type="email"
                  className="input"
                  placeholder="nome@esempio.it"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span className="field-label">Password</span>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input"
                    style={{ paddingRight: 40 }}
                    placeholder="Almeno 8 caratteri"
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="btn-icon"
                    style={{
                      position: 'absolute',
                      right: 3,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 32,
                      height: 32,
                    }}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <label className="field">
                <span className="field-label">Conferma password</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  placeholder="Ripeti la password"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </label>

              <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={busy}>
                {busy ? 'Registrazione in corso…' : 'Crea account'}
              </button>

              <p className="field-hint" style={{ textAlign: 'center' }}>
                Ti invieremo solo un&apos;email per verificare il tuo indirizzo. Nessuna notifica
                promozionale o di attività.
              </p>
            </form>
          )}

          {mode === 'verify_sent' && (
            <div className="form-stack" style={{ textAlign: 'center', alignItems: 'center' }}>
              <span className="empty-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <Mail size={22} />
              </span>
              <h2 style={{ fontSize: 18, fontWeight: 650 }}>Verifica il tuo indirizzo email</h2>
              <p className="text-secondary" style={{ fontSize: 14 }}>
                Abbiamo inviato un link di conferma a <strong>{email}</strong>. Apri l&apos;email e
                clicca sul link per attivare il tuo account.
              </p>
              <p className="field-hint">
                Non trovi il messaggio? Controlla anche la cartella Spam o Promozioni.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-full"
                onClick={handleResendVerification}
                disabled={busy}
              >
                {busy ? 'Invio in corso…' : "Invia di nuovo l'email di verifica"}
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => switchMode('login')}
              >
                Torna all&apos;accesso
              </button>
            </div>
          )}

          {mode === 'forgot' && (
            <form className="form-stack" onSubmit={handleForgotPassword}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 650 }}>Recupera la password</h2>
                <p className="field-hint" style={{ marginTop: 4 }}>
                  Inserisci la tua email: ti invieremo un link per scegliere una nuova password.
                </p>
              </div>

              <label className="field">
                <span className="field-label">Email</span>
                <input
                  type="email"
                  className="input"
                  placeholder="nome@esempio.it"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={busy}>
                {busy ? 'Invio in corso…' : 'Invia link di recupero'}
              </button>

              <button
                type="button"
                className="link-btn"
                style={{ alignSelf: 'center' }}
                onClick={() => switchMode('login')}
              >
                Torna all&apos;accesso
              </button>
            </form>
          )}

          {mode === 'reset_password' && (
            <form className="form-stack" onSubmit={handleUpdatePassword}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 650 }}>Imposta una nuova password</h2>
                <p className="field-hint" style={{ marginTop: 4 }}>
                  Scegli una nuova password di almeno 8 caratteri per il tuo account.
                </p>
              </div>

              <label className="field">
                <span className="field-label">Nuova password</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  placeholder="Almeno 8 caratteri"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span className="field-label">Conferma nuova password</span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  placeholder="Ripeti la nuova password"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </label>

              <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={busy}>
                {busy ? 'Salvataggio…' : 'Salva nuova password'}
              </button>
            </form>
          )}
        </div>

        {mode !== 'reset_password' && (
          <div className="auth-footer">
            <span>Vuoi provare subito tutte le funzioni senza account?</span>
            <button type="button" className="link-btn" onClick={onStartDemo}>
              Apri l&apos;anteprima interattiva con dati di esempio
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
