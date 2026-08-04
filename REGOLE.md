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
| Una giacenza aperta va addebitata, sempre | trigger `trg_giacenza_da_addebitare` → coda `giacenze_da_addebitare` |
| Un reso va addebitato, anche se arriva dal corriere | trigger `trg_reso_da_addebitare` → coda `resi_da_addebitare` |
| A quale conto appartiene un movimento | trigger `trg_conto_movimento` → `fn_conto_di` |
| I soldi finiscono sul conto giusto | `registra_movimento_master` chiama `fn_conto_di` |
| Cancellare un contratto porta via la sua configurazione | vincoli `on delete cascade` (zone, fasce, supplementi, listini) |
| ...ma **non** spedizioni, ritiri e distinte | quei vincoli restano bloccanti, di proposito |
| Chi detiene un contratto | colonna `corrieri.proprio` — dichiarato, non dedotto dal nome |
| Contatori spedizioni, audit sui listini | trigger `trg_conta_spedizione`, `trg_audit` |

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
| Contratti sospesi da un master più in alto | `lib/contratti-catena.ts` → `contrattiSospesiSopra` |
| Il prezzo del reso è solo nolo | `lib/reso-prezzi.ts` |

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

---

## Ancora scritte in più posti — il rischio noto

Da sistemare, e da guardare con sospetto quando si tocca qualcosa lì vicino.

- **Il preventivo via API** (`/api/v1/rates`) non applica i limiti del collo: quota un prezzo per un
  collo che poi la creazione rifiuta.
- **Il prezzo cambia con l'ortografia del comune**: `filtraCapCondiviso` scarta le righe a CAP
  esatto quando il comune scritto non combacia con quello a listino. "PIANA DI MONTE VENA" 5,34 €,
  "Piana di Monte Verna" 14,95 €.
- **Il logo dell'etichetta accetta solo PNG**: con un JPG sparisce in silenzio.
- **Il messaggio dell'autista** dice "non è fra le tue consegne" senza sapere il perché: la ricerca
  è solo sulle consegne già caricate.

---

## Come misurare, senza prendere abbagli

Due trappole in cui si è già caduti, entrambe nello stesso giorno:

- **I movimenti non conservano il numero del momento della creazione.** Un lavoro pianificato
  riscrive le descrizioni sostituendo i numeri provvisori: guardando lì, le ore passate sembrano
  sempre pulite e si conclude il contrario del vero.
- **Contare le occorrenze di un nome nei file non dice se un controllo c'è.** Le regole stanno nelle
  librerie condivise: il file che le usa non nomina le impostazioni. Si misura il comportamento,
  non le parole.

Quando si tocca il motore dei prezzi o il credito, la verifica non è "compila": è rieseguire il
calcolo sui dati veri di produzione, prima e dopo, e confrontare — comprese le spedizioni che oggi
passano, per accertarsi di non averne bloccata nessuna per sbaglio.
