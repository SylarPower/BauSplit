import { Check, Copy, Database, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import schemaSql from '../../supabase/schema.sql?raw';
import { getAppBaseUrl, getSupabaseProjectRef } from '../lib/supabase';

interface SetupGuideCardProps {
  onRetry: () => void;
  retrying: boolean;
}

export function SetupGuideCard({ onRetry, retrying }: SetupGuideCardProps) {
  const [copied, setCopied] = useState(false);
  const [showSql, setShowSql] = useState(false);

  const projectRef = getSupabaseProjectRef();
  const sqlEditorUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
    : 'https://supabase.com/dashboard';
  const authUrlsConfig = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/auth/url-configuration`
    : 'https://supabase.com/dashboard';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(schemaSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setShowSql(true);
    }
  };

  return (
    <div className="card card-pad form-stack">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          className="cat-icon-box"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Database size={20} />
        </span>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 650 }}>
            Inizializza le tabelle di Conti Insieme su Supabase
          </h2>
          <p className="field-hint">
            Operazione da fare una sola volta (richiede circa 30 secondi).
          </p>
        </div>
      </div>

      <ol
        style={{
          margin: 0,
          paddingLeft: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          fontSize: 14,
          color: 'var(--text-secondary)',
        }}
      >
        <li>
          Clicca su <strong>Copia script SQL</strong> qui sotto (contiene lo stesso codice di{' '}
          <code>supabase/schema.sql</code>).
        </li>
        <li>
          Apri il{' '}
          <a href={sqlEditorUrl} target="_blank" rel="noreferrer">
            SQL Editor del tuo progetto Supabase <ExternalLink size={13} />
          </a>
          , incolla lo script e premi <strong>Run</strong>.
        </li>
        <li>
          In{' '}
          <a href={authUrlsConfig} target="_blank" rel="noreferrer">
            Authentication → URL Configuration <ExternalLink size={13} />
          </a>
          , imposta come <strong>Site URL</strong> l&apos;indirizzo del sito (es.{' '}
          <code>{getAppBaseUrl()}</code>) e aggiungilo anche in <strong>Redirect URLs</strong> così i
          link di verifica email e recupero password riporteranno qui.
        </li>
      </ol>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={handleCopy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Script SQL copiato!' : 'Copia script SQL'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onRetry} disabled={retrying}>
          <RefreshCw size={15} />
          {retrying ? 'Verifica in corso…' : 'Ho eseguito lo script — riprova'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setShowSql((v) => !v)}
        >
          {showSql ? 'Nascondi codice' : 'Mostra codice SQL'}
        </button>
      </div>

      {showSql && <pre className="sql-preview">{schemaSql}</pre>}
    </div>
  );
}
