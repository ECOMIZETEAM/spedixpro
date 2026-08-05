// ETICHETTE: dove vive il PDF di una lettera di vettura.
//
// Storicamente il PDF stava DENTRO la riga, come data URL base64 in `spedizioni.etichetta_url`.
// A ~154 kB per spedizione e 1.500 spedizioni al giorno la tabella e' arrivata a 4 GB di cui solo
// 30 MB di dati veri. Ora i PDF nuovi vanno su Supabase Storage (bucket privato `etichette`) e
// nella riga resta solo il percorso, in `spedizioni.etichetta_path`.
//
// LE DUE FORME CONVIVONO, e devono continuare a convivere: le spedizioni vecchie hanno il base64,
// quelle nuove il percorso, e durante la migrazione una riga puo' avere entrambi. Chi legge non
// deve mai sapere quale delle due sia: per questo esiste `leggiEtichetta`.
//
// Il bucket e' PRIVATO di proposito. Un'etichetta contiene nome, indirizzo e telefono del
// destinatario: con un URL pubblico chiunque avesse il link potrebbe scaricarla, scavalcando i
// controlli di autorizzazione che oggi proteggono ogni download. I file escono solo passando dal
// nostro codice, che continua a verificare chi sta chiedendo.

export type EtichettaLetta = { buffer: Buffer; mime: string; ext: string }

const BUCKET = 'etichette'

const ESTENSIONE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
}
export function estensioneDa(mime: string): string {
  return ESTENSIONE[mime] || (mime.startsWith('image/') ? mime.split('/')[1] : 'pdf')
}

// Percorso stabile e ordinato per data: cosi' il bucket resta navigabile e si puo' ragionare per
// periodo (es. archiviare il 2026 senza toccare il resto).
//
// UNA CHIAVE PER DOCUMENTO, NON PER SPEDIZIONE. Il percorso era `AAAA/MM/<idSpedizione>.pdf`, e
// siccome il caricamento sovrascrive, su una spedizione MULTICOLLO i colli si sarebbero scritti
// l'uno sull'altro: le etichette dei colli sono documenti diversi, ognuno col suo numero di lettera
// di vettura. Sarebbe rimasta solo l'ultima, tutti i colli avrebbero puntato a quella, e in stampa
// sarebbe uscita UNA pagina sola — attaccata su tutti i pacchi. Senza nessun errore: il foglio
// "ETICHETTA NON DISPONIBILE" scatta solo quando non esce niente.
// Nessuno chiamava ancora questa funzione, quindi non e' un guasto avvenuto: e' quello che sarebbe
// successo al primo multicollo dopo aver collegato la scrittura.
export function percorsoEtichetta(spedizioneId: string, quando: Date, ext: string, collo?: number): string {
  const a = quando.getUTCFullYear()
  const m = String(quando.getUTCMonth() + 1).padStart(2, '0')
  const nome = Number.isFinite(collo as number) && (collo as number) > 0 ? `collo-${collo}` : 'sped'
  return `${a}/${m}/${spedizioneId}/${nome}.${ext}`
}

// Scompone un data URL. Torna null se non e' un data URL (es. e' gia' un percorso, o un URL http).
export function scomponiDataUrl(v: string | null | undefined): { buffer: Buffer; mime: string } | null {
  if (!v || typeof v !== 'string') return null
  const m = v.match(/^data:([^;,]+);base64,(.+)$/s)
  if (!m) return null
  try { return { buffer: Buffer.from(m[2], 'base64'), mime: m[1] } } catch { return null }
}

// Carica un PDF su Storage e restituisce il percorso. NON tocca il database: chi chiama decide
// quando e come salvarlo, perche' l'ordine delle scritture e' la parte delicata.
export async function caricaEtichetta(
  admin: any, spedizioneId: string, buffer: Buffer, mime = 'application/pdf', quando = new Date(),
  collo?: number,   // numero del collo (1..N) per il multicollo; assente = etichetta della spedizione
): Promise<string | null> {
  try {
    if (!buffer?.length) { console.error('[ETICHETTE] rifiutato caricamento vuoto', spedizioneId, collo ?? '-'); return null }
    const path = percorsoEtichetta(spedizioneId, quando, estensioneDa(mime), collo)
    const { error } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: true })
    if (error) { console.error('[ETICHETTE] caricamento fallito', spedizioneId, error.message); return null }
    return path
  } catch (e: any) {
    console.error('[ETICHETTE] caricamento in errore', spedizioneId, e?.message)
    return null
  }
}

// Rilegge dallo Storage. Serve anche a VERIFICARE che un file caricato esista davvero e si apra,
// prima di liberare il base64 dalla riga: e' la garanzia che non si perde mai un'etichetta.
export async function scaricaEtichetta(admin: any, path: string): Promise<EtichettaLetta | null> {
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(path)
    if (error || !data) return null
    const buffer = Buffer.from(await data.arrayBuffer())
    if (!buffer.length) return null
    const ext = (path.split('.').pop() || 'pdf').toLowerCase()
    const mime = Object.entries(ESTENSIONE).find(([, e]) => e === ext)?.[0] || 'application/pdf'
    return { buffer, mime, ext }
  } catch (e: any) {
    console.error('[ETICHETTE] lettura fallita', path, e?.message)
    return null
  }
}

// LA funzione che devono usare tutti i punti di download: prende la spedizione e restituisce il
// PDF, senza che il chiamante debba sapere dove sta. Ordine: prima il file su Storage (la forma
// nuova), poi il base64 nella riga (la forma storica), poi la copia dentro raw_response (rete di
// sicurezza per le righe piu' vecchie).
export async function leggiEtichetta(
  admin: any,
  sped: { etichetta_path?: string | null; etichetta_url?: string | null; raw_response?: any }
): Promise<EtichettaLetta | null> {
  if (sped?.etichetta_path) {
    const da = await scaricaEtichetta(admin, sped.etichetta_path)
    if (da) return da
    // Il percorso c'e' ma il file no: non ci si ferma qui, si prova comunque il base64.
    console.error('[ETICHETTE] percorso presente ma file mancante', sped.etichetta_path)
  }
  const dal = scomponiDataUrl(sped?.etichetta_url)
  if (dal) return { ...dal, ext: estensioneDa(dal.mime) }
  const legacy = sped?.raw_response?.labelData
  if (legacy) {
    try { return { buffer: Buffer.from(legacy, 'base64'), mime: 'application/pdf', ext: 'pdf' } } catch { }
  }
  return null
}

// Vero se la spedizione ha un'etichetta, in QUALUNQUE forma. Da usare al posto dei controlli
// `etichetta_url is null`, che dopo la migrazione direbbero "manca" su spedizioni che ce l'hanno
// eccome — e farebbero riscaricare dal corriere migliaia di etichette gia' presenti.
export function haEtichetta(sped: { etichetta_path?: string | null; etichetta_url?: string | null }): boolean {
  return !!(sped?.etichetta_path || sped?.etichetta_url)
}
