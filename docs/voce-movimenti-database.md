# Voce dei movimenti a mano: il database

**Applicato in produzione il 24/11/2026 alle 18:11 UTC** con `docs/voce-movimenti.sql`, dopo averlo provato sul ramo di
prova di Supabase. Per tornare indietro: `docs/voce-movimenti-indietro.sql`. Lo storico non si tocca (decisione di
Lorenzo): i movimenti già scritti restano senza voce.

## Cosa c'è

- **`movimenti.voce`**: vuota per lo storico e per i movimenti automatici. Un controllo `NOT VALID` ammette solo le 13
  voci di `VOCI_MANUALI`: vale per ogni riga nuova senza rileggere tutto il registro.
- **Le due funzioni che muovono il credito** (`registra_movimento_cliente` e `registra_movimento_master`) **non sono
  cambiate**: stessa impronta e stessi permessi di prima. Accanto a ciascuna c'è una versione con lo stesso nome che
  chiede la voce come campo obbligatorio. Una chiamata senza voce trova solo quella di sempre, una con la voce trova
  solo questa: non c'è mai da scegliere fra le due. La versione nuova:
  - segna la voce per la sua transazione (`set_config` locale);
  - chiama la funzione di sempre;
  - lascia al controllo `trg_voce_movimento` il compito di copiarla sulla riga.
  È `SECURITY INVOKER`, quindi chi può scrivere su chi lo decide ancora la funzione di sempre.
- **Il guadagno.**
  - `guadagno_ingrosso_adj_v1` non conta più, sul conto d'acquisto, i movimenti con voce «soldi tra voi»: ricarica,
    fattura, contrassegni, trasferimento, storno, altro.
  - `guadagno_master_serie_v1` conta anche senza spedizione i costi del master: fuori portale, compenso agente,
    bonus.

## Perché non si sono riscritte le due funzioni

La prima versione le cancellava e le ricreava con un campo in più. Il collegamento Supabase rifiuta ogni modifica
con un `DROP`, e comunque in quel modo la logica dei soldi sarebbe stata riscritta da capo. Con la versione accanto,
quella logica resta in un posto solo.

## Le prove

Sul ramo di prova, tutto in un blocco annullato alla fine:
- **Con la voce:** il credito si muove e la riga porta la voce.
- **Senza voce:** va alla funzione di sempre, voce vuota.
- **Dopo la chiamata:** la voce non resta in giro per le scritture successive.
- **Voce inventata:** rifiutata dal controllo sulla tabella.
- **Bonus +50:** entra nel guadagno del master (−50), la fattura no.
- **Caso Wave:** sul conto d'acquisto, fattura −30, storico −7 e bonus −4 alzano i costi ingrosso di 11,00, non di
  41.
- **Permessi:** `anon` non esegue le funzioni nuove.

In produzione:
- **Guadagno identico al centesimo prima e dopo.** Correzione ingrosso dei 7 master con conto d'acquisto per
  settembre, ottobre e novembre fino alle 17:00 UTC del 24/11. Guadagno dei 53 master non demo nello stesso periodo,
  confrontato per impronta.
- **Le funzioni di sempre** hanno impronta e permessi invariati.
- **Le scritture automatiche** continuano senza errori: 54 movimenti nei primi 3 minuti e 16 chiamate API.
- **Con la chiave pubblica** tutte e quattro le chiamate, con e senza voce, trovano la loro funzione e rispondono
  «permesso negato».
- **Gli advisors** non segnalano niente di nuovo.

Dati delle prove: `~/moovexpress-redesign/riferimenti-rifatti/voce-movimenti-db/`.

## Ordine del rilascio

Il database è già pronto e non cambia niente per il codice di oggi, che non manda la voce. Il codice di questo ramo
si può rilasciare quando si vuole.

## Da fare dopo

Tre pagine mostrano ancora i movimenti a mano senza guardare la voce. Non toccano il guadagno, ma si possono pulire:
- «Dal mio network» (`lib/network-ricevuti.ts`): le rettifiche a mano del livello sopra;
- il report Ricariche;
- la Salute del conto (`lib/salute-conto.ts`): le ricariche dei sotto-master confrontate con la banca.
