import { Copy } from 'lucide-react';
import { useState } from 'react';
import { Modal } from './Modal';

export function CopyEventSummary({ text, onCopied }: { text: string; onCopied: () => void }) {
  const [manual, setManual] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            onCopied();
          } catch {
            setManual(true);
          }
        }}
      >
        <Copy size={15} /> Copia riepilogo
      </button>
      {manual && (
        <Modal open title="Copia riepilogo" onClose={() => setManual(false)}>
          <label className="field">
            <span className="field-label">Seleziona e copia il testo per la chat</span>
            <textarea
              autoFocus
              readOnly
              className="input"
              rows={7}
              value={text}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
        </Modal>
      )}
    </>
  );
}
