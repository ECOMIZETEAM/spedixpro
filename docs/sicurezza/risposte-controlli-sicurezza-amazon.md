# MoovExpress — Risposte ai controlli di sicurezza SP-API (RDA / Data Protection Policy)

**Uso:** copiare/incollare ogni risposta nel campo corrispondente del questionario Amazon
(Solution Provider Portal → caso RDA). Ancorate all'infrastruttura reale (Vercel + Supabase +
GitHub + Google Workspace) e coerenti con `piano-risposta-incidenti-e-policy-sicurezza.md`.
Rispondere in inglese se il form è in inglese (versioni EN in fondo a ogni punto se servono).

> **Stato (24/08):** i punti tecnici sono chiusi con i dati veri dell'infrastruttura.
> - ✅ **Backup RTO/RPO (2.1/2.7):** verificato — piano Supabase **Pro**, backup giornalieri cifrati,
>   retention 7 gg, regione UE (eu-west-2). RPO ≤ 24h, RTO poche ore. PITR non attivo (attivabile).
> - ✅ **Politica dispositivi (2.3):** scritta come politica in vigore — va solo **mantenuta vera**
>   (lavorare da dispositivi designati e cifrati, niente dati Amazon su USB/dispositivi personali).
> - ⏳ **Penetration test (2.7): UNICA cosa che devi FARE tu** — pianificare/prenotare il primo pentest
>   (di solito in pacchetto con la Data Security Assessment di Amazon). È l'unico impegno dichiarato
>   non ancora eseguito.

---

## 1.1 — Protezione della rete
*(controlli per limitare l'accesso pubblico a database, file server ed endpoint desktop/sviluppatore)*

MoovExpress non gestisce server fisici né macchine sempre accese: l'infrastruttura è interamente
serverless e gestita.
- **Database (Supabase/PostgreSQL):** non è esposto pubblicamente all'applicazione tramite porte
  aperte; l'accesso avviene solo attraverso il livello API con Row-Level Security attiva per ogni
  tabella. L'accesso amministrativo diretto al database è riservato ai soli amministratori nominati,
  su TLS e con MFA obbligatoria, tramite la console Supabase.
- **Applicazione (Vercel):** funzioni serverless senza server persistenti o porte aperte verso
  Internet; firewall e mitigazione DDoS gestiti dal provider. Tutto il traffico su HTTPS/TLS 1.2+.
- **File server:** nessuno. I file (report, etichette, POD) risiedono in bucket privati Supabase
  Storage e sono serviti solo tramite endpoint applicativi autenticati.
- **Endpoint sviluppatore:** nessun dato Amazon risiede sui computer degli sviluppatori. Lo sviluppo
  e l'amministrazione avvengono via console cloud gestite (Vercel, Supabase, GitHub) con MFA; il
  repository del codice è **privato**. I segreti stanno solo in variabili d'ambiente cifrate.

## 1.2 — Gestione degli accessi  &  1.3 — Principio del privilegio minimo
*(come si identificano individualmente i dipendenti e si limita l'accesso "need-to-know")*

- **Identità individuali:** ogni persona con accesso alle informazioni Amazon ha un account
  **nominativo e personale** su ciascun servizio (GitHub, Vercel, Supabase, Google Workspace). Non
  esistono account condivisi né credenziali generiche. MFA obbligatoria su tutti.
- **Need-to-know:** il team è ristretto; l'accesso è concesso **per funzione lavorativa** e revocato
  immediatamente al termine del rapporto o quando non più necessario.
- **A livello applicativo:** isolamento multi-tenant con Row-Level Security per-tenant su ogni
  tabella (ogni cliente vede solo i propri dati); il ruolo con privilegi elevati (`service_role`) è
  usato **solo lato server** e mai esposto al browser; le credenziali dei corrieri sono revocate ai
  ruoli `anon`/`authenticated` (grant per-colonna) e leggibili solo dal backend amministrativo.
- **Accesso ai dati Amazon:** limitato al solo personale che gestisce l'evasione degli ordini, per
  la sola finalità di spedizione.

## 2.3 — Gestione delle risorse (accesso da dispositivi personali)
*(meccanismo per impedire l'accesso da unità USB / telefoni personali e relativo alert)*

> Politica operativa in vigore, da **mantenere vera**: si lavora solo da dispositivi designati e
> cifrati, senza copie dei dati Amazon su unità USB o dispositivi personali non gestiti.

- L'accesso alle informazioni Amazon avviene **solo attraverso l'applicazione e le console cloud
  gestite** (protette da MFA): non esistono esportazioni massive né copie locali dei dati sui
  dispositivi. Non è previsto né consentito il trasferimento di dati Amazon su unità rimovibili
  (USB) o dispositivi personali non gestiti.
- I dispositivi usati per l'amministrazione hanno **cifratura del disco** attiva e blocco schermo.
- **Rilevamento/alert:** ogni accesso ai dati personali è tracciato nel registro `audit_accessi`
  (conservazione 12+ mesi, revisione periodica) e gli accessi alle console cloud generano notifiche
  di nuovo dispositivo/login (Vercel, Supabase, Google Workspace, GitHub): un accesso da un
  dispositivo non riconosciuto viene segnalato via email e verificato.

## 2.4 — Crittografia dei dati inattivi
*(metodi di cifratura at-rest e sistemi di gestione delle chiavi)*

- **Database e Storage (Supabase, su infrastruttura AWS):** cifratura at-rest **AES-256**; le chiavi
  sono gestite dal servizio gestito (AWS KMS) e non sono mai esposte all'applicazione.
- **Backup:** cifrati con lo stesso standard.
- **Segreti applicativi** (API key, token): in **variabili d'ambiente cifrate** su Vercel, oppure in
  tabelle dedicate del database ad accesso ristretto; mai nel codice o in repository.
- **In transito:** TLS 1.2+ su tutte le tratte (utente↔app, app↔database, app↔API terze).

## 2.1 — Conservazione dei dati  &  2.7 — Backup / ripristino
*(backup cifrati, posizioni geograficamente separate, procedure di ripristino RTO/RPO)*

- **Backup automatici:** piano Supabase **Pro** — backup automatici **giornalieri** e cifrati del
  database (stesso standard at-rest, AES-256), con **retention 7 giorni**, su infrastruttura gestita
  **AWS nell'Unione Europea (regione eu-west-2, Londra)**, con ridondanza multi-AZ della regione.
- **Conservazione/minimizzazione PII:** i dati personali degli acquirenti Amazon vengono
  anonimizzati/cancellati **entro 31 giorni** dalla spedizione tramite un cron giornaliero
  automatico; i log di accesso alle PII sono conservati **12+ mesi**.
- **Procedure di ripristino (RTO/RPO):**
  - **RPO** (perdita massima di dati): **≤ 24 ore** (backup giornaliero automatico).
  - **RTO** (tempo di ripristino): **poche ore** — ripristino da backup gestito dal provider.
  - *Opzione per una garanzia più forte:* il **Point-in-Time Recovery** (add-on del piano Pro) porta
    l'RPO a **~2 minuti** e l'RTO sotto l'ora. Oggi NON è attivo; si può abilitare se la Data Security
    Assessment richiede valori più stringenti.

## 2.6 — Registrazione e monitoraggio
*(logging di sicurezza, rilevamento di attività sospette, indagine sugli incidenti)*

- **Log:** log applicativi e di runtime su Vercel; log del database e delle autenticazioni su
  Supabase; registro applicativo **`audit_accessi`** che traccia gli accessi ai dati personali
  (impersonazioni, tracking, download etichette) con conservazione 12+ mesi e revisione periodica.
- **Rilevamento attività sospette:** scansione continua degli advisor di sicurezza Supabase e
  Dependabot; notifiche di login/nuovo dispositivo dei provider; revisione del registro accessi.
- **Indagine sugli incidenti:** procedura formalizzata nel Piano di Risposta agli Incidenti
  (rilevamento → contenimento → valutazione → notifica → eradicazione → post-mortem entro 7 giorni).
  Ogni incidente che coinvolga Amazon Information è notificato a **security@amazon.com entro 24 ore**.

## 1.4 — Gestione delle credenziali (policy password)
*(lunghezza, complessità e durata delle password per i sistemi che trattano informazioni Amazon)*

- **Lunghezza/complessità:** minimo **12 caratteri** con caratteri speciali; divieto di riuso tra
  servizi. Sull'autenticazione dell'applicazione è attiva la **protezione contro password compromesse
  (leaked password protection)** e la lunghezza minima 12 è imposta dal sistema.
- **MFA:** obbligatoria su tutti i servizi amministrativi (Vercel, Supabase, GitHub, Google
  Workspace, Resend, registrar del dominio).
- **Durata/rotazione:** scadenza **365 giorni** con rotazione annuale; rotazione immediata in caso di
  sospetta compromissione o di cessazione di un collaboratore.
- Le credenziali degli utenti finali dell'applicazione sono gestite dal servizio di autenticazione
  (hash sicuro), mai memorizzate in chiaro.

## 2.7 — Gestione delle vulnerabilità (tracciamento delle correzioni) **[DA CONFERMARE: pentest]**
*(come si monitora l'avanzamento delle correzioni da scansioni e penetration test)*

- **Scansione continua:** **Dependabot** su GitHub (dipendenze) + **advisor di sicurezza Supabase**
  (configurazione DB/RLS), eseguiti con regolarità.
- **Tracciamento delle correzioni:** ogni risultato genera un elemento tracciabile (PR Dependabot /
  issue GitHub / voce advisor) che viene chiuso solo a correzione applicata e ri-verificata. **SLA:
  vulnerabilità critiche entro 7 giorni, elevate entro 30 giorni.**
- **Penetration test:** impegno a un pentest **annuale** da società qualificata; il risultato viene
  tracciato e le correzioni gestite con lo stesso SLA. ⚠️ **[DA CONFERMARE]** — pianificare la data
  del primo pentest (spesso in pacchetto con la Data Security Assessment richiesta da Amazon).

---

### Registro
- v1.0 — 24/08/2026 — prima stesura in risposta al rifiuto RDA di Amazon del 19/08/2026.
