# MoovExpress — Piano di Risposta agli Incidenti e Politica di Sicurezza

**Organizzazione:** MoovExpress (moovexpress.com)
**Responsabile:** Lorenzo Antonelli (titolare) — contatto: info@moovexpress.com
**Versione:** 1.0 — Data: 23/07/2026
**Revisione:** semestrale (gennaio e luglio di ogni anno). Ogni revisione è annotata nel registro in coda.

---

## 1. Scopo e ambito

Questo documento definisce (a) il piano di risposta agli incidenti di sicurezza e (b) la politica
di gestione di password, credenziali e accessi di MoovExpress. Si applica a tutti i sistemi che
trattano dati personali dei clienti e degli acquirenti finali, incluse le "Amazon Information"
(dati ottenuti tramite Amazon Selling Partner API) come definite dalla Data Protection Policy di
Amazon.

## 2. Infrastruttura e misure tecniche

- **Hosting applicativo:** Vercel (serverless, firewall e mitigazione DDoS gestiti dal provider).
- **Database:** Supabase (PostgreSQL gestito, cifratura at rest AES-256, backup automatici).
- **Trasporto:** TLS 1.2+ su tutte le comunicazioni (utente↔app, app↔database, app↔API terze).
- **Isolamento multi-tenant:** ogni cliente accede esclusivamente ai propri dati (filtri
  applicativi per tenant su ogni percorso di lettura/scrittura).
- **Segregazione delle credenziali:** chiavi e segreti esclusivamente in variabili d'ambiente
  cifrate (Vercel) o in tabelle dedicate del database; mai nel codice sorgente; repository privato.
- **Minimizzazione e conservazione PII acquirenti:** i dati personali degli acquirenti dei
  marketplace (nome, indirizzo, telefono, email) sono usati al solo fine di evadere la spedizione e
  vengono cancellati o anonimizzati entro 30 giorni dalla consegna, salvo obblighi di legge.

## 3. Ruoli di risposta agli incidenti

| Ruolo | Titolare | Responsabilità |
|---|---|---|
| Incident Response Lead | Lorenzo Antonelli | Coordinamento, decisioni di contenimento, notifiche esterne |
| Supporto tecnico | Collaboratore tecnico di fiducia | Analisi tecnica, contenimento, ripristino |

Reperibilità: 24 ore su 24, 7 giorni su 7, tramite i recapiti aziendali (telefono + email).

## 4. Procedura di risposta agli incidenti

1. **Rilevamento** — segnalazioni da monitoraggio (log Vercel/Supabase), clienti, o terze parti.
2. **Contenimento immediato** — revoca/rotazione delle credenziali coinvolte, blocco degli accessi
   sospetti, eventuale messa offline del componente compromesso.
3. **Valutazione** — perimetro dell'incidente: sistemi coinvolti, tipologia di dati esposti
   (inclusa l'eventuale presenza di Amazon Information o altri dati personali), durata.
4. **Notifiche** —
   - **Amazon:** ogni incidente di sicurezza che coinvolga Amazon Information è segnalato a
     **security@amazon.com entro 24 ore dal rilevamento**, con descrizione dell'accaduto, dati
     coinvolti, azioni di contenimento e recapito del referente.
   - **Autorità (GDPR):** ove ricorrano i presupposti, notifica al Garante entro 72 ore.
   - **Clienti interessati:** informati senza ingiustificato ritardo quando l'incidente comporta
     un rischio per i loro dati o per i dati dei loro acquirenti.
5. **Eradicazione e ripristino** — correzione della vulnerabilità, verifica dell'integrità dei
   dati, ripristino del servizio.
6. **Post-mortem** — entro 7 giorni: cause, lezioni apprese, azioni preventive; annotazione nel
   registro incidenti.

## 5. Politica password, MFA e credenziali

- Password di **minimo 12 caratteri** con caratteri speciali; divieto di riuso tra servizi.
- **Autenticazione a più fattori (MFA) obbligatoria** su tutti i servizi amministrativi:
  Vercel, Supabase, GitHub, Zoho Mail, Resend, registrar del dominio.
- **Scadenza password: 365 giorni**, con rotazione annuale; rotazione immediata in caso di
  sospetta compromissione o cessazione di un collaboratore.
- Le credenziali applicative (API key, token, chiavi di cifratura) risiedono esclusivamente in
  variabili d'ambiente cifrate o vault; mai in repository pubblici, chat, documenti condivisi o
  codice sorgente. Rotazione annuale o su evento.
- Gli accessi sono assegnati per funzione lavorativa (principio del minimo privilegio) e revocati
  immediatamente al termine del rapporto.

## 6. Registro delle revisioni e degli incidenti

| Data | Tipo | Note |
|---|---|---|
| 23/07/2026 | Adozione v1.0 | Prima emissione del piano |
