# Conti Insieme

Web app responsive e PWA minimal in italiano per gestire **spese condivise**, **saldi semplificati** e **rimborsi** in stile Splitwise/Tricount, collegata a **Supabase** (Auth + PostgreSQL con Row Level Security + Realtime) e pronta per **GitHub Pages**.

## Funzionalità principali

- **Account con email e password**: registrazione con verifica dell'indirizzo email (con reinvio del link), accesso, recupero/reimpostazione password e modifica del nome visualizzato. Nessuna email promozionale o notifica di attività.
- **Gruppi privati con invito tramite link**: link riutilizzabile, rigenerabile e disattivabile da qualsiasi membro. Chi apre il link visualizza prima l'anteprima e deve accettare esplicitamente per entrare. Qualsiasi membro può uscire dal gruppo in ogni momento, anche con saldo diverso da zero (il saldo aperto resta visibile e saldabile).
- **Chiusura gruppo e spostamento del saldo rimanente**: alla fine di un viaggio o di un progetto puoi chiudere il gruppo e spostare automaticamente il saldo residuo in un altro gruppo attivo che contenga tutti gli utenti coinvolti in quel saldo (con conversione valutaria automatica o manuale se le valute base sono diverse, senza alterare gli Insights di spesa). I gruppi chiusi restano consultabili, esportabili in CSV e riapribili.
- **Spese e ripartizioni al centesimo**: un pagante per spesa, partecipanti selezionabili e divisione in **parti uguali**, **per importi esatti** o **per percentuali**, con nota opzionale.
- **Spese ricorrenti**: programmazione automatica (settimanale, bisettimanale, mensile, bimestrale, trimestrale, annuale) con pausa/riattivazione, modifica e registrazione immediata.
- **Multi-valuta**: valuta di riferimento per gruppo (`EUR` predefinita), recupero automatico del tasso BCE alla data della spesa, modifica manuale e salvataggio permanente senza aggiornamenti retroattivi. Selettore dedicato per **visualizzare i saldi** in un'altra valuta senza modificare la contabilità del gruppo.
- **Saldi semplificati e rimborsi**: calcolo automatico del numero minimo di pagamenti per tornare in pari; i rimborsi registrati aggiornano subito i saldi senza conferma del destinatario.
- **Categorie, ricerca, filtri ed esportazione CSV**: 12 categorie predefinite + categorie personalizzabili per gruppo, filtri combinabili ed esportazione CSV compatibile con Excel, Numbers e Google Fogli.
- **Insights**: riepilogo dell'intero gruppo o di un intervallo di date con totale, numero di spese, spesa media, ripartizione per categoria, per chi ha anticipato il denaro, quota effettiva per persona e andamento mensile (rimborsi esclusi dai totali).
- **Storico modifiche**: registro completo e non modificabile di chi ha fatto cosa e quando, con differenze prima/dopo sulle modifiche e riepilogo degli elementi eliminati.

## Configurazione iniziale (una tantum)

### 1. Database e RLS su Supabase

1. Apri il **SQL Editor** del progetto Supabase (`mwicplgacecjaeyzbuhx`).
2. Copia e incolla l'intero contenuto di [`supabase/schema.sql`](./supabase/schema.sql) e premi **Run**.
   *(Se accedi all'app prima di farlo, Conti Insieme mostra automaticamente una guida con il pulsante **Copia script SQL**.)*

### 2. URL di verifica email e recupero password su Supabase

1. In Supabase vai su **Authentication → URL Configuration**.
2. Imposta **Site URL** su `https://sylarpower.github.io/todolist/`.
3. In **Redirect URLs** aggiungi `https://sylarpower.github.io/todolist/**`.
4. Assicurati che in **Authentication → Providers → Email** sia attiva l'opzione **Confirm email**.

### 3. Pubblicazione su GitHub Pages

La versione pronta per la pubblicazione viene compilata nella cartella [`docs/`](./docs) (incluso `.nojekyll`):
1. Nelle impostazioni del repository GitHub vai su **Settings → Pages**.
2. In **Build and deployment → Source** lascia **Deploy from a branch**.
3. Sotto **Branch**, seleziona **`main`** e nel menu accanto seleziona **`/docs`**, poi premi **Save**.
4. L'app è subito disponibile su `https://sylarpower.github.io/todolist/`.

## Sviluppo locale

```bash
npm install
npm run dev      # avvia il server di sviluppo
npm test         # esegue i test automatici su contabilità, cambi, ricorrenze, chiusura gruppi e CSV
npm run build    # compila la versione di produzione aggiornata in docs/
```

Per usare un progetto Supabase diverso è sufficiente creare un file `.env.local` con `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
