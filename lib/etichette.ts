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

import { createHash } from 'node:crypto'

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
  const m = v.match(/^data:([^;,]+);base64,([\s\S]+)$/)
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

// COME leggiEtichetta, MA MULTICOLLO. Se la spedizione ha più colli e ognuno ha la SUA etichetta,
// le UNISCE in un unico PDF (una pagina per collo). È LA funzione che TUTTI i punti di download di
// una singola spedizione devono usare: la stampa singola, il dettaglio, l'API. Senza, si scarica il
// solo primo collo (era il caso di 3UW1WLJ012948, easyparcel a 3 colli: 3 etichette in
// colli_dettaglio, ma etichetta_url ne portava una sola).
//
// Un PDF GIÀ a N pagine copiato su ogni collo (alcuni contratti mandano così) verrebbe impilato N
// volte: si riconosce dai BYTE (stessa impronta) e si tiene una volta sola. Regge sia la forma
// storica (data URL nel collo) sia quella nuova (percorso su Storage per collo). Se non c'è nulla da
// unire, ripiega su leggiEtichetta (etichetta unica). Le etichette non-PDF (immagini/zip) non si
// uniscono: si va all'unica.
// Etichetta completa + RISCRITTURA SpediamoPro: sostituisce sul PDF il codice interno del provider col
// nostro rif_ordine e "campionatura generica" col contenuto dichiarato. UN SOLO PUNTO: tutte le porte che
// servono la LDV (dashboard, API pubblica, bulk, cliente) passano di qui. Solo tipo='spediamopro' e solo
// PDF; ogni errore -> etichetta ORIGINALE (una LDV rotta blocca la spedizione, mai degradarla).
export async function leggiEtichettaCompleta(
  admin: any,
  sped: { etichetta_path?: string | null; etichetta_url?: string | null; colli_dettaglio?: any; raw_response?: any; corriere_id?: string | null; rif_ordine?: string | null; contenuto?: string | null }
): Promise<EtichettaLetta | null> {
  const et = await leggiEtichettaGrezza(admin, sped)
  if (et && et.mime === 'application/pdf' && sped?.corriere_id && (sped.rif_ordine || sped.contenuto)) {
    try {
      const { data: corr } = await admin.from('corrieri').select('tipo').eq('id', sped.corriere_id).maybeSingle()
      if ((corr as any)?.tipo === 'spediamopro') {
        const { riscriviEtichettaSpediamopro, codiceProviderSpediamopro } = await import('@/lib/etichetta-spediamopro')
        return { ...et, buffer: await riscriviEtichettaSpediamopro(et.buffer, {
          code: codiceProviderSpediamopro(sped.raw_response), rifOrdine: sped.rif_ordine, contenuto: sped.contenuto,
        }) }
      }
    } catch (e: any) { console.error('[ETICHETTA][SPEDIAMOPRO] rewrite:', e?.message) }
  }
  return et
}

async function leggiEtichettaGrezza(
  admin: any,
  sped: { etichetta_path?: string | null; etichetta_url?: string | null; colli_dettaglio?: any; raw_response?: any }
): Promise<EtichettaLetta | null> {
  const colli = Array.isArray(sped?.colli_dettaglio) ? (sped!.colli_dettaglio as any[]) : []
  // Raccoglie le etichette PDF DISTINTE dei colli (data URL o percorso Storage), scartando i doppioni
  // byte-per-byte (il pdf a N pagine copiato su ogni collo).
  const viste = new Set<string>()
  const pezzi: Buffer[] = []
  for (const c of colli) {
    let buf: Buffer | null = null
    if (c?.etichetta_path) { const d = await scaricaEtichetta(admin, c.etichetta_path); if (d && d.mime === 'application/pdf' && d.buffer.length) buf = d.buffer }
    if (!buf) { const d = scomponiDataUrl(c?.etichetta_url); if (d && d.mime === 'application/pdf' && d.buffer.length) buf = d.buffer }
    if (!buf?.length) continue
    const impronta = createHash('sha1').update(buf).digest('hex')
    if (viste.has(impronta)) continue
    viste.add(impronta); pezzi.push(buf)
  }
  // Più colli con etichette diverse → PDF unico, una pagina per collo.
  if (pezzi.length > 1) {
    try {
      const { PDFDocument } = await import('pdf-lib')
      const out = await PDFDocument.create()
      for (const b of pezzi) {
        const pdf = await PDFDocument.load(new Uint8Array(b))
        const pagine = await out.copyPages(pdf, pdf.getPageIndices())
        pagine.forEach(p => out.addPage(p))
      }
      return { buffer: Buffer.from(await out.save()), mime: 'application/pdf', ext: 'pdf' }
    } catch (e: any) {
      console.error('[ETICHETTE] unione colli fallita, ripiego su etichetta unica:', e?.message)
    }
  }
  // Niente da unire: l'etichetta della spedizione (Storage/base64/labelData); se manca ma un collo
  // ne porta una, quella. Così dettaglio e API pubblica non dipendono da nessuna logica esterna.
  const unica = await leggiEtichetta(admin, sped)
  if (unica) return unica
  if (pezzi.length === 1) return { buffer: pezzi[0], mime: 'application/pdf', ext: 'pdf' }
  return null
}

// ARCHIVIA UN LOTTO: prende le righe che hanno ancora il PDF dentro, lo mette su Storage e scrive
// il percorso. NON cancella il base64: finche' non c'e' la prova sul campo, le copie restano due.
//
// Sta qui e non in una rotta perche' la chiamano in due: il giro dedicato e — soprattutto — un cron
// che gia' funziona. Il giro dedicato, appena creato, non veniva mai invocato da Vercel (la rotta
// rispondeva, il registro dei cron non la prendeva), e nel frattempo il database cresceva di 239 MB
// al giorno. Appoggiarsi a un cron gia' vivo toglie di mezzo quel problema: due inneschi, una sola
// implementazione.
export async function archiviaLotto(admin: any, quante = 100): Promise<{
  esaminate: number; archiviate: number; saltate: number; fallite: number
}> {
  const impronta = (b: Buffer) => createHash('sha1').update(b).digest('hex')
  // QUESTA QUERY DIPENDE DA UN INDICE, e senza va in timeout.
  // Cercare 'data:%' dentro una colonna di testo su una tabella da 4 GB significa leggersela tutta:
  // al primo giro il lotto da 100 e' morto con "canceling statement due to statement timeout".
  // In produzione c'e':
  //   create index concurrently idx_spedizioni_da_archiviare on spedizioni (created_at)
  //     where etichetta_path is null and etichetta_url like 'data:%';
  // E' parziale, quindi pesa 520 kB e si RESTRINGE man mano che le righe vengono archiviate, fino a
  // sparire da solo quando non ce n'e' piu' nessuna. Le tre condizioni qui sotto devono restare
  // IDENTICHE al predicato dell'indice, altrimenti Postgres non lo usa e si torna al timeout.
  // Le piu' VECCHIE per prime: nessuno le sta stampando adesso.
  const { data: righe, error } = await admin
    .from('spedizioni').select('id,numero,etichetta_url,created_at')
    .is('etichetta_path', null).like('etichetta_url', 'data:%')
    .order('created_at', { ascending: true }).limit(quante)
  if (error) { console.error('[ARCHIVIA-ETICHETTE] lettura fallita', error.message); return { esaminate: 0, archiviate: 0, saltate: 0, fallite: 0 } }

  let archiviate = 0, saltate = 0, fallite = 0
  for (const r of righe || []) {
    const dato = scomponiDataUrl(r.etichetta_url)
    if (!dato?.buffer?.length) { saltate++; continue }

    const path = await caricaEtichetta(admin, r.id, dato.buffer, dato.mime, r.created_at ? new Date(r.created_at) : new Date())
    if (!path) { fallite++; continue }

    // SI RILEGGE PRIMA DI FIDARSI. Un caricamento senza errore non garantisce un file integro: un
    // buffer troncato o un'interruzione a meta' passerebbero lo stesso. Se il file riletto non e'
    // identico, il percorso NON si scrive e il giro dopo riprova.
    const riletto = await scaricaEtichetta(admin, path)
    if (!riletto || impronta(riletto.buffer) !== impronta(dato.buffer)) {
      fallite++
      console.error('[ARCHIVIA-ETICHETTE] verifica fallita', r.numero, path)
      continue
    }
    const { error: upErr } = await admin.from('spedizioni').update({ etichetta_path: path }).eq('id', r.id)
    if (upErr) { fallite++; console.error('[ARCHIVIA-ETICHETTE]', r.numero, upErr.message); continue }
    archiviate++
  }
  const esito = { esaminate: (righe || []).length, archiviate, saltate, fallite }
  if (esito.esaminate) console.log('[ARCHIVIA-ETICHETTE]', JSON.stringify(esito))
  return esito
}

// LIBERA il base64 GIÀ ARCHIVIATO. archiviaLotto scrive `etichetta_path` ma TIENE il base64 in
// `etichetta_url` come rete di sicurezza "finché non c'è la prova sul campo". Questa è la prova: per
// ogni riga già archiviata rilegge il file da Storage e lo confronta byte-per-byte col base64; solo
// se combacia, azzera `etichetta_url`. Fa lo stesso con le etichette PER-COLLO dei multicollo dentro
// `colli_dettaglio` (le archivia su Storage con percorso per-collo, poi toglie il base64). MAI
// cancellare una copia inline senza aver verificato che quella su Storage è integra: se il file manca
// o è diverso, il base64 resta. È il grosso dello spazio del TOAST (etichette duplicate).
export async function liberaEtichetteArchiviate(admin: any, quante = 80): Promise<{
  esaminate: number; url_liberati: number; colli_archiviati: number; saltate: number
}> {
  const impronta = (b: Buffer) => createHash('sha1').update(b).digest('hex')
  // L'indice parziale idx_sped_libera_base64 (etichetta_path not null AND etichetta_url not null)
  // rende questa ricerca istantanea e si RESTRINGE man mano che si liberano le righe.
  const { data: righe } = await admin.from('spedizioni')
    .select('id,numero,created_at,etichetta_url,etichetta_path,colli_dettaglio')
    .not('etichetta_path', 'is', null).not('etichetta_url', 'is', null)
    .limit(quante)

  let url_liberati = 0, colli_archiviati = 0, saltate = 0
  for (const r of righe || []) {
    const upd: any = {}

    // (1) etichetta_url: azzera SOLO se la copia su Storage esiste e combacia.
    const inline = scomponiDataUrl(r.etichetta_url)
    if (inline?.buffer?.length) {
      const suStorage = await scaricaEtichetta(admin, r.etichetta_path)
      if (suStorage?.buffer?.length && impronta(suStorage.buffer) === impronta(inline.buffer)) {
        upd.etichetta_url = null
      }
    }
    // Se etichetta_url NON è un data-url (http, o già svuotato in questa passata) non si tocca.

    // (2) colli_dettaglio: archivia le etichette per-collo base64 e toglie il base64 (solo se ok).
    const colli = Array.isArray(r.colli_dettaglio) ? (r.colli_dettaglio as any[]) : null
    if (colli && colli.some((c: any) => typeof c?.etichetta_url === 'string' && c.etichetta_url.startsWith('data:'))) {
      const quando = r.created_at ? new Date(r.created_at) : new Date()
      let cambiato = false
      const nuovi = colli.map((c: any) => c)   // copia, la riempio sotto
      for (let i = 0; i < colli.length; i++) {
        const d = scomponiDataUrl(colli[i]?.etichetta_url)
        if (!d?.buffer?.length) continue
        // numero collo per il percorso: l'indice i+1 è sempre affidabile (il campo `numero` a volte è la LDV).
        const path = await caricaEtichetta(admin, r.id, d.buffer, d.mime, quando, i + 1)
        if (!path) continue
        const riletto = await scaricaEtichetta(admin, path)
        if (riletto?.buffer?.length && impronta(riletto.buffer) === impronta(d.buffer)) {
          nuovi[i] = { ...colli[i], etichetta_url: null, etichetta_path: path }
          cambiato = true; colli_archiviati++
        }
      }
      if (cambiato) upd.colli_dettaglio = nuovi
    }

    if (Object.keys(upd).length) {
      const { error } = await admin.from('spedizioni').update(upd).eq('id', r.id)
      if (error) { console.error('[LIBERA-ETICHETTE]', r.numero, error.message); saltate++; continue }
      if ('etichetta_url' in upd) url_liberati++
    } else saltate++
  }
  const esito = { esaminate: (righe || []).length, url_liberati, colli_archiviati, saltate }
  if (esito.esaminate) console.log('[LIBERA-ETICHETTE]', JSON.stringify(esito))
  return esito
}

// Vero se la spedizione ha un'etichetta, in QUALUNQUE forma. Da usare al posto dei controlli
// `etichetta_url is null`, che dopo la migrazione direbbero "manca" su spedizioni che ce l'hanno
// eccome — e farebbero riscaricare dal corriere migliaia di etichette gia' presenti.
export function haEtichetta(sped: { etichetta_path?: string | null; etichetta_url?: string | null }): boolean {
  return !!(sped?.etichetta_path || sped?.etichetta_url)
}
