# Condivisione contratti tra master

Un master può **rivendere un suo contratto a un altro master**, in qualunque posizione dell'albero
(non solo padre→figlio: anche figlio→padre, o fra rami diversi). È una capacità **generale**: vale
per *ogni* master, per ruolo/flag, **mai** inchiodata a un id o a un nome (vedi REGOLE.md e la regola
"generalità per tutti i master"). Velox↔MULTIEXPRESS è solo il primo collaudo.

## Perché non si tocca l'albero (la scelta di fondo)

La rete è un albero: i contratti **cascano padre→figlio**, e la catena costi/ricavi (`lib/cascata.ts`)
sale dal venditore fino al detentore, che si assume stia **a monte**. Far vendere un contratto verso
l'alto/laterale attraverso l'albero significherebbe riscrivere quella catena (25.385 addebiti a
settimana): troppo rischio.

**Invece i due alberi NON dialogano.** Il ponte è l'**API**, non la parentela:

- **Lato venditore:** il compratore è, sotto il cofano, un normale **cliente** del venditore (con
  listino + api_key). Così movimenti, credito, resi, contrassegni **funzionano già tutti**, verso il
  basso nell'albero del venditore. Nessun codice nuovo qui.
- **Lato compratore:** un **nuovo tipo di corriere `moovexpress`** — un provider come Spedisci.online
  — che con quella api_key chiama l'`/api/v1` del venditore. Il compratore lo rivende giù per la SUA
  rete, normalmente.

Ogni lato resta **verso il basso nel suo albero**. Nessuna chirurgia sulla catena. È la federazione a
API key: il giorno che i portali diventeranno domìni separati, il confine è già un'API.

## `moovexpress` è un provider multi-contratto (come Spedisci.online)

Un provider è **un account** (`credenziali`) con **dentro più contratti**. In `tipo='spedisci'` il
corriere reale sotto lo dice `credenziali.carrier_code` ([lib/spedisci.ts](lib/spedisci.ts)). Uguale
per `moovexpress`:

- La **api_key del venditore** = l'account.
- Ogni **contratto condiviso** (BRT-via-Velox, Poste-via-Velox…) = **una riga `corrieri`**
  `tipo='moovexpress'` che punta a quel contratto.
- Il compratore ne collega **uno o più**, come accende i vettori dentro un account provider.

La condivisione è **per-contratto**, decisa dal venditore: marca quali suoi contratti sono
`condivisibile`, e per ognuno il prezzo d'ingrosso. Non passa mai tutto l'account.

## Connettersi: il codice master (niente elenco di aziende)

Nessuno naviga la lista dei master registrati. Ogni master ha un **codice** (`masters.codice_condivisione`),
**lungo e casuale** (non enumerabile), **rigenerabile**. Per condividere, il venditore deve **avere il
codice** del compratore — che glielo passa fuori piattaforma.

Flusso:
1. Il compratore copia il **suo codice** dal portale, lo passa al venditore.
2. Il venditore incolla il codice → il sistema gli mostra **solo il nome** confermato → assegna
   **contratti + listini**.
3. Il compratore riceve una condivisione **in attesa**, vede **chi** e **cosa** → **accetta** → il
   contratto compare tra i suoi corrieri.

Il codice è **"a chi", non il permesso**: a far entrare il contratto è l'**ACCETTA**. Un codice che
trapela = al massimo una richiesta da rifiutare; **nessun dato esce** prima dell'accetta.

## Sicurezza e isolamento

- **Una api_key per (compratore × contratto)** — è già così: `api_keys` risolve a un solo
  `(cliente, master, corriere)` ([lib/api-auth.ts](lib/api-auth.ts)). Mai una key condivisa: la key
  *è* l'identità. Un altro compratore = un'altra key, isolata dalla RLS. Revocabile a sé.
- **Le credenziali VERE del corriere** (l'account reale BRT/Poste) restano in `corrieri.credenziali`
  del **detentore** e **non escono mai**: il compratore riceve solo la sua api_key.
- **I nomi dei fornitori tecnici non escono** (REGOLE.md #8): il compratore vede il **brand**
  (BRT, Poste), mai il provider tecnico sotto. L'`/api/v1` già sanifica i nomi a monte.
- **Consenso:** il contratto diventa operativo solo dopo l'**accetta** del compratore — il venditore
  non può iniettargli obblighi/addebiti.

## Flusso soldi (X = costo fornitore, W = ingrosso, R = retail)

- **Venditore:** −X (costo reale) +W (il compratore-cliente gli paga) → margine **W − X**, tracciato
  nel suo albero come un cliente qualsiasi.
- **Compratore:** costo W, vende a R giù per la sua rete → margine **R − W**.
- **Cliente finale:** paga R, non vede né il venditore né il fornitore tecnico.

Il **credito** compratore↔venditore usa il `tipo_contratto` esistente: **prepagato** (ricarica, si
ferma a zero) di default, con interruttore **a fattura** (può andare sotto zero) per i fidati.

## Ciclo di vita (via `/api/v1` + webhook in uscita)

Ogni evento del corriere reale risale venditore→compratore e si posa sulla spedizione del compratore:
etichetta, **tracking**, **contrassegno** (a due salti: corriere→venditore→compratore→cliente),
**resi** (solo nolo, a ogni livello), **giacenze**, **annullo** (con storno da entrambi i lati). Si
riusa il canale **webhook in uscita** (4 eventi, HMAC) già esistente.

## Componenti da costruire

1. **Codice master** + pagina "il tuo codice" / rigenera.
2. **Lato venditore — "Contratti che rivendo":** incolla codice → assegna contratti (`condivisibile`)
   + listino ingrosso → crea la condivisione. Sotto il cofano: cliente-ledger invisibile + api_key.
3. **Lato compratore — "Contratti presi da fornitori":** accetta → materializza la riga `corrieri`
   `tipo='moovexpress'`.
4. **`lib/moovexpress.ts`:** integrazione provider (create/label/cancel/track/COD) verso l'`/api/v1`
   del venditore.
5. **Ciclo di vita:** webhook tracking/COD/resi/giacenze/annullo venditore→compratore.
6. **Viste conto:** ognuno dal SUO portale vede il dovuto/pagato dell'altro (mai il portale altrui).

## Fasi

1. **Dati (zero rischio sul motore):** codice master + estensione `corrieri_condivisi` (stato,
   credito, pointer) + RLS. *(schema sotto)*
2. **Venditore:** codice, incolla-codice, assegna contratti+listino, crea condivisione + api_key +
   cliente-ledger.
3. **Compratore:** accetta + materializza `corrieri` `moovexpress`.
4. **`lib/moovexpress.ts`:** create + etichetta + tracking (il minimo per spedire).
5. **Contrassegno** end-to-end.
6. **Resi + giacenze + annullo.**
7. **Canary** su una coppia reale, verifica movimenti prima/dopo da entrambi i lati.
8. Apertura a combinazioni libere.

## Schema Fase 1

Additivo, non tocca nulla di esistente:

- `masters.codice_condivisione text` — unico, casuale (non enumerabile), rigenerabile. Scritto solo
  da service-role (non nel set auto-scrivibile dal master). Generato per tutti i master esistenti.
- `corrieri_condivisi` (oggi scheletro: id, corriere_id [del venditore], master_id [compratore],
  created_at) — si estende con:
  - `stato text default 'in_attesa'` — in_attesa | attiva | rifiutata | revocata
  - `credito_modo text default 'prepagato'` — prepagato | fattura
  - `cliente_ledger_id uuid` — il cliente invisibile sotto il venditore (Fase 2)
  - `corriere_acquirente_id uuid` — la riga `moovexpress` creata all'accetta (Fase 3)
  - `accettata_il`, `revocata_il timestamptz`
  - RLS attiva + `revoke` da anon/authenticated + advisors a 0 (REGOLE.md).
- `corrieri.condivisibile` (già esiste): il venditore marca quali suoi contratti sono condivisibili.

## Regole da rispettare (REGOLE.md)

- Nomi dei fornitori tecnici mai verso master/clienti (#8).
- Lo storico non si cancella (#9).
- Ogni tabella/funzione nuova: RLS + revoke anon/authenticated + advisors a 0.
- Toccando prezzi/credito (Fasi 4+): rieseguire il calcolo sui dati veri di produzione, prima e dopo,
  comprese le spedizioni che oggi passano — e dietro interruttore, con canary.
