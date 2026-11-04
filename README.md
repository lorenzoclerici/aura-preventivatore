# Preventivatore Aura Automotive

Pagina web per compilare la proposta economica e generare il PDF.
La pagina è `index.html`; lo **storico condiviso** dei preventivi usa le funzioni nella cartella `api/`.

Senza la configurazione qui sotto il preventivatore funziona lo stesso, ma **senza storico** e con il numero
progressivo salvato solo nel browser di chi lo usa.

## Come funziona lo storico

- Ogni volta che si preme **Genera PDF** il preventivo viene salvato nello storico e riceve un **numero unico**
  (`AAAA-NNN`) assegnato dal server: due consulenti non possono avere lo stesso numero.
- Il pulsante **Storico** apre l'elenco con ricerca e filtro per stato. Da lì si può **aprire** un preventivo,
  **duplicarlo** per farne uno nuovo, **eliminarlo** e cambiare lo **stato** (Generato, Inviato, Accettato, Rifiutato).
- L'accesso è protetto da **una password unica** per tutto il team.
- I dati sono salvati in un database Redis (Upstash). La foto dell'auto viene salvata insieme al preventivo.

## Configurazione su Vercel (una volta sola)

1. **Database.** Nel progetto su Vercel apri **Storage** → **Create Database** (o **Marketplace**) → scegli
   **Upstash** → **Redis**. Piano gratuito, regione Europa (Francoforte). Collegalo al progetto per tutti gli
   ambienti: Vercel aggiunge da solo le variabili `KV_REST_API_URL` e `KV_REST_API_TOKEN`
   (vanno bene anche `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`).
2. **Password del team.** In **Settings → Environment Variables** aggiungi:

   | Nome | Valore |
   |---|---|
   | `APP_PASSWORD` | la password che useranno i consulenti (scegline una lunga) |

3. **Rifai il deploy.** Le variabili si leggono solo nei deploy nuovi: in **Deployments** apri il menu **⋯**
   dell'ultimo deploy e scegli **Redeploy**.

Per **cambiare la password**: modifica `APP_PASSWORD` e rifai il deploy. Tutti dovranno rientrare con la nuova.

Facoltativo: `SESSION_SECRET` (testo casuale lungo) per firmare le sessioni; se manca si usa la password.

## Note

- Chi accede resta collegato per 30 giorni su quel browser.
- Dopo 10 password sbagliate dallo stesso indirizzo l'accesso si blocca per 15 minuti.
- Nello storico ci sono dati personali dei clienti (nome, codice fiscale, partita IVA): condividi la password
  solo con chi deve usarla.
- I numeri dei preventivi eliminati non vengono riutilizzati dal suggerimento automatico.
