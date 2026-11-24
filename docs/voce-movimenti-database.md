# Voce dei movimenti a mano: cosa serve nel database prima del rilascio

Il codice di questo ramo manda la voce scelta dal master (`lib/movimento-manuale.ts`) alle due funzioni che
registrano i movimenti. Finché il database non la conosce, la chiamata si ferma con PGRST202 (funzione con
quel campo non trovata) e **non scrive niente**: è stato provato il 24/11/2026 su una funzione di sola
lettura. Quindi il database va preparato **prima** di rilasciare il codice.

Lo storico non si tocca (decisione di Lorenzo, 24/11): i movimenti già scritti restano senza voce.

## 1. La colonna

- `movimenti.voce text`, vuota per lo storico e per i movimenti automatici.
- Un vincolo che ammette solo le 13 voci di `VOCI_MANUALI` oppure il vuoto.
- Niente valore predefinito: il vuoto vuol dire «scritto prima della voce, o non a mano».

## 2. Le due funzioni di scrittura

`registra_movimento_cliente` e `registra_movimento_master` prendono un parametro in più, `p_voce text default null`,
e lo scrivono sulla riga. Prima di cambiarle:

- leggere il testo di oggi (`pg_get_functiondef`);
- tenere identici SECURITY DEFINER, search_path e permessi. La rotta `/api/movimenti/crea` chiama la funzione del
  cliente con la sessione del master, quindi `authenticated` deve poterla ancora eseguire come oggi. Va tolto
  solo ciò che oggi non c'è, e la versione vecchia senza `p_voce` non deve restare in giro con permessi diversi;
- controllare gli advisors: zero errori.

## 3. Il guadagno

Le funzioni del guadagno non contano le voci «soldi tra voi»: ricarica, fattura, contrassegni, trasferimento,
storno, altro. Sono almeno `guadagno_ingrosso_adj_v1` e `guadagno_master_serie_v1`; prima di cambiarle va cercato
ogni altro calcolo che legge `rettifica` o `ricarica` per il guadagno.

Verifica: rieseguire il guadagno di tutti i master, per ogni mese, prima e dopo. Lo storico non ha voce, quindi
la differenza deve essere **zero al centesimo** su tutto. Uno scarto vuol dire che la modifica tocca qualcosa
che non doveva.

## 4. Ordine del rilascio

Prima il database (colonna, poi funzioni col parametro facoltativo, poi guadagno), poi il codice. Con l'ordine
inverso le registrazioni dalla scheda si fermano con un errore finché il database non è pronto.
