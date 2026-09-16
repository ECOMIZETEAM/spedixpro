// Elenco colonne "leggere" della tabella spedizioni: TUTTE tranne i 3 campi blob
// pesanti (etichetta_url = PDF base64, raw_response = risposta API, colli_dettaglio
// = dettaglio colli con etichette base64). ~300KB/riga risparmiati.
// Nessuna colonna del DB viene rimossa: qui si sceglie solo cosa TRASFERIRE nelle liste.
// I campi esclusi vengono caricati per-id dove servono (download etichetta, tracking).
export const SPED_COLS =
  'id,master_id,cliente_id,corriere_id,numero,mitt_nome,mitt_indirizzo,mitt_citta,mitt_provincia,mitt_cap,mitt_paese,mitt_email,mitt_telefono,dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_cap,dest_paese,dest_email,dest_telefono,notifica_sms,note,rif_destinatario,rif_ordine,colli,peso_reale,peso_volume,peso_fatturato,lunghezza,larghezza,altezza,contenuto,tipo_contenuto,valore_merce,codice_taric,contrassegno,assicurazione,tracking_number,stato,costo_spedizione,costo_totale,fatturato,richiedi_ritiro,data_ritiro,intervallo_ritiro,distinta_id,id_ordine_esterno,canale,created_at,updated_at,stato_contrassegno,distinta_contrassegno_id,cancellata_il,cancellata_da,giacenza_stato,giacenza_data,giacenza_motivo,giacenza_istruzioni,giacenza_costo_giornaliero,giacenza_costo_riconsegna,giacenza_giorni,giacenza_addebito_effettuato,servizi_accessori,annullamento_richiesto_at,annullamento_da,annullamento_errore,stato_precedente,annullamento_owner_id,dogana_bloccata_at'

// Colonne che un CLIENTE puo' vedere. Differenza sostanziale rispetto a SPED_COLS: manca
// `costo_spedizione`, che e' il costo pagato dal MASTER al corriere. Il cliente deve vedere solo
// `costo_totale`, cioe' quello che paga lui: la differenza fra i due e' il guadagno del suo master,
// e non e' un dato suo. Fuori anche i campi tecnici pesanti (etichetta, risposta del corriere), che
// nel report finivano nel browser insieme al resto: 154 kB di PDF per riga e i dati del provider.
export const SPED_COLS_CLIENTE = SPED_COLS
  .split(',')
  .filter(c => c !== 'costo_spedizione')
  .join(',')

// Colonne che servono DAVVERO alla tabella dell'elenco master (?colonne=lista).
// Le 70 di SPED_COLS le chiede la finestra di dettaglio, non la tabella: da quando la finestra si
// legge i suoi campi dalla chiamata per-id, la riga puo' viaggiare leggera. Misurato: a 200 righe la
// risposta pesa 397 KB e la sola serializzazione costa 144 ms.
// NB: pesi e MISURE servono tutti e sei. La colonna Peso chiama fmtPeso(RIGA), non un campo: se
// `peso_fatturato` non c'e' il peso si ricava dal volumetrico e, sulle spedizioni vecchie che non
// ce l'hanno salvato, si stima da L×W×H (vedi lib/peso.ts).
// master_id e corriere_id non si vedono in tabella ma servono ai calcoli della rotta (rete, prezzi).
// id_ordine_esterno e rif_ordine idem: sono il RIPIEGO della colonna Ordine quando la spedizione non
// ha un ordine collegato (lista/route.ts). Tolti, il chip si svuotava in silenzio: nessun errore,
// nessun tipo sbagliato, solo un dato sparito dalla tabella.
// NIENTE costo_spedizione: sul percorso master non lo legge nessuno (la tabella mostra
// `costo_mostrato`), e al cliente la rotta lo toglie comunque in fondo.
export const SPED_COLS_LISTA = [
  'id', 'master_id', 'cliente_id', 'corriere_id',
  'numero', 'tracking_number', 'stato', 'created_at',
  'mitt_nome', 'dest_nome', 'dest_citta', 'dest_provincia', 'dest_cap', 'dest_paese',
  'id_ordine_esterno', 'rif_ordine',
  'colli', 'peso_fatturato', 'peso_reale', 'peso_volume', 'lunghezza', 'larghezza', 'altezza',
  'contrassegno', 'stato_contrassegno', 'assicurazione',
  'costo_totale',
  'annullamento_richiesto_at', 'annullamento_errore', 'dogana_bloccata_at',
].join(',')
