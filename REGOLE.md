# Le regole di MoovExpress

Questo file dice **quali sono le regole che valgono soldi** e **dove sono scritte**. Serve a una
cosa sola: prima di modificare qualcosa, sapere se la regola che stai toccando vive in un posto o
in tre.

La lezione che ha prodotto questo documento: in una sola giornata, tre guasti diversi avevano la
stessa causa — la stessa regola copiata in più punti, e uno dei punti rimasto indietro. Il cliente
vedeva un prezzo e ne pagava un altro; una giacenza veniva addebitata da una porta e non dall'altra;
un reso lo pagava chi passava per lo svincolo e non chi tornava dal corriere.

**Il criterio**: una regola che decide chi paga cosa non va messa in ogni porta sperando che nessuno
se la dimentichi. Va messa dove le porte passano tutte — meglio ancora nel database, dove nessuna
rotta può aggirarla, nemmeno una che nascerà domani.

---

## Regole garantite dal database

Qui non serve ricordarsene: il database le applica da solo, da qualunque strada arrivi la scrittura.

| Regola | Come |
|---|---|
| Ogni cliente vede solo i propri dati | RLS per-tenant su tutte le tabelle (`mia_rete_master`) |
| Il credito si muove solo dalle funzioni dei movimenti | trigger `fn_credito_solo_via_rpc` su `clienti` e `masters` |
| Un reso non si addebita due volte | indici unici parziali `uniq_mov_reso_cliente` / `uniq_mov_reso_master` |
| Il prezzo del reso: percentuale, ripiego, transazione unica | `fn_addebita_resi` |
| Una giacenza la apre solo il fornitore, mai una lettura di Poste | trigger `trg_giacenza_solo_dal_fornitore`: `in_giacenza` senza `giacenza_data` non passa (fuori il circuito interno) |
| Una giacenza aperta va addebitata, sempre | trigger `trg_giacenza_da_addebitare` → coda `giacenze_da_addebitare` |
| Pacco consegnato o reso: la giacenza si chiude e le richieste in sospeso si annullano | trigger `trg_chiudi_giacenza_terminale` (non tocca `svincolata` né le richieste confermate) |
| Un reso va addebitato, anche se arriva dal corriere | trigger `trg_reso_da_addebitare` → coda `resi_da_addebitare` |
| A quale conto appartiene un movimento | trigger `trg_conto_movimento` → `fn_conto_di` |
| I soldi finiscono sul conto giusto | `registra_movimento_master` chiama `fn_conto_di` |
| Cancellare un contratto porta via la sua configurazione | vincoli `on delete cascade` (zone, fasce, supplementi, listini) |
| ...ma **non** spedizioni, ritiri e distinte | quei vincoli restano bloccanti, di proposito |
| Il canone non passa dai movimenti | trigger `trg_no_canone_su_movimenti` (si paga con carta, mai dal credito) |
| La giacenza di magazzino e' il saldo di un registro | trigger `trg_articolo_saldo` da `articoli_movimenti` |
| Un pacco non scarica due volte lo stesso articolo | indice unico `uniq_artmov_sped_articolo` |
| Se la spedizione salta, la merce rientra | trigger `trg_articoli_rientro` (annullo effettivo e reso, **non** il pending) |
| ...e rientra una volta sola | indice unico parziale `uniq_artmov_rientro` |
| Chi detiene un contratto, oggi | colonna `corrieri.proprio`, ricalcolata da `fn_ricalcola_corrieri_proprio` per albero e nome ESATTO: due contratti diversi con lo stesso nome li confonde (le 2 'GLS CASERTA' di GTS). La sostituisce, per ultima, la riga senza fornitore (sotto) |
| Da chi compra ogni master un contratto, e quale contratto è (il CODICE): una fila lineare, non l'albero | colonne `corrieri.fornitore_corriere_id`, `collegamento_id`, `contratto_id` (14/10/2026), tenute dal trigger `trg_corrieri_catena_contratto`; lettura `catena_contratto(corriere_id)`, sentinella `controllo_catena_contratti()` (vuota = sano). Fase 1: nessun codice le legge ancora. Script e regole: `scripts/contratto-codice-catena.sql` |
| Dal portale non si dichiara "propria" una copia, né si cambia da chi si compra, il tipo o il master di un contratto | stesso trigger: con un PATCH diretto un master poteva segnare propria la sua copia e smettere di pagare chi gliela vende |
| Contatori spedizioni, audit sui listini | trigger `trg_conta_spedizione`, `trg_audit` |
| Il pacchetto API si consuma **solo** con le API | trigger `fn_conta_spedizione_cliente` filtra `canale = 'api'` |
| Chi paga le API non se lo decide da solo | trigger `trg_api_solo_piattaforma` su `clienti` (campi `api_*`: solo chiave di servizio) |
| Un master non si promuove, e non si stacca dalla catena | trigger `trg_master_campi_di_sistema` (`is_super_master`, `parent_master_id`, `abbonamento_*`, `stripe_*`) |
| Un cliente nasce **senza** pagare le API | default `clienti.api_esente = true` |
| Se le API sono ferme, e perché | `fn_stato_api_cliente` — unica fonte, usata sia dal blocco sia dai pannelli |

**Le due code funzionano così**: il database registra il *fatto* (c'è da addebitare), il lavoro
pianificato calcola il *prezzo* e addebita. La regola sta nel database, la tariffa nell'applicazione
— che è dove vive il motore dei listini. Se un addebito fallisce la riga resta in coda e si riprova,
contando i tentativi: dopo cinque smette e resta a vista, invece di sparire.

---

## Regole in una funzione sola (codice, ma non duplicate)

Vivono nel codice, ma in **un punto solo** che tutti chiamano. Modificarle lì vale ovunque.

| Regola | Dove |
|---|---|
| Chi può vedere la rete (non cliente, non agente, non autista) | `lib/perimetro.ts` → `vedeLaRete` |
| Si tassa sul peso reale o sul volumetrico | `lib/agevolazione-misure.ts` → `pesoSuReale` |
| Limiti del collo: misure, peso, colli, scaglioni | `lib/limiti-collo.ts` → `superaLimitiCollo`, `motivoLimiteCollo` |
| Quale zona rivendica un CAP | `lib/zone-match.ts` → `trovaZoneMatchDett` |
| Fin dove risale la catena degli addebiti | `lib/giacenza-cascata.ts` → `catenaContratto` (si ferma su `proprio`) |
| Contratti sospesi da un master più in alto, e perché (in pausa, oppure tolti). Una copia reale la offre solo una riga reale del padre, mai un suo ponte | `lib/contratti-catena.ts` → `contrattiSospesiSopra`, `contrattiRimossiConMotivo` |
| Quali contratti un master compra da un altro master via codice (ponti codice): il padre-albero non li spegne, non gli riscrive prezzi e zone, non li nasconde per nome | `lib/ponti-codice.ts` → `pontiCodiceDi` |
| Se un contratto si può condividere con un master collegato. Su un master c'è una riga sola per nome; se il suo master gliel'ha tolto, il collegato lo sostituisce (su conferma coi numeri, solo senza storico, togliendo anche le copie sotto di lui) | `lib/condivisione-engine.ts` → `valutaContrattoPerCompratore`, usata da Assegna, scheda del collegato e riallineamento |
| Eliminare un contratto: le SUE spedizioni, ritiri e distinte lo bloccano nel database, la configurazione cade in cascata con un DELETE solo. Le copie dei sotto-master non le guarda: vedi sotto | `lib/elimina-contratto.ts` → `eliminaContrattiSenzaStorico` |
| Il prezzo del reso è solo nolo | `lib/reso-prezzi.ts` |
| Quali tariffe si possono offrire a un cliente: contratto in catena, contratti "a un punto", locker a taglia | `lib/tariffe-offerte.ts` → `soloCorrieriInCatena`, `annotaPuntoPoste` + `eTariffaAUnPunto`, `contrattiConFasceATaglia` |
| "Prezzo minore" o "contratto scelto" nelle porte di massa del cliente (import da file, ordini dei negozi) | `app/cliente/anteprima-prezzi.ts` → `scegliTariffa` (la stessa per mostrare e per spedire) |
| Il prezzo mostrato PRIMA di spedire nelle porte di massa | `lib/anteprima-prezzi.ts` → `prezziPerRighe`: elenco dei contratti dal motore del preventivo, cifra dalla funzione dell'addebito |
| Il GLS diretto spedisce solo in Italia (a GLS non arriva il paese: l'estero torna "GLS Check") | `lib/gls.ts` → `glsDirettoFuoriItalia`, chiamata dai due preventivi (cliente e spedizione propria del master) e dalla creazione, prima del credito. L'API pubblica non crea GLS diretto per niente |

Due funzioni nate il 13 ottobre **non** stanno in questa tabella, perché hanno ancora un doppione
(vedi sotto, «Ancora scritte in più posti»): `lib/citta-spedizione.ts` → `cittaPerLaSpedizione` e
`lib/prezzo-cliente.ts` → `prezzoClienteDaListino`.

---

## Le regole di sostanza, in parole

Queste sono decisioni del committente, non scelte tecniche. Il codice deve rispettarle.

1. **Una zona senza prezzo non è vendibile.** Il corriere va *escluso*, non venduto al prezzo
   Italia. Vale soprattutto per zone disagiate, isole minori, Livigno.
2. **Il reso è solo nolo.** Niente contrassegno, assicurazione o supplementi: quelli li ha già
   pagati all'andata.
3. **Il divisore volumetrico lo assegna il master di sopra**, a scendere fino al detentore del
   contratto.
4. **Un contratto proprio ferma la catena.** Se un master porta un contratto suo, ne è il
   detentore: chi sta sopra non lo vede e non lo paga.
5. **Due conti separati.** Ciò che un master spende sui contratti suoi non si mescola con ciò che
   deve al master sopra. Le ricariche vanno sempre sul conto rete. I clienti hanno un conto solo:
   devono al proprio master comunque.
6. **Il blocco per credito vale solo se il conto è a credito** (`tipo_contratto = 'credito_scalare'`)
   **e solo sul conto esaurito.** Chi fattura va sotto zero ed è normale.
7. **Il congelamento per canone non pagato ferma solo chi non paga.** Può fare una cosa sola:
   pagare. La sua rete sotto continua a lavorare, perché il conto è di ciascuno.
8. **I nomi dei fornitori tecnici non escono mai** verso master, agenti e clienti. Unica eccezione:
   la riconciliazione dei costi di E&A MULTIEXPRESS.
9. **Lo storico non si cancella.** Spedizioni, ritiri, distinte e movimenti restano anche quando si
   cancella ciò che li ha generati.
10. **Le API le paga solo chi rivende** le spedizioni fuori dal portale; chi le usa per spedire la
    propria merce non paga niente. La differenza non è calcolabile — una chiamata è identica nei due
    casi — quindi la decide **una persona**, e solo il super master: l'incasso è della piattaforma,
    su Stripe non c'è nessuno split verso il master di riferimento. Si accende da
    *Dashboard → Abbonamenti API*, che accanto all'interruttore mostra l'indizio: la quota di
    spedizioni partite dal mittente più usato. Vicino al 100% è un magazzino solo (merce propria),
    sotto il 70% con molti mittenti diversi sono spedizioni di altri.
11. **La commissione contrassegno di BRT dipende dal PESO REALE, e il costo reale è questo**
    (contratto "BRT Express" via SpediamoPro, servizi 29 ≤5kg e 28 >5kg — verificato dal vivo il
    25/09 su ogni importo da 40 € a 3.000 €):
    - **peso reale ≤ 5 kg → € 1,97 fissi**, qualunque sia l'importo del contrassegno;
    - **peso reale > 5 kg → € 1,97 fino a 1.000 € di contrassegno, poi l'1% dell'INTERO importo**
      (non della sola parte oltre i 1.000 €: a 1.100 € sono 11,00 €, a 1.500 € sono 15,00 €).
    Un solo scaglione per valore non basta: si configura in `listini_corrieri_supplementi`
    (`tipo=contrassegno`) con la banda peso (`peso_min`/`peso_max`, sul peso reale) e, per il peso
    pesante, due scaglioni per importo (`valore_max` 1000 fisso 1,97 · `valore_max` 5000 `perc`=1
    `calcolo_su=totale`). L'errore già visto: l'1% messo sulla banda ≤5kg invece che su quella >5kg
    (sped. 050011292960895, MULTI addebitava 6,90 invece di 6,47) — corretto il 25/09.

---

## Ancora scritte in più posti — il rischio noto

Da sistemare, e da guardare con sospetto quando si tocca qualcosa lì vicino.

- **Eliminare un contratto guarda solo lo storico della SUA riga, non quello delle copie dei
  sotto-master.** Caso vero (13 ottobre): il "GLS CASERTA Consegna Diretta" di MULTIEXPRESS ha 0
  spedizioni sulla sua riga, mentre la copia di GTS ne ha 2.366 in trenta giorni. Se MULTIEXPRESS lo
  eliminasse dal portale, il ricalcolo di `proprio` farebbe delle copie i detentori: GTS
  continuerebbe a spedire sull'account di MULTIEXPRESS e la catena dei costi si fermerebbe a GTS,
  cioè MULTIEXPRESS pagherebbe il corriere senza essere pagato. Succedeva anche prima che
  l'eliminazione passasse da `lib/elimina-contratto.ts`. Non toccato: bloccarla quando sotto ci
  sono copie cambia cosa un master può fare dal portale, e va deciso.
  Dal 14/10 il fatto almeno resta scritto: le copie tengono il puntatore alla riga cancellata e il
  codice del contratto, e `controllo_catena_contratti()` le elenca in `fornitore_cancellato`. Quando i
  lettori passeranno ai puntatori, una fila interrotta va trattata come contratto sospeso, mai come
  contratto proprio.
- **Il comune scritto diversamente fa perdere la zona speciale.** Se il comune non combacia con
  nessuno di quelli elencati per quel CAP, la zona speciale non viene rivendicata e si finisce su
  "Italia".
  **La misura "circa 43 al mese" che stava qui era sbagliata di dieci volte**: contate il 6 agosto,
  sono **307 spedizioni in sette giorni** che toccano uno dei **541 CAP** rivendicati solo per certi
  comuni. Non tutte finiscono in perdita — il grosso del danno veniva da un'altra causa, ora chiusa
  (vedi sotto) — ma il perimetro è quello, e va ricordato quando si tocca `filtraCapCondiviso`.
  Il residuo vero di *questo* problema, dopo la chiusura di quell'altra: 13 spedizioni dal portale
  per 63,78 € (Portoferraio, Murano, Carloforte, Brugnato).
  È una scelta, non una svista. Il 4 agosto avevo aggiunto la regola opposta — «se per quel CAP è
  nominato un solo comune, allora è lo stesso posto scritto male» — e il giorno dopo l'ho tolta,
  perché non distingue *Piana di Monte Vena* (refuso) da *Brugnato*, che è un comune diverso che
  condivide il CAP con Sesta Godano. Peggio: il numero di comuni nominati **dipende da quali righe
  arrivano alla funzione**, e al cliente e ai master ne arrivano insiemi diversi — così la stessa
  spedizione veniva prezzata Italia al cliente e disagiata al master, e la differenza la pagava il
  master. Sei spedizioni in sedici ore.
  **La cura vera esiste e ce l'abbiamo in casa**: `lib/data/comuni.json` (7.904 comuni con CAP e
  provincia) e `lib/data/frazioni.json` (9.878). Con quelli si distingue una frazione da un comune
  omonimo di CAP, invece di indovinare. Fatto per la creazione: `lib/valida-citta.ts` li usa, e
  `lib/citta-spedizione.ts` decide — se la città non è un nome noto per un CAP con zona speciale, la
  spedizione si ferma; per import e negozi, quando il CAP è di un solo comune, la città viene
  corretta da sola. Resta aperto il CAP condiviso fra più comuni con una città che non combacia con
  nessuno: lì ci si ferma, non si decide.
- **Preventivo e addebito sono due calcoli diversi.** Il prezzo che il cliente PAGA lo decide la
  creazione (`lib/prezzo-cliente.ts`, sopra `calcolaPrezzoListino`); quello che VEDE nel modulo
  della spedizione singola (cliente e master) e sul sito pubblico è il totale del motore del
  preventivo (`lib/tariffe-motore.ts`), scritto a parte: arrotonda in un altro modo, decide a modo
  suo su quale peso si tassa, non conosce le fasce a taglia, e non corregge la città. Misurato il
  13 ottobre su 185 spedizioni vere nate da import e negozi: preventivo uguale al pagato su 184, 1
  diversa di un centesimo — ma quando la città è scritta diversa dal nome ufficiale su un CAP con zona speciale
  lo scarto è di euro (caso vero del 13 ottobre, import da file, CAP 87051: 6,12 calcolati dal
  preventivo e mandati alla creazione senza essere mostrati, 13,65 addebitati; succedeva solo nelle
  porte di massa, dove la creazione corregge la città — nei moduli singoli la blocca). La creazione
  addebita **il maggiore** fra il suo calcolo e l'importo che riceve dalla pagina.
  Chiuso il 13 ottobre per le due porte di massa del cliente (import da file, ordini dei negozi):
  lì il prezzo mostrato e mandato alla creazione esce dalla funzione dell'addebito. Verifica: 200
  spedizioni vere rieseguite — per le 180 il cui contratto l'anteprima offre, il prezzo è uguale al
  calcolo dell'addebito e al pagato su 180. Delle altre 20: in 16 l'anteprima oggi non offre il
  contratto con cui erano partite (3 contratti a un punto, 13 che il motore non propone più a quel
  cliente), 4 non le prezza nemmeno il calcolo dell'addebito (fra queste, due città non
  riconosciute per il CAP). In nessun caso l'anteprima dà un prezzo dove il calcolo dell'addebito
  (città + listino) non prezza; gli altri rifiuti della creazione — credito lungo la catena,
  telefono richiesto dal corriere, risposta del corriere — la prova non li copre.
  **Restano sul totale del motore**: i due moduli "Nuova spedizione" e il sito pubblico.
- **La città della spedizione e la somma del prezzo: l'API pubblica ha le sue copie.**
  `cittaPerLaSpedizione` e `prezzoClienteDaListino` le chiamano la creazione del portale e
  l'anteprima. `app/api/v1/shipments` ha ancora in linea sia il blocco città↔CAP (blocca sempre,
  non normalizza mai; il suo messaggio nomina `shipTo.city`) sia la somma trasporto + contrassegno
  + assicurazione; `app/api/v1/rates` la stessa somma. Oggi danno lo stesso numero (stesse due
  funzioni di `lib/pricing.ts`, l'API non ha servizi accessori): chi cambia la formula o la regola
  della città in un posto deve allineare l'altro.
- **«È un locker» ha due definizioni.** Quella dichiarata (`corrieri.settings.consegna = 'locker'`)
  c'è solo sul contratto del detentore: sulle copie dei sotto-master è vuota (13 ottobre: vuota su
  17 dei 19 contratti di tipo InPost, tutte le copie; una, "InPost Locker", è nel listino di 264
  clienti di un solo master). L'altra è il listino: un contratto con fasce a taglia (piccola /
  media / grande) è un locker. Le porte di massa e la tendina "Spedisci con" usano **entrambe**,
  con le stesse funzioni (`lib/tariffe-offerte.ts`, chiamate da `lib/anteprima-prezzi.ts` e da
  `app/api/cliente/corrieri`); il modulo della spedizione singola, la creazione
  (`contrattoLocker = settings.consegna === 'locker'`) e l'API pubblica leggono **solo** la prima:
  per loro una copia è una consegna a domicilio, senza scelta del locker.
- **L'elenco dei CAP con zona speciale è caricato a metà.** `lib/cap-speciali.ts` decide se una
  città scritta male va fermata o corretta. Legge zone e righe senza paginazione, e il database ne
  restituisce al massimo mille per lettura: misurato il 13 ottobre, 1.000 zone lette su 2.701 e
  **1.223 CAP caricati su 1.868** (645 fuori). Quali restano fuori dipende dall'ordine in cui
  arrivano le righe, e l'elenco è tenuto in memoria per istanza: lo stesso CAP può essere
  riconosciuto da un server e non da un altro. Su un CAP rimasto fuori, una città scritta male non
  viene né corretta né fermata e la zona speciale può perdersi (è il guasto del primo punto di
  questo elenco). Non toccato: allargare l'elenco ferma spedizioni che oggi passano, quindi va fatto
  rieseguendo prima e dopo sulle spedizioni vere, comprese quelle che passano.
- **Il messaggio dell'autista** dice "non è fra le tue consegne" senza sapere il perché: la ricerca
  è solo sulle consegne già caricate.
- **`master_id` non è un permesso, ma viene usato come tale.** È l'appartenenza al tenant, e ce
  l'hanno anche clienti, agenti e autisti: sotto MoovExpress ci sono quattro utenti con ruolo
  `cliente`, e non per caso — `lib/shopifyProvision.ts` ne crea uno per ogni negozio che installa
  l'app Shopify pubblica. Un controllo scritto «il mio master è super master» quindi *non basta*:
  va sempre accompagnato dal ruolo. Sistemato il 5 agosto nelle due rotte che ce l'avevano
  (`/api/audit`, `/api/root/api-clienti`); da guardare con sospetto ogni volta che se ne scrive una
  nuova riservata al super master.
- **`clienti.tipo_contratto` lo cambia il master su se stesso** (`app/api/master/route.ts`, elenco
  `COLONNE`), e quel campo decide se vale il blocco per credito esaurito. Lasciato com'è perché è
  una scelta esplicita della rotta, non una svista — ma è l'unico campo che vale soldi rimasto
  scrivibile dal diretto interessato.
- **Il credito non ferma la spedizione propria di un master**, né quella per un sotto-master:
  `verificaCreditoCatena` non viene chiamata per quel ramo, e `registra_movimento_master` — a
  differenza della gemella per i clienti — non controlla la capienza. Misurato: un solo addebito ha
  davvero attraversato lo zero (3,96 €), più 44 avvenuti a conto già negativo. Da fare insieme,
  perché la causa è una sola — ma da quella funzione passano 25.385 addebiti a settimana, quindi
  non è una modifica da fare di corsa.

Chiuse il 4-5 agosto, elencate qui perché non vengano "riscoperte": i limiti del collo nel
preventivo via API, il `weight` letto diversamente dalle due porte API, il logo dell'etichetta
(ora riconosciuto dai byte), il perimetro di giacenze e creazione, il credito via API senza
contrassegno.

Chiusa il 6 agosto — **la cascata dell'API addebitava senza il comune**. Delle sette chiamate a
`addebitaCatena` era l'unica a non passare `citta`: perfino la verifica del credito, venti righe
più su nello stesso file, lo passava. Così, dentro la stessa richiesta, il cliente veniva prezzato
col comune e i master addebitati senza — e senza comune la riga «quel CAP ma solo per QUEL comune»
sopravvive e vince, perché il CAP esatto batte la provincia. Costo: 162,37 € addebitati di troppo
a quattro master fra il 17 luglio e il 6 agosto, su 29 spedizioni.
**Non era la propagazione delle zone**, che è risultata corretta ai tre livelli: era la stessa
tabella interrogata con due domande diverse. Il modo in cui si è distinto: dal portale, che il
comune lo passa, 536 spedizioni nella identica situazione e 2 sole in perdita per 0,62 €.

---

## Come misurare, senza prendere abbagli

Due trappole in cui si è già caduti, entrambe nello stesso giorno:

- **I movimenti non conservano il numero del momento della creazione.** Un lavoro pianificato
  riscrive le descrizioni sostituendo i numeri provvisori: guardando lì, le ore passate sembrano
  sempre pulite e si conclude il contrario del vero.
- **Contare le occorrenze di un nome nei file non dice se un controllo c'è.** Le regole stanno nelle
  librerie condivise: il file che le usa non nomina le impostazioni. Si misura il comportamento,
  non le parole.
- **`spedizioni.costo_spedizione` non è quello che si paga.** È un costo nominale del fornitore, a
  volte il quadruplo dell'addebito vero (Lovero: 20,00 in colonna, 5,12 addebitati). Confrontarlo
  con `costo_totale` ha prodotto "239 spedizioni sotto costo per 481 €" quando le vere erano 81 per
  271 €. **Il margine di un livello si calcola solo dai `movimenti`**: quello che incassa dal figlio
  meno quello che gli addebita il padre, sulla stessa `spedizione_id`. Nessuna colonna della riga
  spedizione è una scorciatoia valida — e infatti il portale non la legge mai.

Quando si tocca il motore dei prezzi o il credito, la verifica non è "compila": è rieseguire il
calcolo sui dati veri di produzione, prima e dopo, e confrontare — comprese le spedizioni che oggi
passano, per accertarsi di non averne bloccata nessuna per sbaglio.
