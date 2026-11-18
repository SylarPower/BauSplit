import { Check, Copy, Link2Off, RefreshCw, Share2 } from 'lucide-react';
import { useState } from 'react';
import { buildInviteUrl, translateErrorIT } from '../lib/supabase';
import type { ExpenseGroup } from '../types';
import { Modal } from './Modal';

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  group: ExpenseGroup;
  onRegenerate: () => Promise<void>;
  onToggleEnabled: (enabled: boolean) => Promise<void>;
  onToast: (msg: string, isError?: boolean) => void;
}

export function InviteModal({
  open,
  onClose,
  group,
  onRegenerate,
  onToggleEnabled,
  onToast,
}: InviteModalProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const inviteUrl = buildInviteUrl(group.inviteToken);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      onToast("Link d'invito copiato");
      setTimeout(() => setCopied(false), 2200);
    } catch {
      onToast('Seleziona e copia il link dal campo di testo.', true);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({
        title: `Invito al gruppo "${group.name}" — BauSplit`,
        text: `Unisciti al gruppo "${group.name}" su BauSplit:`,
        url: inviteUrl,
      });
    } catch {
      // Utente ha chiuso il foglio di condivisione
    }
  };

  const handleRegenerate = async () => {
    setBusy(true);
    try {
      await onRegenerate();
      setConfirmRegen(false);
      onToast('Nuovo link generato. Il link precedente non è più valido.');
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async () => {
    setBusy(true);
    try {
      const next = !group.inviteEnabled;
      await onToggleEnabled(next);
      onToast(next ? "Link d'invito riattivato" : "Link d'invito disattivato");
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`Invita in "${group.name}"`}
      onClose={() => {
        setConfirmRegen(false);
        onClose();
      }}
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Chiudi
        </button>
      }
    >
      <div className="form-stack">
        <p className="text-secondary" style={{ fontSize: 14 }}>
          Invia questo link alla persona che vuoi aggiungere (ad esempio su WhatsApp o Telegram).
          Chi lo apre può proseguire senza account: sceglie il proprio nome e deve <strong>accettare l’invito</strong> prima di vedere le spese. Condividilo solo con le persone del gruppo.
        </p>

        {group.inviteEnabled ? (
          <>
            <div className="field">
              <span className="field-label">
                <span>Link d&apos;invito attivo</span>
                <span className="badge badge-positive">Riutilizzabile</span>
              </span>
              <input
                type="text"
                className="input"
                value={inviteUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={handleCopy}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copiato!' : 'Copia link'}
              </button>

              {canNativeShare && (
                <button type="button" className="btn btn-secondary" onClick={handleShare}>
                  <Share2 size={15} />
                  Condividi
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="alert alert-warning">
            <Link2Off size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Il link d&apos;invito è attualmente disattivato: nessuno può unirsi al gruppo finché
              non lo riattivi.
            </span>
          </div>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Gestione sicurezza del link</div>

          {confirmRegen ? (
            <div className="fx-box">
              <div style={{ fontSize: 13.5 }}>
                Generare un nuovo link? Il link attuale smetterà subito di funzionare (i membri già
                presenti resteranno nel gruppo).
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleRegenerate}
                  disabled={busy}
                >
                  Conferma rigenerazione
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirmRegen(false)}
                  disabled={busy}
                >
                  Annulla
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmRegen(true)}
                disabled={busy}
              >
                <RefreshCw size={14} />
                Rigenera link
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleToggle}
                disabled={busy}
              >
                <Link2Off size={14} />
                {group.inviteEnabled ? 'Disattiva link' : 'Riattiva link'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
