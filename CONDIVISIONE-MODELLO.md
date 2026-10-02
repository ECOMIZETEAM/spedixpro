# Condivisione contratti — MODELLO DEI CONTI (specifica confermata da Lorenzo, 02/10/2026)

> Regola d'oro di questo lavoro: un passo alla volta, verifiche sui FATTI REALI (mai a memoria),
> sicurezza al 100% prima di toccare. Se sbagliamo qui sono soldi veri su ~1.500–5.000 spedizioni/giorno.

## 1. Owner e rivenditori
- Chi **crea** un contratto reale (es. LOGIXIA → "Poste Delivery Business Triangolazioni") è l'**unico owner**.
  Ha il **suo conto** (`credito_proprio`) che registra quanto paga al corriere vero (Poste).
- Gli altri sono **rivenditori**: non possiedono il contratto, lo rivendono con un margine.

## 2. "Conto per fornitore diretto" — e il conto va SOLO verso il fornitore diretto
Ogni master ha un **conto per OGNI fornitore diretto** da cui compra. Il fornitore diretto è **chi gli vende
davvero**, e può essere:
- il suo **padre nell'albero**, se eredita il contratto a cascata (è un suo **sub diretto**); **oppure**
- il master che lo ha **collegato via CODICE** (condivisione), se **non** è un suo sub diretto.

**REGOLA (Lorenzo, 02/10/2026) — USA IL CONTO CHE ESISTE GIÀ, non crearne di nuovi:**
- Se il compratore è un **sotto-master nell'albero** del venditore (es. Ecomize LL sotto Ecomize Solution),
  il conto verso il padre **ESISTE GIÀ**: è il suo conto da sotto-master (`masters.credito`, i suoi
  movimenti, visibile nell'Elenco clienti del padre). Il costo del contratto rivenduto va **su quel conto**.
  NON si crea un ledger "(ingrosso)": sarebbe un doppione dello stesso rapporto.
- Se il compratore **NON è un sotto-master** del venditore (collegato solo via CODICE), allora il conto è il
  **cliente-ledger** sotto il venditore (creato all'Accetta) — l'unico modo che il venditore ha di
  rappresentarlo, perché non ce l'ha già in rete.
- In entrambi i casi: UN conto per fornitore diretto, quello che già esiste. Solo l'**owner** usa `credito_proprio`.

> Nota tecnica (verificata): `/api/v1/shipments` addebita sempre un `cliente` (clienti.credito), mai un
> sotto-master. Quindi un sotto-master NON va fatto spedire via ponte/API verso il padre (creerebbe il
> ledger-doppione): la sua spedizione si gestisce **in casa** (cascata-albero su `masters.credito`) e il
> dispatch esterno parte dal primo detentore-codice (il padre), con il suo ponte.

**Un master NON vede i "nonni".** Es.: Ecomize LL compra da **Ecomize Solution** (suo padre). Anche se il
contratto è di proprietà di MULTI, Ecomize LL **non ha un conto MULTI** — vede solo "conto Ecomize Solution".
Avrebbe un conto MULTI **solo se MULTI lo collega diretto via codice** (bypassando Ecomize Sol), perché
Ecomize LL non è sub diretto di MULTI.

## 3. `credito_proprio` = conto dei contratti PROPRI (NON per i contratti comprati)
- `credito_proprio` è il conto della "roba mia": i contratti che il master **possiede/crea** (owner), o il suo
  **circuito interno**. Esempi: Quick compra da MULTI (→ conto MULTI) ma ha i suoi GLS propri (→ conto proprio);
  Ecomize LL compra da Ecomize Sol (→ conto Ecomize Sol) ma ha anche un circuito interno (→ conto proprio).
- **Il conto proprio NON si deve mischiare** coi conti verso i fornitori.
- **BUG DA CORREGGERE:** oggi un rivenditore, quando compra un contratto, registra il costo sul proprio
  `credito_proprio`. Sbagliato: deve andare sul **conto verso il fornitore**. Solo l'**owner** usa il conto
  proprio (perché il contratto è davvero suo e paga il corriere).

## 4. Catena di esempio (la catena di prova di Lorenzo)
`LOGIXIA → Wave → MULTI → Ecomize Solution → Ecomize LL` — margini 0 / 0,10 / 0,10 / 0,10.

| chi spende       | fornitore diretto        | sul conto                | paga  |
|------------------|--------------------------|--------------------------|-------|
| LOGIXIA (owner)  | Poste (corriere)         | conto proprio (corriere) | 4,28  |
| Wave             | LOGIXIA (codice)         | conto LOGIXIA            | 4,28  |
| MULTI            | Wave (codice)            | conto Wave               | 4,38  |
| Ecomize Solution | MULTI (albero)           | conto sub-master ESISTENTE di EcoSol (masters.credito)     | 4,48  |
| Ecomize LL       | Ecomize Solution (albero)| conto sub-master ESISTENTE di Ecomize LL (masters.credito) | 4,58  |

> REGOLA NETTA (verificata sui `corrieri_condivisi` + albero reali, 02/10): se il compratore è
> **discendente nell'albero** del venditore (compra "scendendo l'albero") → `masters.credito`, il conto
> sub-master che ESISTE già. Altrimenti (collegamento **CODICE**, incluso comprare da un pari o da un
> ramo diverso) → **ledger** sotto il venditore. Nella catena di prova: EcoLL→EcoSol e EcoSol→MULTI sono
> albero (MULTI è il padre-albero di EcoSol, che è padre di EcoLL); MULTI→Wave e Wave→LOGIXIA sono codice
> (Wave e LOGIXIA sono rami diversi, non antenati di MULTI). Il "cambio marcia" tree→codice è a **MULTI**.

Un pacco **da Ecomize LL**: Ecomize LL −4,58 (conto Ecomize Sol); Ecomize Sol −4,48 (conto MULTI);
MULTI −4,38 (conto Wave); Wave −4,28 (conto LOGIXIA); LOGIXIA −4,28 (conto proprio/corriere).
**Nessun livello saltato, nessun conto verso un nonno, nessun credito_proprio per i rivenditori.**

## 5. Gating per conto, indipendente
Ogni conto è **a credito** (prepagato: a zero non spedisci) **o a fattura** (può andare a −200€). Lo decide
**ogni coppia** separatamente:
- LOGIXIA→Wave a **fattura** → Wave spedisce la Triangolazioni anche a −200€.
- MULTI→Wave a **credito** → per i contratti di MULTI, Wave deve ricaricare.
- Stesso Wave, due conti, due regole diverse.

## 6. Resi, giacenze, COD, supplementi — STESSA struttura
Ogni evento che costa (reso, giacenza giornaliera, commissione COD, supplementi…) viaggia sulla **STESSA
catena**: ogni livello lo paga al suo fornitore diretto con il suo margine, fino all'owner. Non solo la
spedizione base.

## 7. Cosa NON deve MAI succedere
- un livello **saltato** (chi è in mezzo deve guadagnare);
- un **doppio addebito** (stesso costo su due conti);
- un conto verso un **non-fornitore-diretto** (un "nonno");
- il costo di un contratto **comprato** finito su `credito_proprio` (è della "roba mia");
- una **perdita** silenziosa (margine negativo per zona/listino sbagliati).

---

## Stato noto (02/10/2026) — RICOSTRUITO SUI MOVIMENTI REALI della spedizione `282224J028331`

Spedizione partita da **Ecomize LL** oggi 02/10 09:43 (`costo_totale 4,58`). Invece dei 5 livelli ne ha
fatti **3**: ha creato 3 spedizioni concatenate `LOGIXIA (Poste reale) ← Wave ← Ecomize LL`.

### I 6 movimenti veri
| spedizione | livello | conto | importo | giudizio |
|------------|---------|-------|---------|----------|
| …-216b3342 | ledger "Wave (ingrosso)" **sotto LOGIXIA** | rete  | −4,28 | ✓ Wave paga LOGIXIA |
| …-216b3342 | **LOGIXIA** credito_proprio               | proprio | −4,28 | ✓ owner paga Poste (margine 0) |
| …-1d6ac50d | ledger "MULTI (ingrosso)" **sotto Wave**  | rete  | −4,38 | ✓ (ma è MULTI, non il mittente) |
| …-1d6ac50d | **Wave** credito_proprio                  | proprio | −4,48 | ✗ FANTASMA (Wave è rivenditore) |
| 282224J028331 | **Ecomize LL** commissione             | proprio | −0,05 | ✗ nel vuoto |
| 282224J028331 | **Ecomize LL** credito_proprio         | proprio | −4,58 | ✗ pagato nel proprio conto, non a un fornitore |

### Causa radice (confermata via `api_keys`)
**Tutti i ponti dei discendenti-albero di MULTI usano la STESSA chiave = il ledger di MULTI sotto Wave
(`1d6ac50d`).** La cascata-albero ha **copiato il corriere-ponte di MULTI ai figli** (Ecomize Solution,
Ecomize LL), **credenziali comprese**. Quindi Ecomize LL, quando spedisce, **si autentica a Wave come MULTI**:
- la catena-ledger risale `MULTI→Wave→LOGIXIA` (giusta in sé: 4,38 / 4,28 / 4,28), ma **senza Ecomize LL né
  Ecomize Solution** (livelli persi, margini 0,10 ciascuno mai maturati);
- il vero mittente Ecomize LL riceve solo un addebito **locale** su `credito_proprio` (−4,58 + −0,05), che
  **non raggiunge nessun fornitore**;
- **MULTI si accolla 4,38** di costo per una spedizione che non ha fatto;
- in più, i rivenditori (Wave, Ecomize LL) prendono un addebito **fantasma** su `credito_proprio`.

Due difetti strutturali distinti, non uno:
1. **Fuga di credenziale via cascata-albero** (grave anche per sicurezza: un master spedisce *nei panni di
   un altro* — cross-tenant). Un sub-diretto NON deve ereditare la chiave-ponte del nonno: deve avere il
   **suo conto verso il fornitore diretto** (il padre-albero).
2. **`credito_proprio` acceso per i rivenditori.** La cascata-albero si **ferma al primo `proprio=true`** e
   lo tratta da owner; ma un ponte-rivenditore `proprio=true` NON è l'owner — deve **proseguire** sul suo
   fornitore (via codice), non addebitare `credito_proprio`. Solo l'owner reale (LOGIXIA, corriere `poste`)
   usa `credito_proprio`.

La buona notizia: **il meccanismo via-codice (ledger + ponte + dispatch) è sano** quando il cablaggio è
giusto — la tratta MULTI→Wave→LOGIXIA è perfetta. Si rompe (a) quando la cascata-albero copia il ponte coi
suoi segreti, e (b) negli addebiti `credito_proprio` dei rivenditori.

## Dove sta nel codice (mappa 02/10 — fatti: workflow + letture dirette)

TRE guasti, ciascuno con la sua riga:

**1. Doppio addebito sulla spedizione.** L'originante, oltre al ledger sotto il venditore (la gamba
GIUSTA), fa un SECONDO addebito con `addebitaCatena` sul proprio conto:
- `app/api/spedizioni/crea/route.ts:3129` e `app/api/v1/shipments/route.ts:698`.
- Con ponte `proprio=true`: `detentoreContratto` si ferma sull'originante (`lib/contratto-per-nome.ts:64`),
  `costruisciCatena` fa break (`lib/cascata.ts:280`), `pagaDalSuoConto=true` (`lib/cascata.ts:269`),
  `fn_conto_di`→'proprio' → scala `credito_proprio`. Il flag `proprio` sposta solo DOVE cade la seconda
  gamba (proprio→credito_proprio; false→credito 'rete' o falso "Credito insufficiente"): NON la elimina.
- CURA: per un corriere `tipo='moovexpress'` l'originante NON deve chiamare `addebitaCatena` — il ledger
  sotto il venditore È già il conto verso il fornitore. Il gating resta sul ledger (il suo tipo_contratto);
  `verificaCreditoCatena` quei livelli li salta già (`lib/cascata.ts:449`).

**2. Fuga di credenziale via cascata-albero.** `lib/copia-listino-submaster.ts:123-125` materializza il
corriere del padre per il sotto-master copiando `credenziali` VERBATIM — anche per i ponti. Così i
figli-albero di MULTI hanno la SUA chiave e spediscono nei suoi panni (cross-tenant); il vero mittente
sparisce dalla catena e i livelli in mezzo non maturano margine.
- CURA: un ponte (`tipo='moovexpress'`) NON si copia verbatim giù per l'albero. Un sub-diretto che eredita
  un contratto RIVENDUTO deve avere un conto verso il PADRE, non la chiave del nonno.

**3. Resi, giacenze, COD camminano SOLO l'albero — ciechi alla catena-codice.**
- `lib/giacenza-cascata.ts` `catenaContratto:231` e `addebitaGiacenzaCatena:55`: salgono `parent_master_id`,
  si fermano al primo `proprio=true`, addebitano `credito/credito_proprio` di ogni livello-albero. Nessun
  ponte, nessun ledger, nessun dispatch, nessun `fornitore_master_id`.
- `lib/contrassegni-catena.ts` `risaliCatena:13`/`destinatarioCod:30`: il COD scende l'ALBERO di un gradino.
- Sul contratto Triangolazioni: un reso di Ecomize LL addebiterebbe [Ecomize LL, Ecomize Solution, MULTI]
  (albero) fermandosi a MULTI — Wave e LOGIXIA (i veri codice-fornitori e l'owner) MAI toccati. Set di
  master DIVERSO da quello che ha pagato la spedizione (MULTI/Wave/LOGIXIA).
- `lib/conto-fornitore.ts` (solo `tipo='spediamopro'`): addebita all'OWNER (proprio=true per authcode) la
  differenza, confidando che resi/giacenze abbiano già addebitato lo stesso master; con un contratto
  rivenduto i due possono non coincidere.
- CURA: resi/giacenze/COD devono seguire la STESSA catena-fornitore-diretto della spedizione.

## Principio unificante
Esiste UN solo grafo che conta: la catena del FORNITORE DIRETTO. Per un sub-albero il fornitore è il padre
(conto `masters.credito`); per un collegato-codice è il venditore (conto = ledger sotto il venditore). Oggi
la SPEDIZIONE usa solo i ponti-codice (con le credenziali colate giù), mentre RESI/GIACENZE/COD usano solo
l'albero. Vanno fatti convergere: ogni evento che costa risale la catena-fornitore-diretto, un gradino alla
volta, fino all'owner reale — stesso insieme di livelli, stessi conti, per spedizione, reso, giacenza, COD.

### Prossimo passo
Banco di prova a master finti che pretende i 5 livelli puliti su TUTTI gli eventi (spedizione, reso,
giacenza, COD), mostra il rosso di oggi e guida al verde. Poi la correzione, un'area alla volta, in
quest'ordine: (2) fuga credenziale → (1) doppio addebito → (3) resi/giacenze/COD sulla catena giusta.

---

## Piano di implementazione (02/10) — flusso a parte, TUTTO guardato a `tipo='moovexpress'`

Regola di sicurezza: ogni modifica vale SOLO per i corrieri `moovexpress` (la condivisione). Le spedizioni
sui contratti normali restano **byte per byte identiche**. Portata reale oggi: 2 contratti, 7 ponti, 1 sola
catena di prova spedita (`282224J028331`), ZERO clienti veri → toccare la condivisione non colpisce nessun
cliente reale.

**① Doppio `credito_proprio`** — [crea:3129](app/api/spedizioni/crea/route.ts#L3129) e
[v1:698](app/api/v1/shipments/route.ts#L698): NON chiamare `addebitaCatena` quando il corriere è
`moovexpress`. All'owner reale (`tipo='poste'`/diretto) resta invariato (è il costo vero → `credito_proprio`).
Effetto: spariscono i `credito_proprio`-fantasma dei rivenditori a ogni salto; il ledger lato venditore
([v1:680](app/api/v1/shipments/route.ts#L680)) resta ed È il pagamento verso il fornitore.

**①' Report (ACCOPPIATO — RPC CONDIVISA DA TUTTI, massima prudenza)** — `guadagno_spedizioni_serie_v1`
(+ `lib/guadagno-agente.ts`) legge il costo di un master dai movimenti `master_target_id = M`; tolto il
doppio, per le spedizioni `moovexpress` il costo del rivenditore va letto dal **ledger** (il suo conto
sotto il venditore). Modifica **guardata alla condivisione**; test obbligatorio: per i contratti normali il
report deve restare IDENTICO al centesimo (confronto prima/dopo sui dati veri).

**② Fuga credenziale + dispatch sub-albero** — [copia-listino-submaster.ts:125](lib/copia-listino-submaster.ts#L125):
per `moovexpress` NON copiare `credenziali` al sotto-master (è la chiave di un altro master). Il sotto-master
non ha un ponte proprio: la sua spedizione addebita `masters.credito` verso il padre (conto ESISTENTE) e il
dispatch parte dal primo detentore-codice (il padre) col suo ponte. I contratti reali (FedEx/GLS…) continuano
a copiare le credenziali come oggi (il sub spedisce sull'account del detentore — giusto).

**③ Resi/giacenze/COD** — `lib/giacenza-cascata.ts`, `lib/contrassegni-catena.ts`: per i contratti
`moovexpress` seguire la STESSA catena-fornitore della spedizione (non il tree-walk cieco). Guardato a
moovexpress: i contratti normali restano col tree-walk di oggi.

**Verifica 1000x1000 (ordine):**
1. Banco a master finti verde su spedizione/reso/giacenza/COD — FATTO (riproduce i 6 movimenti reali).
2. Resolver read-only: ricalcola la catena reale `282224J028331` col modello e combacia (shadow, zero scritture).
3. Diff completo a Lorenzo PRIMA di qualsiasi deploy.
4. Deploy (sicuro: condivisione senza volume vero; normali intatti; report verificato identico al centesimo).
5. Spedizioni di prova dal vivo di Lorenzo sugli intrecci → verde → poi si aprono i 40 master.
6. Riconciliare i 6 movimenti di `282224J028331`.
