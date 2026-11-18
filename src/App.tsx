import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { AuthView } from './components/AuthView';
import { AppLogo } from './components/Icon';
import { SetupGuideCard } from './components/SetupGuideCard';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import { saveDeviceGroups } from './lib/deviceGroups';
import {
  consumeUrlAuthError,
  guestClient,
  isMissingSchemaError,
  isRecoveryUrl,
  linkDeviceGroups,
  readAndStoreUrlInviteToken,
  supabase,
  translateErrorIT,
} from './lib/supabase';

function Linking({ guestId, accountId }: { guestId: string; accountId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let current = true;
    setError(null);
    void Promise.resolve()
      .then(async () => {
        if (!current) return;
        // Non rimuovere MAI la sessione ospite o l'elenco locale prima del successo sul server.
        await linkDeviceGroups(guestId, accountId);
        if (!current) return;
        saveDeviceGroups(guestId, []);
        const result = await guestClient.auth.signOut({ scope: 'local' });
        if (result.error) throw result.error;
      })
      .catch((err) => {
        if (current) setError(err);
      });
    return () => {
      current = false;
    };
  }, [guestId, accountId, attempt]);
  return (
    <main className="container form-stack" aria-live="polite">
      <AppLogo size={36} />
      <h1 className="page-title">Collegamento dei tuoi gruppi</h1>
      {!error ? (
        <p className="text-secondary">
          Sto collegando i gruppi di questo dispositivo al tuo account…
        </p>
      ) : (
        <>
          {isMissingSchemaError(error) ? (
            <SetupGuideCard retrying={false} onRetry={() => setAttempt((n) => n + 1)} />
          ) : (
            <div className="alert alert-error">{translateErrorIT(error)}</div>
          )}
          <div className="inline-actions">
            <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
              Riprova
            </button>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const result = await supabase.auth.signOut({ scope: 'local' });
                if (result.error) setError(result.error);
              }}
            >
              Torna al dispositivo
            </button>
          </div>
        </>
      )}
    </main>
  );
}

export function App() {
  const [account, setAccount] = useState<Session | null | undefined>(undefined);
  const [guest, setGuest] = useState<Session | null | undefined>(undefined);
  const [accountScreen, setAccountScreen] = useState<'login' | 'signup' | null>(null);
  const [recovery, setRecovery] = useState(isRecoveryUrl);
  const [authError, setAuthError] = useState(consumeUrlAuthError);
  const [invite, setInvite] = useState(readAndStoreUrlInviteToken);
  useEffect(() => {
    const a = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (session || event === 'SIGNED_OUT') setAccountScreen(null);
      setAccount(session);
    });
    const g = guestClient.auth.onAuthStateChange((_event, session) => setGuest(session));
    return () => {
      a.data.subscription.unsubscribe();
      g.data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (recovery && account === null) {
      setRecovery(false);
      setAuthError(
        (prev) => prev ?? 'Il link per cambiare la password non è più valido. Richiedine uno nuovo.'
      );
      setAccountScreen('login');
    }
  }, [account, recovery]);

  if (account === undefined || guest === undefined)
    return (
      <div className="center-loader" style={{ minHeight: '100dvh' }}>
        <AppLogo size={36} />
        <span className="spinner" />
      </div>
    );
  if (recovery || (!account && (accountScreen || authError)))
    return (
      <AuthView
        key={recovery ? 'recovery' : 'account'}
        initialMode={recovery ? 'reset_password' : (accountScreen ?? 'login')}
        initialError={authError}
        pendingInviteToken={invite}
        authNotice={
          guest && !recovery
            ? 'Dopo l’accesso, i gruppi di questo dispositivo verranno collegati al tuo account.'
            : null
        }
        onBack={() => {
          setAccountScreen(null);
          setAuthError(null);
        }}
        onPasswordResetDone={() => {
          setRecovery(false);
          window.history.replaceState({}, '', location.pathname + location.search);
        }}
      />
    );
  if (account && guest) return <Linking guestId={guest.user.id} accountId={account.user.id} />;
  const session = account ?? guest;
  if (!session) return <Welcome hasInvite={Boolean(invite)} onAccount={setAccountScreen} />;
  return (
    <Workspace
      key={session.user.id}
      session={session}
      isGuest={!account}
      invite={invite}
      onInviteChange={setInvite}
      onOpenAccount={() => setAccountScreen('login')}
    />
  );
}
