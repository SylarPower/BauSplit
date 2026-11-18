import { LogOut } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { supabase, translateErrorIT } from '../lib/supabase';
import type { UserProfile } from '../types';
import { Avatar } from './Icon';
import { Modal } from './Modal';

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  isDemo: boolean;
  onUpdateName: (newName: string) => Promise<void>;
  onSignOut: () => void;
  onToast: (msg: string, isError?: boolean) => void;
}

export function ProfileModal({
  open,
  onClose,
  profile,
  isDemo,
  onUpdateName,
  onSignOut,
  onToast,
}: ProfileModalProps) {
  const [name, setName] = useState(profile.displayName);
  const [savingName, setSavingName] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(profile.displayName);
      setNewPassword('');
      setConfirmPassword('');
      setPwdError(null);
    }
  }, [open, profile.displayName]);

  const handleSaveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingName(true);
    try {
      await onUpdateName(name.trim());
      onToast('Nome aggiornato');
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    if (newPassword.length < 8) {
      setPwdError('La nuova password deve avere almeno 8 caratteri.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('Le due password non coincidono.');
      return;
    }
    setSavingPwd(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPwdError(translateErrorIT(error));
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
      onToast('Password aggiornata con successo');
    } catch (err) {
      setPwdError(translateErrorIT(err));
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Il tuo account"
      onClose={onClose}
      footerBetween
      footer={
        <>
          <button type="button" className="btn btn-danger" onClick={onSignOut}>
            <LogOut size={15} />
            {isDemo ? 'Esci dalla demo' : 'Esci'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Chiudi
          </button>
        </>
      }
    >
      <div className="form-stack">
        <div
          className="card-subtle"
          style={{ display: 'flex', alignItems: 'center', gap: 12 }}
        >
          <Avatar name={profile.displayName} seed={profile.id} size={42} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 15 }}>{profile.displayName}</div>
            <div
              className="text-secondary"
              style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {profile.email}
            </div>
          </div>
        </div>

        <form className="form-stack" onSubmit={handleSaveName}>
          <label className="field">
            <span className="field-label">Nome visualizzato nei gruppi</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="input"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingName || name.trim() === profile.displayName || !name.trim()}
              >
                {savingName ? 'Salvo…' : 'Salva'}
              </button>
            </div>
          </label>
        </form>

        {!isDemo && (
          <>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '2px 0' }} />
            <form className="form-stack" onSubmit={handleChangePassword}>
              <div style={{ fontSize: 14, fontWeight: 650 }}>Cambia password</div>
              {pwdError && <div className="alert alert-error">{pwdError}</div>}
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Nuova password</span>
                  <input
                    type="password"
                    className="input"
                    placeholder="Min. 8 caratteri"
                    autoComplete="new-password"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Conferma</span>
                  <input
                    type="password"
                    className="input"
                    placeholder="Ripeti password"
                    autoComplete="new-password"
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </label>
              </div>
              <div>
                <button
                  type="submit"
                  className="btn btn-secondary"
                  disabled={savingPwd || !newPassword}
                >
                  {savingPwd ? 'Aggiornamento…' : 'Aggiorna password'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}
