import type { Session } from '@supabase/supabase-js';
import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthView } from './components/AuthView';
import { GroupsHomeView } from './components/GroupsHomeView';
import { GroupView } from './components/GroupView';
import { AppLogo, Avatar } from './components/Icon';
import { ProfileModal } from './components/ProfileModal';
import { DEMO_USERS, DemoRepository, resetDemoDatabase } from './lib/demoStore';
import {
  type DataRepository,
  processDueRecurringExpenses,
  SupabaseRepository,
} from './lib/repository';
import {
  clearPendingInviteToken,
  consumeUrlAuthError,
  isMissingSchemaError,
  isRecoveryUrl,
  readAndStoreUrlInviteToken,
  supabase,
  translateErrorIT,
} from './lib/supabase';
import type {
  GroupData,
  GroupOverview,
  InvitePreview,
  UserProfile,
} from './types';

interface ToastItem {
  id: number;
  message: string;
  isError: boolean;
}

export function App() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [recoveryMode, setRecoveryMode] = useState<boolean>(() => isRecoveryUrl());
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authError] = useState<string | null>(() => consumeUrlAuthError());

  // Modalità anteprima demo locale (opzionale)
  const [demoMode, setDemoMode] = useState(false);
  const [demoUserId, setDemoUserId] = useState<string>(DEMO_USERS[0].id);
  const demoUserRef = useRef(demoUserId);
  demoUserRef.current = demoUserId;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const [groups, setGroups] = useState<GroupOverview[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeGroupData, setActiveGroupData] = useState<GroupData | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(false);

  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(() =>
    readAndStoreUrlInviteToken()
  );
  const [inviteState, setInviteState] = useState<{
    token: string;
    loading: boolean;
    preview: InvitePreview | null;
  } | null>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);

  const pushToast = useCallback((message: string, isError = false) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-2), { id, message, isError }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  const supabaseRepo = useMemo(() => new SupabaseRepository(), []);
  const demoRepo = useMemo(() => new DemoRepository(() => demoUserRef.current), []);
  const repo: DataRepository = demoMode ? demoRepo : supabaseRepo;

  // Inizializzazione sessione Supabase Auth + ascolto eventi (verifica email, recupero password)
  useEffect(() => {
    let mounted = true;
    const safetyTimer = setTimeout(() => {
      if (mounted) setAuthReady(true);
    }, 4000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setAuthReady(true);
      })
      .catch(() => {
        if (mounted) setAuthReady(true);
      })
      .finally(() => clearTimeout(safetyTimer));

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        setDemoMode(false);
        setRecoveryMode(true);
      }
      if (event === 'SIGNED_IN' && window.location.hash.includes('access_token')) {
        const wasSignup = window.location.hash.includes('type=signup');
        // Pulisce il frammento hash dopo la verifica email mantenendo eventuali parametri query
        const cleanUrl = window.location.pathname + window.location.search;
        window.history.replaceState({}, '', cleanUrl);
        if (wasSignup) {
          pushToast('Indirizzo email verificato! Benvenuto su Conti Insieme.');
        }
      }
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const currentUserId: string | null = demoMode
    ? demoUserId
    : session?.user?.id ?? null;

  const loadHome = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!currentUserId) return;
      if (!opts.silent) setLoadingGroups(true);
    try {
      const fallbackEmail = demoMode
        ? (DEMO_USERS.find((u) => u.id === currentUserId)?.email ?? '')
        : (session?.user?.email ?? '');
      const fallbackName = demoMode
        ? DEMO_USERS.find((u) => u.id === currentUserId)?.displayName
        : (session?.user?.user_metadata?.display_name as string | undefined);

      const prof = await repo.ensureProfile(currentUserId, fallbackEmail, fallbackName);
      setProfile(prof);

      const list = await repo.listGroupOverviews(currentUserId);
      setGroups(list);
      setSchemaMissing(false);
    } catch (err) {
      if (!demoMode && isMissingSchemaError(err)) {
        setSchemaMissing(true);
        setProfile({
          id: currentUserId,
          email: session?.user?.email ?? '',
          displayName:
            (session?.user?.user_metadata?.display_name as string | undefined) ||
            session?.user?.email?.split('@')[0] ||
            'Utente',
          createdAt: new Date().toISOString(),
        });
      } else {
        pushToast(translateErrorIT(err), true);
      }
      } finally {
        if (!opts.silent) setLoadingGroups(false);
      }
    },
    [currentUserId, demoMode, repo, session, pushToast]
  );

  useEffect(() => {
    if (!currentUserId || recoveryMode) {
      setProfile(null);
      setGroups([]);
      setActiveGroupId(null);
      setActiveGroupData(null);
      setSchemaMissing(false);
      return;
    }
    void loadHome();
  }, [currentUserId, recoveryMode, loadHome]);

  // Verifica anteprima link d'invito quando l'utente è autenticato
  const inspectInviteToken = useCallback(
    async (token: string) => {
      if (!demoMode) {
        setPendingInviteToken(token);
      }
      setActiveGroupId(null);
      setActiveGroupData(null);
      setInviteState({ token, loading: true, preview: null });
      try {
        const preview = await repo.getInvitePreview(token);
        setInviteState({ token, loading: false, preview });
      } catch (err) {
        if (!demoMode && isMissingSchemaError(err)) {
          setSchemaMissing(true);
          setInviteState(null);
        } else {
          setInviteState({
            token,
            loading: false,
            preview: { valid: false, reason: 'not_found' },
          });
        }
      }
    },
    [repo, demoMode]
  );

  useEffect(() => {
    if (demoMode || !currentUserId || recoveryMode || schemaMissing || !pendingInviteToken) return;
    void inspectInviteToken(pendingInviteToken);
  }, [demoMode, currentUserId, recoveryMode, schemaMissing, pendingInviteToken, inspectInviteToken]);

  // Caricamento dati del gruppo selezionato + generazione spese ricorrenti scadute + Realtime
  const refreshActiveGroup = useCallback(
    async (groupId: string, options?: { silent?: boolean; checkRecurring?: boolean }) => {
      if (!currentUserId) return;
      if (!options?.silent) setLoadingGroup(true);
      try {
        let data = await repo.getGroupData(groupId);
        if (options?.checkRecurring) {
          const generated = await processDueRecurringExpenses({
            repo,
            actorId: currentUserId,
            data,
          });
          if (generated > 0) {
            data = await repo.getGroupData(groupId);
            pushToast(
              generated === 1
                ? '1 spesa ricorrente registrata automaticamente'
                : `${generated} spese ricorrenti registrate automaticamente`
            );
          }
        }
        setActiveGroupData(data);
      } catch (err) {
        pushToast(translateErrorIT(err), true);
        setActiveGroupId(null);
        setActiveGroupData(null);
        void loadHome();
      } finally {
        if (!options?.silent) setLoadingGroup(false);
      }
    },
    [currentUserId, repo, pushToast, loadHome]
  );

  useEffect(() => {
    if (!activeGroupId || !currentUserId) return;
    void refreshActiveGroup(activeGroupId, { checkRecurring: true });
    const unsubscribe = repo.subscribeToGroup(activeGroupId, () => {
      void refreshActiveGroup(activeGroupId, { silent: true });
    });
    return unsubscribe;
  }, [activeGroupId, currentUserId, repo, refreshActiveGroup]);

  const handleSignOut = async () => {
    setProfileModalOpen(false);
    setActiveGroupId(null);
    setActiveGroupData(null);
    if (demoMode) {
      setDemoMode(false);
      setInviteState(null);
      return;
    }
    await supabase.auth.signOut().catch(() => {});
    setSession(null);
  };

  const handleStartDemo = () => {
    setDemoUserId(DEMO_USERS[0].id);
    setInviteState(null);
    setDemoMode(true);
  };

  const handleSwitchDemoUser = (nextId: string) => {
    if (nextId === demoUserId) return;
    demoUserRef.current = nextId;
    setDemoUserId(nextId);
    setInviteState(null);
    if (activeGroupId) {
      // Se il nuovo utente demo non appartiene al gruppo aperto, torna alla lista gruppi
      void demoRepo
        .getGroupData(activeGroupId)
        .then((d) => {
          const isMember = d.members.some((m) => m.userId === nextId && m.leftAt === null);
          if (!isMember) {
            setActiveGroupId(null);
            setActiveGroupData(null);
          }
        })
        .catch(() => {
          setActiveGroupId(null);
          setActiveGroupData(null);
        });
    }
  };

  const handleResetDemo = () => {
    resetDemoDatabase();
    setInviteState(null);
    if (activeGroupId) {
      void refreshActiveGroup(activeGroupId, { silent: true });
    }
    void loadHome();
    pushToast('Dati di esempio ripristinati');
  };

  if (!authReady && !demoMode) {
    return (
      <div className="center-loader" style={{ minHeight: '100dvh' }}>
        <AppLogo size={36} />
        <span className="spinner" />
      </div>
    );
  }

  // Recupero password in corso
  if (recoveryMode) {
    return (
      <AuthView
        initialMode="reset_password"
        pendingInviteToken={pendingInviteToken}
        onStartDemo={handleStartDemo}
        onPasswordResetDone={() => {
          setRecoveryMode(false);
          if (window.location.hash) {
            window.history.replaceState({}, '', window.location.pathname + window.location.search);
          }
          setAuthNotice('Password aggiornata con successo.');
          pushToast('Password aggiornata con successo');
        }}
      />
    );
  }

  // Utente non autenticato
  if (!currentUserId) {
    return (
      <AuthView
        pendingInviteToken={pendingInviteToken}
        authNotice={authNotice}
        initialError={authError}
        onStartDemo={handleStartDemo}
        onPasswordResetDone={() => setRecoveryMode(false)}
      />
    );
  }

  const displayProfile: UserProfile = profile ?? {
    id: currentUserId,
    email: session?.user?.email ?? '',
    displayName: 'Account',
    createdAt: '',
  };

  return (
    <div className="app-shell">
      {demoMode && (
        <div className="demo-banner">
          <div className="demo-banner-inner">
            <div className="demo-switcher">
              <strong style={{ marginRight: 2 }}>Anteprima demo</strong>
              <span>· Vedi come:</span>
              {DEMO_USERS.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={`demo-chip ${demoUserId === u.id ? 'active' : ''}`}
                  onClick={() => handleSwitchDemoUser(u.id)}
                >
                  {u.displayName}
                </button>
              ))}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={handleResetDemo}
              >
                <RotateCcw size={12} /> Ripristina dati
              </button>
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 12.5 }}
                onClick={handleSignOut}
              >
                Usa il tuo account →
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="topbar">
        <div className="topbar-inner">
          <button
            type="button"
            className="brand brand-btn"
            onClick={() => {
              setActiveGroupId(null);
              setActiveGroupData(null);
              void loadHome();
            }}
          >
            <AppLogo size={26} />
            <span>Conti Insieme</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ paddingRight: 8, paddingLeft: 6 }}
            onClick={() => setProfileModalOpen(true)}
            aria-label="Apri profilo account"
          >
            <Avatar name={displayProfile.displayName} seed={displayProfile.id} size={26} />
            <span style={{ fontWeight: 550 }}>{displayProfile.displayName}</span>
          </button>
        </div>
      </header>

      <main style={{ flex: 1 }}>
        {activeGroupId ? (
          loadingGroup || !activeGroupData ? (
            <div className="center-loader">
              <span className="spinner" />
              <span>Caricamento del gruppo…</span>
            </div>
          ) : (
            <GroupView
              repo={repo}
              data={activeGroupData}
              allGroups={groups}
              currentUserId={currentUserId}
              onBack={() => {
                setActiveGroupId(null);
                setActiveGroupData(null);
                void loadHome();
              }}
              onNavigateGroup={(targetId) => {
                setActiveGroupId(targetId);
              }}
              onRefreshGroup={async () => {
                await Promise.all([
                  refreshActiveGroup(activeGroupId, { silent: true }),
                  loadHome({ silent: true }),
                ]);
              }}
              onGroupLeft={(deleted) => {
                setActiveGroupId(null);
                setActiveGroupData(null);
                void loadHome();
                pushToast(deleted ? 'Gruppo eliminato' : 'Hai lasciato il gruppo');
              }}
              onToast={pushToast}
            />
          )
        ) : (
          <GroupsHomeView
            groups={groups}
            loading={loadingGroups}
            schemaMissing={schemaMissing}
            isDemo={demoMode}
            currentUserId={currentUserId}
            onRetryLoad={() => void loadHome()}
            onSelectGroup={(id) => setActiveGroupId(id)}
            onCreateGroup={async (params) => {
              const created = await repo.createGroup(params);
              await loadHome();
              setActiveGroupId(created.id);
              pushToast(`Gruppo "${created.name}" creato`);
            }}
            pendingInvite={inviteState}
            onInspectInviteToken={(token) => void inspectInviteToken(token)}
            onAcceptInvite={async (token) => {
              const joinedGroupId = await repo.acceptInvite(token);
              if (!demoMode) {
                clearPendingInviteToken();
                setPendingInviteToken(null);
              }
              setInviteState(null);
              await loadHome();
              setActiveGroupId(joinedGroupId);
              pushToast('Invito accettato! Sei nel gruppo.');
            }}
            onDeclineInvite={() => {
              if (!demoMode) {
                clearPendingInviteToken();
                setPendingInviteToken(null);
              }
              setInviteState(null);
            }}
            onToast={pushToast}
          />
        )}
      </main>

      <ProfileModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        profile={displayProfile}
        isDemo={demoMode}
        onUpdateName={async (newName) => {
          const updated = await repo.updateProfileName(displayProfile.id, newName);
          setProfile(updated);
          if (activeGroupId) {
            await refreshActiveGroup(activeGroupId, { silent: true });
          } else {
            await loadHome();
          }
        }}
        onSignOut={handleSignOut}
        onToast={pushToast}
      />

      {toasts.length > 0 && (
        <div className="toast-container" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.isError ? 'toast-error' : ''}`}>
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
