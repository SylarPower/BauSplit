import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readDeviceGroups, saveDeviceGroups, type DeviceGroup } from '../lib/deviceGroups';
import { groupRoleFor } from '../lib/groupAccess';
import { processDueRecurringExpenses, SupabaseRepository } from '../lib/repository';
import {
  clearPendingInviteToken,
  guestClient,
  isMissingSchemaError,
  storePendingInviteToken,
  supabase,
  translateErrorIT,
} from '../lib/supabase';
import type { GroupData, GroupOverview, InvitePreview, UserProfile } from '../types';
import { GroupsHomeView } from './GroupsHomeView';
import { GroupView } from './GroupView';
import { AppLogo, Avatar } from './Icon';
import { ProfileModal } from './ProfileModal';

interface InviteState {
  token: string;
  loading: boolean;
  preview: InvitePreview | null;
  error?: string;
}

export function Workspace({
  session,
  isGuest,
  invite,
  onInviteChange,
  onOpenAccount,
}: {
  session: Session;
  isGuest: boolean;
  invite: string | null;
  onInviteChange: (token: string | null) => void;
  onOpenAccount: () => void;
}) {
  const uid = session.user.id;
  const repo = useMemo(() => new SupabaseRepository(isGuest ? guestClient : supabase), [isGuest]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [groups, setGroups] = useState<GroupOverview[]>([]);
  const [bookmarks, setBookmarks] = useState(() => (isGuest ? readDeviceGroups(uid) : []));
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [data, setData] = useState<GroupData | null>(null);
  const [preview, setPreview] = useState<InviteState | null>(null);
  const [inspectAttempt, setInspectAttempt] = useState(0);
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const showToast = useCallback(
    (message: string, isError = false) => setToast({ message, isError }),
    []
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const homeRequest = useRef(0);
  const saveBookmarks = useCallback(
    (list: DeviceGroup[]) => {
      if (isGuest) {
        saveDeviceGroups(uid, list);
        setBookmarks(list);
      }
    },
    [uid, isGuest]
  );
  const remember = (group: DeviceGroup) =>
    saveBookmarks([
      ...bookmarks.filter((g) => g.id !== group.id),
      { id: group.id, name: group.name },
    ]);

  const loadHome = useCallback(async () => {
    const request = ++homeRequest.current;
    setLoading(true);
    try {
      const prof = await repo.ensureProfile();
      const list = await repo.listGroupOverviews(uid);
      if (request !== homeRequest.current) return;
      setProfile(prof);
      setGroups(list);
      setSchemaMissing(false);
      setLoadError(null);
      saveBookmarks(list.map(({ group }) => ({ id: group.id, name: group.name })));
    } catch (err) {
      if (request !== homeRequest.current) return;
      setSchemaMissing(isMissingSchemaError(err));
      setLoadError(translateErrorIT(err));
    } finally {
      if (request === homeRequest.current) setLoading(false);
    }
  }, [repo, uid, saveBookmarks]);

  useEffect(() => {
    void loadHome();
    return () => {
      homeRequest.current++;
    };
  }, [loadHome]);

  useEffect(() => {
    if (!invite || schemaMissing) {
      setPreview(null);
      return;
    }
    let current = true;
    setGroupId(null);
    setPreview({ token: invite, loading: true, preview: null });
    void repo
      .getInvitePreview(invite)
      .then((result) => {
        if (current) setPreview({ token: invite, loading: false, preview: result });
      })
      .catch((err) => {
        if (!current) return;
        if (isMissingSchemaError(err)) setSchemaMissing(true);
        else
          setPreview({
            token: invite,
            loading: false,
            preview: null,
            error: translateErrorIT(err),
          });
      });
    return () => {
      current = false;
    };
  }, [invite, repo, schemaMissing, inspectAttempt]);

  const dismissInvite = () => {
    clearPendingInviteToken();
    onInviteChange(null);
    setPreview(null);
  };
  const groupRequest = useRef(0);
  const refreshGroup = useCallback(
    async (id: string, checkDue = false) => {
      const request = ++groupRequest.current;
      try {
        let result = await repo.getGroupData(id);
        if (request !== groupRequest.current) return;
        if (checkDue && groupRoleFor(result.members, uid) === 'editor') {
          const n = await processDueRecurringExpenses({ repo, actorId: uid, data: result });
          if (n) {
            result = await repo.getGroupData(id);
            if (request === groupRequest.current)
              showToast(
                `${n} ${n === 1 ? 'spesa ricorrente registrata' : 'spese ricorrenti registrate'}`
              );
          }
        }
        if (!result.members.some((m) => m.ownerId === uid && m.leftAt === null))
          throw new Error('Non fai più parte di questo gruppo.');
        if (request === groupRequest.current) setData(result);
      } catch (err) {
        if (request !== groupRequest.current) return;
        showToast(translateErrorIT(err), true);
        setData(null);
        setGroupId(null);
        if (isMissingSchemaError(err)) setSchemaMissing(true);
        else void loadHome();
      }
    },
    [repo, uid, loadHome, showToast]
  );
  useEffect(() => {
    if (!groupId) {
      setData(null);
      return;
    }
    void refreshGroup(groupId, true);
    const unsubscribe = repo.subscribeToGroup(groupId, () => void refreshGroup(groupId));
    return () => {
      groupRequest.current++;
      unsubscribe();
    };
  }, [groupId, repo, refreshGroup]);

  // Riconcilia i segnalibri al ritorno nell'app o quando torna la rete.
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      void loadHome();
      if (groupId) void refreshGroup(groupId);
    };
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [groupId, loadHome, refreshGroup]);

  const defaultName = session.user.user_metadata.display_name;
  const displayProfile = profile ?? {
    id: uid,
    displayName:
      (typeof defaultName === 'string' && defaultName.trim()) || (isGuest ? 'Ospite' : 'Account'),
    email: session.user.email ?? '',
    createdAt: '',
  };
  const mySeat = data?.members.find((m) => m.ownerId === uid && m.leftAt === null);
  const back = () => {
    setGroupId(null);
    void loadHome();
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand brand-btn wordmark" onClick={back}>
            <AppLogo size={30} /> BauSplit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Apri il tuo profilo"
            onClick={() => setProfileOpen(true)}
          >
            <Avatar name={displayProfile.displayName} seed={uid} size={26} />
            {displayProfile.displayName}
          </button>
        </div>
      </header>
      <main style={{ flex: 1 }}>
        {groupId ? (
          data && data.group.id === groupId && mySeat ? (
            <GroupView
              key={groupId}
              repo={repo}
              data={data}
              allGroups={groups}
              actorId={uid}
              currentUserId={mySeat.userId}
              onBack={back}
              onNavigateGroup={setGroupId}
              onRefreshGroup={async () => {
                await Promise.all([refreshGroup(groupId), loadHome()]);
              }}
              onGroupLeft={(deleted) => {
                saveBookmarks(bookmarks.filter((g) => g.id !== groupId));
                back();
                showToast(deleted ? 'Gruppo eliminato' : 'Hai lasciato il gruppo');
              }}
              onToast={showToast}
            />
          ) : (
            <div className="center-loader">
              <span className="spinner" />
              Caricamento del gruppo…
            </div>
          )
        ) : (
          <GroupsHomeView
            groups={groups}
            loading={loading}
            schemaMissing={schemaMissing}
            isGuest={isGuest}
            bookmarks={bookmarks}
            loadError={loadError}
            defaultName={displayProfile.displayName}
            ownerId={uid}
            onCreateQuickEvent={async (input) => {
              const event = await repo.createQuickEvent(input);
              remember(event);
              setGroupId(event.id);
              void loadHome();
              showToast('Serata creata');
            }}
            onAccount={onOpenAccount}
            onRetryLoad={loadHome}
            onSelectGroup={setGroupId}
            pendingInvite={preview}
            onCreateGroup={async (input) => {
              const group = await repo.createGroup(input);
              remember(group);
              setGroupId(group.id);
              void loadHome();
              showToast('Gruppo creato');
            }}
            onInspectInviteToken={(token) => {
              storePendingInviteToken(token);
              onInviteChange(token);
              setInspectAttempt((n) => n + 1);
            }}
            onAcceptInvite={async (token, choice) => {
              const id = await repo.acceptInvite(token, choice);
              remember({ id, name: preview?.preview?.groupName ?? 'Gruppo' });
              dismissInvite();
              setGroupId(id);
              void loadHome();
              showToast(
                preview?.preview?.accessRole === 'viewer'
                  ? 'Sei nel gruppo in sola visualizzazione.'
                  : 'Invito accettato! Sei nel gruppo.'
              );
            }}
            onDeclineInvite={dismissInvite}
            onToast={showToast}
          />
        )}
      </main>
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        profile={displayProfile}
        isGuest={isGuest}
        onUpdateName={async (name) => {
          setProfile(await repo.updateProfileName(uid, name));
          await loadHome();
          if (groupId) await refreshGroup(groupId);
        }}
        onSignOut={async () => {
          const result = await supabase.auth.signOut({ scope: 'local' });
          if (result.error) showToast(translateErrorIT(result.error), true);
        }}
        onOpenAccount={onOpenAccount}
        onToast={showToast}
      />
      {toast && (
        <div className="toast-container" role="status">
          <div className={`toast ${toast.isError ? 'toast-error' : ''}`}>{toast.message}</div>
        </div>
      )}
    </div>
  );
}
