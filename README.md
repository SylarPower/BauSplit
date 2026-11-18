# BauSplit

Il taccuino delle spese di gruppo, in italiano. Funziona sul telefono e sul computer e si può aggiungere alla schermata Home. Indirizzo di pubblicazione: **https://sylarpower.github.io/BauSplit/**.

## Usare BauSplit

- **Senza account:** premi **Inizia senza account**, scrivi come ti chiami e crea un gruppo. Puoi aggiungere i nomi degli altri subito, uno per riga, o più tardi nelle impostazioni del gruppo. Puoi già assegnare loro spese e quote, senza conoscere la loro email.
- **Condividere:** premi **Invita** e manda il link solo alle persone del gruppo. Chi lo apre vede prima un riepilogo, sceglie un nome libero oppure ne scrive uno nuovo, poi preme **Accetta ed entra nel gruppo**. Scegliendo un nome esistente ritrova le quote già registrate per quella persona. Aprire o rifiutare un invito non dà accesso alle spese. I membri possono disattivare o sostituire il link.
- **Ritrovare i gruppi:** le spese sono condivise su Supabase, non conservate soltanto sul telefono. Il browser ricorda l’accesso ospite e l’elenco dei gruppi; per vedere o modificare i conti serve Internet. Senza un account, **non cancellare i dati del sito e non usare una finestra privata** se vuoi conservare il tuo accesso.
- **Con un account facoltativo:** ospiti e persone con email e password possono stare nello stesso gruppo. Da **I tuoi gruppi → Collega un account** puoi accedere o registrarti. Conferma l’email e accedi **nello stesso browser usato come ospite**: i gruppi vengono collegati automaticamente, anche quelli chiusi. Da allora li ritrovi anche su altri dispositivi. Se apri l’email su un altro telefono, basta poi accedere sul primo. Non occorre accettare di nuovo gli inviti.
- **Se eri già nello stesso gruppo con due nomi:** resta attivo il posto che avevi con l’account; le quote del precedente nome ospite restano visibili e saldabili, non vengono cancellate o sommate di nascosto. Il collegamento non ti fa rientrare nei gruppi che hai lasciato.

## Cosa puoi fare nei gruppi

- Dividere una spesa in **parti uguali, importi esatti o percentuali**, scegliendo pagante e partecipanti. Programmare spese ricorrenti, metterle in pausa o registrarle subito; le scadenze maturate vengono registrate all’apertura del gruppo.
- Usare più valute. Se il gruppo è in euro e paghi in yen, premi **Inverti cambio** per scrivere **1 EUR = 160 JPY**: una spesa da 1.600 ¥ vale 10 €. Il pulsante cambia solo il modo di leggere o scrivere il tasso, non la valuta, l’importo o il cambio salvato. Lo trovi anche nei rimborsi, nelle ricorrenze e quando sposti un saldo tra gruppi con valute diverse. Nelle ricorrenze lascia vuoto il cambio fisso per usare quello automatico alla scadenza. La valuta in cui leggi i saldi si sceglie separatamente.
- I nuovi gruppi partono con 11 categorie, in quest’ordine: **Spesa, Ristoranti e bar, Casa, Trasporti, Viaggi, Svago, Shopping, Salute, Abbonamenti, Regali, Altro**. I nomi scelti dal gruppo hanno la precedenza. «Bollette e utenze» non è più predefinita: le spese e le ricorrenze che la usavano restano nella loro categoria, senza essere spostate in «Casa».
- Da **Impostazioni del gruppo → Categorie del gruppo**, apri l’elenco e premi la matita per cambiare nome, icona o colore di qualsiasi categoria, anche predefinita. Usa le frecce per riordinarle. Il nuovo nome compare anche sulle **vecchie spese**, nelle ricerche, nei filtri, nelle ricorrenze, negli **Insights** e nel **CSV** di quel gruppo. Nello storico rimangono sia il nome di allora sia la successiva rinomina.
- Per il colore hai le stesse scelte nelle impostazioni e da **Nuova spesa → Categoria → Nuova**: 10 colori pronti (verde acqua, blu, viola, rosa, rosso, arancione, giallo, verde, marrone e grigio) oppure **Colore personalizzato** per scegliere qualsiasi tonalità. I colori già salvati restano come sono, anche se non sono tra i dieci.
- Se una categoria non ti serve più, scegli **Nascondi dalle nuove spese**: potrai renderla visibile di nuovo, senza perdere movimenti né interrompere le ricorrenze. Puoi eliminare una categoria personalizzata se nessuna spesa o ricorrenza la usa. Almeno una categoria deve restare visibile. I rimborsi restano esclusi dai totali di spesa degli Insights.
- Registrare rimborsi e uscire anche con un saldo aperto. Se restano altri partecipanti, il saldo rimane visibile e saldabile. L’ultimo partecipante viene avvisato prima di eliminare il gruppo.
- Chiudere e riaprire un gruppo. Puoi lasciarvi i saldi oppure spostarli in un altro gruppo attivo dove sono presenti **tutte le persone coinvolte**, anche con una valuta diversa. Conta la persona che ha scelto il posto in entrambi i gruppi, non la semplice coincidenza fra due nomi. I gruppi chiusi rimangono consultabili ed esportabili.

## Mettere BauSplit online, passo per passo

### 1. Aggiorna il tuo progetto Supabase

**Se usi già la versione con le 11 categorie modificabili**, il nuovo selettore colori non richiede aggiornamenti su Supabase: passa al punto 3.

1. Apri il progetto che contiene già le tue spese (`mwicplgacecjaeyzbuhx`, se usi quello impostato nell’app). **Non creare un nuovo progetto e non cancellare tabelle.** Se contiene dati importanti, fai prima una copia di sicurezza.
2. In questa versione del repository apri [**supabase/schema.sql**](./supabase/schema.sql) e copia **tutto** il contenuto del file.
3. Nel progetto Supabase apri [**SQL Editor → New query**](https://supabase.com/dashboard/project/mwicplgacecjaeyzbuhx/sql/new), incolla il testo e premi **Run**. Se Supabase chiede se aggiungere regole di accesso automatiche, scegli **Run without RLS** per questo script completo: contiene già le regole che proteggono i gruppi. Aspetta la conferma di successo prima di proseguire. Questo aggiorna i gruppi esistenti senza ricreare conti, quote e cambi; puoi eseguirlo anche su un progetto vuoto. Se l’app rileva che manca l’aggiornamento, offre lo stesso file con **Copia script SQL**.

Se gli accessi funzionavano già nella versione precedente, non devi riconfigurarli per usare categorie e cambio: passa al punto 3.

### 2. Permetti entrambi i modi di entrare

1. In **Authentication → Sign In / Providers** abilita **Allow new users to sign up** e **Allow anonymous sign-ins**. La seconda opzione è quella che permette di entrare senza email. Salva.
2. Nella stessa sezione attiva **Email** e **Confirm email**: chi si registra deve confermare l’indirizzo. Per mandare conferme e recuperi password anche a persone esterne al tuo team, imposta il tuo servizio di posta in **Authentication → Emails → SMTP Settings**. I dati del servizio di posta vanno **solo** in Supabase, mai nei file del sito.
3. In **Authentication → URL Configuration** imposta **Site URL** su `https://sylarpower.github.io/BauSplit/`. In **Redirect URLs** aggiungi `https://sylarpower.github.io/BauSplit/` e `https://sylarpower.github.io/BauSplit/**`. Salva. Così anche un’email aperta durante un invito riporta al posto giusto. Rispetta le maiuscole di **BauSplit**.

### 3. Pubblica la cartella già pronta

1. Porta questa versione sul ramo principale **`main`** del repository **SylarPower/BauSplit**, includendo l’intera cartella [**docs/**](./docs). Se le modifiche sono su un ramo di lavoro, usa su GitHub **Compare & pull request → Create pull request → Merge pull request → Confirm merge** verso `main`. Per questa versione non devi compilare nulla sul tuo computer.
2. Nel repository apri **Settings → Pages**. In **Source** scegli **Deploy from a branch**; nei due menu sotto scegli **`main`** e **`/docs`**. Premi **Save**.
3. Attendi il messaggio **Your site is live** (può volerci qualche minuto), poi apri **https://sylarpower.github.io/BauSplit/**.

### 4. Fai una prova con due dispositivi

Sul primo entra senza account, crea un gruppo con un secondo nome e registra una spesa condivisa. Manda l’invito al secondo dispositivo: prima di accettare non deve mostrare le spese. Scegli il secondo nome, accetta e controlla che la spesa sia già lì. Registra un rimborso e controlla i saldi su entrambi. Infine, sul primo dispositivo scegli **Collega un account**, conferma l’email e verifica che il gruppo compaia una sola volta anche dopo un nuovo accesso. Puoi provare **Password dimenticata?** dalla schermata **Accedi**.

## Per chi modifica il codice

```sh
npm ci
npm run dev      # sviluppo locale
npm test         # contabilità, ricorrenze, cambi, CSV, inviti, accessi e collegamento dei gruppi
npm run build    # aggiorna docs/ (compreso .nojekyll); includila nella pubblicazione
```

I dieci suggerimenti in [src/lib/categories.ts](./src/lib/categories.ts) riprendono le famiglie cromatiche di [Tableau 10](https://github.com/d3/d3-scale-chromatic/blob/5bcfc81318aba0fd760b33f8ad44bb068a074239/src/categorical/Tableau10.js) in tonalità presenti nel [selettore colori di Actual Budget](https://github.com/actualbudget/actual/blob/d05bd031fa6d6be2b60f9d47ca45c1dad9f27acf/packages/component-library/src/ColorPicker.tsx). Sono scelte per distinguere categorie, non nuovi colori assegnati ai gruppi.

I test dello schema usano PostgreSQL locale in memoria (PGlite), non il progetto online. Per usare un altro progetto imposta `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` in `.env.local` prima della compilazione: usa **solo la chiave pubblica**. L’accesso ai gruppi è controllato su Supabase, mai dall’elenco salvato nel browser. Gli accessi ospite e account restano separati finché entrambi autorizzano il collegamento; le spese fanno riferimento a posti stabili nel gruppo, non alle credenziali.
