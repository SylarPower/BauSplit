import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Globe2,
  Link2,
  PawPrint,
  ReceiptText,
  Scale,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { guestClient, translateErrorIT } from '../lib/supabase';
import { AppLogo } from './Icon';
import { Modal } from './Modal';

const steps = [
  {
    icon: Users,
    title: 'Forma il gruppo',
    text: 'Scegli un nome per il gruppo, aggiungi le persone e condividi l’invito con un link.',
  },
  {
    icon: ReceiptText,
    title: 'Annota le spese',
    text: 'Segna chi ha pagato e dividi il totale in parti uguali, per importi o per percentuali.',
  },
  {
    icon: Scale,
    title: 'Regola i conti',
    text: 'Vedi chi deve a chi, anche in un’altra valuta. Registra i rimborsi e tornate in pari.',
  },
];

export function Welcome({
  hasInvite,
  onAccount,
}: {
  hasInvite: boolean;
  onAccount: (mode: 'login' | 'signup') => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function startGuest() {
    setError('');
    setBusy(true);
    try {
      // Senza spazio persistente un ospite perderebbe l'accesso chiudendo la pagina.
      try {
        localStorage.setItem('bausplit:check', '1');
        localStorage.removeItem('bausplit:check');
      } catch {
        throw new Error(
          'Per ricordare i tuoi gruppi, consenti al browser di salvare i dati del sito. In alternativa usa un account.'
        );
      }
      const { error: err } = await guestClient.auth.signInAnonymously({
        options: { data: { display_name: name.trim() || 'Ospite' } },
      });
      if (err) throw err;
    } catch (err) {
      setError(translateErrorIT(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="welcome">
      <header className="welcome-nav">
        <div className="welcome-width">
          <span className="wordmark">
            <AppLogo size={34} /> BauSplit
          </span>
          <nav aria-label="Navigazione principale">
            <a href="#come-funziona">Come funziona</a>
            <button className="welcome-login" onClick={() => onAccount('login')}>
              Accedi <ArrowUpRight size={15} />
            </button>
          </nav>
        </div>
      </header>
      <main className="welcome-width welcome-main">
        <section className="welcome-hero">
          <div className="welcome-copy">
            <p className="eyebrow">
              <span className="eyebrow-line" />{' '}
              {hasInvite ? 'INVITO PRIVATO' : 'IL TACCUINO DELLE SPESE'}
            </p>
            <h1>
              {hasInvite ? 'Un invito per te.' : 'Dividi le spese.'}
              <br />
              <em>{hasInvite ? 'Entra nel gruppo.' : 'Non il branco.'}</em>
            </h1>
            <p className="welcome-lead">
              {hasInvite
                ? 'Apri l’invito per vedere il gruppo. Sceglierai il tuo nome prima di accettare, anche senza account.'
                : 'Una cena, un viaggio, una casa condivisa. Tieni traccia delle spese e scopri chi deve a chi, senza complicazioni.'}
            </p>
            <div className="welcome-actions">
              <button
                className="welcome-primary"
                disabled={busy}
                onClick={() => (hasInvite ? void startGuest() : setFormOpen(true))}
              >
                {busy
                  ? 'Apertura…'
                  : hasInvite
                    ? 'Apri l’invito senza account'
                    : 'Inizia senza account'}{' '}
                <ArrowRight size={17} />
              </button>
              <button className="welcome-secondary" onClick={() => onAccount('signup')}>
                Crea un account
              </button>
            </div>
            <p className="welcome-note">
              <Check size={15} /> Nessuna email per iniziare
            </p>
            {!formOpen && error && (
              <p role="alert" className="alert alert-error">
                {error}
              </p>
            )}
          </div>
          <figure className="welcome-art">
            <img
              className="companion-art"
              src="./compagno.webp"
              alt="Un terrier con un fazzoletto verde porta uno scontrino."
              width="900"
              height="675"
            />
            <figcaption>IL COMPAGNO DI CONTI</figcaption>
          </figure>
        </section>
        <section id="come-funziona" aria-labelledby="steps-title" className="welcome-steps">
          <h2 id="steps-title" className="eyebrow">
            COME FUNZIONA <span />
          </h2>
          <div className="step-list">
            {steps.map(({ icon: Icon, title, text }, i) => (
              <article key={title} className="step-card">
                <div className="step-meta">
                  <span className="step-icon">
                    <Icon size={21} strokeWidth={1.65} />
                  </span>
                  <span>0{i + 1} / 03</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="welcome-footer welcome-width">
        <span>
          <PawPrint size={15} /> BauSplit <i>/</i> Spese condivise
        </span>
        <span>
          <Globe2 size={14} /> Italiano
        </span>
      </footer>
      <Modal
        open={formOpen}
        title="Inizia senza account"
        onClose={() => {
          if (!busy) {
            setFormOpen(false);
            setError('');
          }
        }}
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void startGuest();
          }}
        >
          <label className="field">
            <span className="field-label">Come ti chiami?</span>
            <input
              className="input"
              placeholder="Nome o soprannome"
              autoComplete="given-name"
              autoFocus
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="field-hint">
            Le spese sono condivise online. Questo browser ricorda i tuoi gruppi; potrai collegarli
            a un account in qualsiasi momento.
          </p>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-lg" disabled={busy || !name.trim()}>
            {busy ? 'Apertura…' : 'Continua senza account'} <ArrowRight size={16} />
          </button>
          <button type="button" className="link-btn" onClick={() => onAccount('login')}>
            <Link2 size={13} /> Usa il tuo account
          </button>
        </form>
      </Modal>
    </div>
  );
}
