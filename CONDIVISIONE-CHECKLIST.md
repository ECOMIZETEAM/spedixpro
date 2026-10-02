# Condivisione — CHECKLIST prima di scrivere (92 avvisi dalla squadra, 02/10/2026)

Regola madre (lezione di oggi): **niente deve uscire dal recinto `tipo='moovexpress'` e toccare i master
normali.** Ogni pezzo si verifica **prima/dopo sui dati veri** e si rilascia solo verde + revisionato.

## A. RISCHI SUI MASTER NORMALI (massima priorità — qui nasce il disastro)

1. **`proprio` NON è un interruttore: è una colonna DERIVATA** da un trigger DB `fn_ricalcola_corrieri_proprio`
   (`trg_corrieri_proprio`, AFTER INSERT/DELETE/UPDATE su `corrieri`). Scriverla a mano NON serve: il trigger la
   ricalcola **globalmente** a ogni corriere creato/rinominato/cancellato (ecco perché "si spostano da soli").
   - La sua REGOLA è `proprio = NOT EXISTS(antenato-albero con stesso nome_contratto)`: **albero+nome, cieca al
     codice** → marca l'owner reale (tipo=poste) a volte `false` e un ponte a volte `true`. **HA GIÀ contaminato
     contratti NORMALI** (costo spostato fra credito e credito_proprio). → è un **bug pre-esistente** oltre la condivisione.
   - CURA: non flippare il flag; **correggere la REGOLA** dentro `fn_ricalcola_corrieri_proprio` (migrazione DB),
     tipo-aware (owner = corriere reale non-moovexpress) e codice-aware (via `corrieri_condivisi`/credenziali).
   - VERIFICA: snapshot `SELECT id,proprio FROM corrieri WHERE tipo<>'moovexpress'` **prima/dopo** → diff ZERO sui normali.

2. **Report (`guadagno_spedizioni_serie_v1`) — MULTIEXPRESS è insieme super-master normale (~90k movimenti/mese,
   39.217 €) E nella catena condivisione.** Una modifica sciatta gli spacca il report.
   - Gate DURO: `LEFT JOIN corrieri su spedizioni.corriere_id`, `coalesce(c.tipo,'')='moovexpress'` (corriere
     mancante = ramo normale, MAI scartato). Classificare le gambe **solo** via `corrieri_condivisi`/tipo, **mai**
     via `parent_master_id` (Wave/LOGIXIA sono figli-albero di MULTI ma legati per CODICE).
   - Il margine del rivenditore è **azzerato**: costo e ricavo stanno su spedizioni-id DIVERSE (la catena crea 3
     spedizioni: radice + suffisso `-<ledger>`). Ri-raggruppare le gambe moovexpress sulla spedizione-RADICE
     (prefisso del numero prima di `-`; NON esiste `spedizione_padre_id`).
   - **Volume gonfiato ×3**: le sub-spedizioni-ledger sono righe vere → escluderle dai conteggi volume.
   - Trappola **null-vs-zero**: il termine-costo-ledger dev'essere NULL quando assente, non 0 (altrimenti maschera).
   - La STESSA logica è duplicata in una 2ª RPC (Profitability/serie) e ricade su DUE endpoint
     (`reports/guadagno` + `reports/guadagno-totale`): modificare **in lockstep**, prima/dopo su ENTRAMBI, per MULTI e normali.

3. **Commissione (`fn_fee_moovexpress_proprio`) — DECISIONE Lorenzo 02/10: "TUTTI PAGANO, ognuno ha la propria rete".**
   Niente esenzioni: la fee 0,05 la paga il PROPRIETARIO del contratto, chiunque sia (LOGIXIA come Velox/Quick/GTS).
   - → **Il carve-out/esenzione (vecchio pezzo ④) è CANCELLATO.** Il trigger NON si tocca: resta "scatta se corriere
     `proprio=true` E `fn_conto_di='proprio'`, esenta solo demo". Dopo il fix ① LOGIXIA sarà `proprio=true` e pagherà
     sulle sue Triangolazioni — è il comportamento VOLUTO, non un bug.
   - Verifica di non-regressione: `saldoCommissioni` dei 12 master paganti INVARIATO (il fix ① non li tocca: cambia
     solo LOGIXIA, che INIZIA a pagare come gli altri owner). L'unico delta atteso è LOGIXIA che comincia a pagare.
   - Storni: NON stornare le commissioni di LOGIXIA (owner legittimo). Stornare solo quelle dei RIVENDITORI dai test
     (Wave −0,05, EcoLL −0,05: bridge `proprio=false`, non devono mai pagare) — vedi sez. D.

4. **crea — 11 rami corriere quasi identici** (946/1232/1692/1938/2129/2337/2518/2673/2826/2999/**3129**). Editare SOLO
   dentro `if (corriereRecord.tipo === 'moovexpress')` (3038-3167). **Non** rimuovere l'import di `addebitaCatena` (riga 4,
   usata da 10 rami) **né** toccare `addebitaCredito` (576-656, condivisa da tutti). Un test su GLS/poste deve restare byte-identico.

5. **v1 — guardia ESATTA `if (corriere.tipo !== 'moovexpress')` attorno a SOLO `addebitaCatena` (:698).** Mai su proxy
   (`costoCorrente>0`, "provider esterno", `cliente.ledger`): prenderebbero anche spedisci/spediamopro/easyparcel (NORMALI).
   Non hoistare l'if sopra il blocco ledger/prenotazione (:666-682). L'owner è tipo='poste' → `!==moovexpress` lo mantiene.

## B. ORDINE DI RILASCIO — questi pezzi DEVONO uscire INSIEME (mai da soli)

- **aggancio crea/v1** + **regola proprio corretta (ponti→'rete')** + **re-sourcing del dispatch** + **report ①'**.
  Motivi: (a) se aggancio senza proprio giusto, il tratto-albero cade su credito_proprio = stesso fantasma spostato;
  (b) se tolgo la copia-chiave ai sub senza re-sourcing, `crea:3048 (!api_key)` **blocca la spedizione del sub**;
  (c) la guardia v1 e il flip proprio=false sono "load-bearing": uno senza l'altro = doppio o conto sbagliato all'hop owner;
  (d) senza ①' il margine del rivenditore sparisce dal report.

## C. PER PEZZO — da fare / da evitare

**addebitaTreeCondivisione** (lib/condivisione-catena.ts):
- `masterOriginante = masterId` (il padre contabile), **MAI** `masterSub` (altrimenti doppio: `addebitaCredito` già copre sub→padre).
- **RIFIUTA (throw) se `spedizioneId` è null** (l'anti-doppione `uniq_mov_sped_master` ha `WHERE spedizione_id IS NOT NULL`).
- Prezzare i livelli-albero passando ANCHE `contrassegno`, `assicurazione`, `serviziAccessori`, `mittCap/mittProvincia/mittPaese`:
  senza, i livelli d'albero sono **sotto-prezzati** su COD/assic/accessori/origine-disagiata → perdita silenziosa (il mittente fu reso
  OBBLIGATORIO in `addebitaCatena` proprio per questo). Attento al listino-ponte sballato (Wave mostrava 4,48 ma paga 4,28).
- Avvolgere la chiamata nella STESSA try/catch (solo console.error): un pacco è GIÀ fisico, non deve mai dare 400/storno.
- Idempotenza: un fallimento di un livello non ferma nulla → serve un **cron di riconciliazione guardato a moovexpress** che confronti
  i movimenti 'spedizione' master_target attesi e completi i mancanti.

**Dispatch / credenziali**:
- Re-sourcing: risolvere il **primo detentore-CODICE** (via `risolviCatenaCondivisione`/`corrieri_condivisi`) e usare il SUO ponte+api_key.
- **Fuga cross-tenant GIÀ LIVE**: una sola `mvx_live` è su 5 master (i sub si autenticano come il nonno) → bonificare le chiavi copiate.
- Escludere i corrieri moovexpress da `sincronizzaCredenzialiAiDiscendenti` (la condivisione ha il suo canale `risincronizzaCondivisione`).

**Mappatura ledger→master (per il report + lo storico)**:
- Solo per `cliente_ledger_id` (verificato: 1 master per ledger), **IGNORANDO `stato`** (una condivisione revocata non deve perdere il costo storico).

## D. RICONCILIAZIONE 282224J028331 — più grande del previsto

- Lo stato reale è **8 righe**, non 6. **EcoLL ha 5 addebiti credito_proprio = −20,08** (non solo −4,58): concordare con MULTIEXPRESS il
  **perimetro** (solo questa spedizione o tutto il flusso rotto) PRIMA di stornare. Partire dall'elenco reale, non dalla memoria.
- Le righe `conto='proprio'` **non si stornano con `registra_movimento_master`** (finirebbe sulla colonna sbagliata). Le 3 `commissione`
  −0,05 nemmeno (tipo diverso). Serve una **RPC di riconciliazione service_role dedicata** che legga il `conto`/`tipo` originale e scriva
  l'inverso ESATTO sulla stessa colonna; **solo APPEND**, `saldo_dopo` ricalcolato dal saldo corrente; **mai** UPDATE su saldi/saldo_dopo storici.
- Idempotente (chiave spedizione_id+tipo+target+colonna+segno), verificata a secco su snapshot (shadow). Agire SOLO sui movimenti, MAI
  cancellare/ricreare le 3 righe `spedizioni` (ri-scatenerebbe il trigger commissione).
- Le 2 tratte-albero da AGGIUNGERE (EcoLL −4,58 owner=EcoSol; EcoSol −4,48 owner=MULTI) su masters.credito, dopo aver verificato `fn_conto_di` live='rete'.
- Verifica **colonna per colonna** su snapshot fresco (credito / credito_proprio / commissioni_moovexpress separati), non per somma.
- Stato finale atteso (per questa spedizione): EcoLL credito_proprio 0 e commissioni 0; Wave credito_proprio 0 e commissioni 0; i 3 ledger/owner GIUSTI restano.

## E. VERIFICHE OBBLIGATORIE (per ogni pezzo, prima del deploy)
- Ri-quotare **282224J028331** e confrontare i movimenti **prima/dopo** (al centesimo).
- Una spedizione **COD + assicurata + origine disagiata** su moovexpress: i livelli-albero combaciano col listino (no sotto-fatturazione).
- **Normali byte-identici**: report di MULTI (mese pieno) + 2-3 master, commissione dei 12 paganti, proprio dei corrieri non-moovexpress.

## F. MAPPA DEL CODICE VIVO (02/10, 5 strade mappate + verifica avversariale — file:riga VERI)

**② aggancio addebito — SOSTITUIRE, non togliere (la guardia da sola = buco silenzioso):**
- `addebitaTreeCondivisione` è DEFINITA (lib/condivisione-catena.ts:161) ma NON ancora importata/chiamata da nessuno.
- `crea/route.ts`: ramo moovexpress a :3038, chiamata addebitaCatena a :3129. Edit: import additivo + rimpiazzo SOLO
  quella chiamata con addebitaTreeCondivisione. NON toccare addebitaCredito :3127 né le altre 10 chiamate addebitaCatena
  (946/1232/1692/1938/2129/2337/2518/2673/2826/2999 = spedisci/spediamopro/easyparcel/interno/gls/brt/fedex/dielle/poste/inpost).
- `v1/shipments/route.ts`: unica addebitaCatena a :698 (try :697-699). Ramo moovexpress a :579. Edit: nel ramo moovexpress
  chiamare addebitaTreeCondivisione; per gli altri tipi resta addebitaCatena. NON avvolgere il blocco ledger/cliente :666-682
  (vale anche per moovexpress), NON toccare l'import :6. 7 tipi in v1 (spedisci/spediamopro/easyparcel/dielle/poste/inpost/
  moovexpress); GLS/BRT/FedEx sono BRAND dentro spedisci/spediamopro/easyparcel, non tipi → la guardia-tipo è chirurgica.
- Le DUE porte vanno in lockstep o divergono sullo stesso flusso-soldi.
- **FIX a addebitaTreeCondivisione PRIMA di agganciarla**: oggi NON passa contrassegno/assicurazione/serviziAccessori/mittente
  a pianoAddebitiCondivisione → i livelli-albero sotto-prezzati su COD/assic/accessori/origine. Allinearla ad addebitaCatena
  (che li passa). Questo è un fix di correttezza per COMBACIARE col comportamento esistente, non una scelta nuova.

**③ dispatch re-sourcing — PERICOLOSO, non applicare al buio:**
- Oggi il dispatch del ponte si fida di `credenziali.api_key`+`base_url` della riga corriere (crea:3047/3055, v1:584/588,
  fetch in lib/moovexpress.ts:88-96). La chiave colata = fuga + addebito al nonno.
- Rischi del re-sourcing proposto: (a) un ponte COLATO risolve come ruolo='albero' non 'codice' → bloccherebbe spedizioni
  VIVE; (b) omonimia: risolviCatenaCondivisione sceglie il ponte per NOME (primo in ordine DB), può non essere la riga
  selezionata → chiave sbagliata; (c) perde l'override base_url per-contratto → regressione multi-dominio; (d) il SELECT
  di corrieri_condivisi non torna corriere_id (serve per re-sourcing la chiave); (e) chiave spenta/ruotata → errore duro, ma
  romperebbe spedizioni che OGGI passano sulla colata; (f) PERF: una risolviCatena completa per OGNI dispatch su hot path
  ri-entrante (~1500/gg). → Prima: helper `risolviChiaveDispatch` SOLA LETTURA ancorato alla RIGA ESATTA
  (corrieri_condivisi keyed su corriere_acquirente_id = corriereRecord.id, vedi accetta:114) + **uno SHADOW dedicato alla
  CHIAVE** (oggi NON esiste; run-resolver-shadow.mts valida solo il piano contabile) su 30-90gg di spedizioni moovexpress
  reali, contando quante dipendono dalla chiave colata, PRIMA di toccare il dispatch. Confinare a credMv, mai a `cred`.

**④ fuga credenziali — fix pulito (verificato edit_sicuro), MA con due code:**
- copia-listino-submaster.ts:100 → `.neq('tipo','moovexpress')` (non copiare i ponti); :125 lascia `credenziali` invariato;
  guardia zone-orfane; propaga-credenziali.ts:20 (rifiuta sorgente-ponte) e :30-31 (`.neq('tipo','moovexpress')` sul target).
  Discriminante = `tipo='moovexpress'`, MAI `proprio` (sui ponti è inaffidabile: lo ribalta il trigger). (D) chiude anche un
  BUG LATENTE: MULTI possiede "GLS Light Napoli" spedisci proprio=true e nel sottoalbero c'è il ponte omonimo di SPEDIZIONI
  EXPRESS → un rinnovo credenziali di MULTI lo sovrascriverebbe.
- CODA 1 (blocca il rilascio di ④): la copia-cascata è l'UNICO canale con cui 4 ponti (Ecomize LL, Ecomize Solution, M&R
  Sprint, sdl express courrier — NESSUN corrieri_condivisi) ricevono il contratto condiviso. Toglierla senza MIGRARLI a
  legami `corrieri_condivisi` espliciti ROMPEREBBE le loro spedizioni vive (Ecomize LL spedisce davvero).
- CODA 2 (sicurezza, LIVE): quei 4 ponti portano la STESSA api_key di MULTIEXPRESS (hash 4ae948a4, verificato cifrato) →
  spediscono come MULTI. Bonifica = ri-emettere una chiave per-compratore via il canale condivisione (materializzaContratto/
  risincronizzaCondivisione), MAI a mano. È una scrittura in produzione → conferma di Lorenzo prima.

**Secondo contratto condiviso oltre Triangolazioni:** "GLS Light Napoli" (MULTI owner spedisci, ponte su SPEDIZIONI EXPRESS).
Il fix deve reggere l'intero grafo, non solo la catena LOGIXIA→Wave→MULTI→EcoSol→EcoLL.
