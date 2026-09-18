import { PDFDocument } from 'pdf-lib'

// FORMATO DI STAMPA delle etichette (impostazione per-cliente/per-master `impostazioni.formato_stampa`).
// I corrieri restituiscono un PDF nel LORO formato (di norma un'etichetta ~10,5×15 cm, non A4). Qui si
// ri-adatta OGNI pagina del PDF (etichetta + eventuale riepilogo) alla dimensione scelta, scalando col
// rapporto giusto e centrando (mai deformare): così chi ha una termica 10×11 stampa 10×11, chi vuole A4
// mette A4. NON è la vecchia card "finta": qui il ridimensionamento avviene davvero, in un posto solo.
//
// Valore assente / 'nativo' / sconosciuto = si lascia il PDF del corriere com'è (nessun cambiamento):
// è ciò che protegge i clienti esistenti finché non scelgono un formato. I nuovi nascono con '10x11'.

const CM = 28.3465  // punti PDF per centimetro
export const FORMATI_ETICHETTA = ['nativo', '10x11', '10x15', 'a4'] as const
const DIMENSIONI: Record<string, [number, number]> = {
  '10x11': [10 * CM, 11 * CM],
  '10x15': [10 * CM, 15 * CM],
  'a4': [595.28, 841.89],
}

export function formatoValido(v: any): boolean {
  return typeof v === 'string' && v in DIMENSIONI
}

// Formato scelto da CHI STAMPA: il cliente usa il suo, il master (o agente/staff) usa quello del master.
// Ritorna null (= nativo) se non è stato salvato un formato valido — così gli esistenti restano invariati.
export async function formatoStampaUtente(
  admin: any,
  utente: { ruolo?: string | null; cliente_id?: string | null; master_id?: string | null } | null
): Promise<string | null> {
  try {
    if (utente?.ruolo === 'cliente' && utente.cliente_id) {
      const { data } = await admin.from('clienti').select('impostazioni').eq('id', utente.cliente_id).maybeSingle()
      const f = data?.impostazioni?.formato_stampa
      return formatoValido(f) ? f : null
    }
    if (utente?.master_id) {
      const { data } = await admin.from('masters').select('impostazioni').eq('id', utente.master_id).maybeSingle()
      const f = data?.impostazioni?.formato_stampa
      return formatoValido(f) ? f : null
    }
  } catch { /* su qualsiasi errore: nativo */ }
  return null
}

// Ritorna il PDF ri-formattato, o gli stessi byte se il formato è nativo/assente/non-PDF.
export async function applicaFormatoEtichetta(pdfBytes: Uint8Array | Buffer, formato?: string | null): Promise<Uint8Array | Buffer> {
  const target = formato && DIMENSIONI[formato]
  if (!target) return pdfBytes   // nativo / assente / sconosciuto → invariato
  const [tw, th] = target
  try {
    const src = await PDFDocument.load(pdfBytes instanceof Buffer ? new Uint8Array(pdfBytes) : pdfBytes)
    const out = await PDFDocument.create()
    const indici = src.getPageIndices()
    const pagine = await out.embedPages(indici.map(i => src.getPage(i)))
    for (const emb of pagine) {
      const pw = emb.width, ph = emb.height
      // "contain": scala per stare TUTTA dentro il foglio, mantenendo le proporzioni (niente barcode
      // deformati). Centrata. Se la pagina è più piccola del foglio non la si ingrandisce oltre 1x per
      // non sgranare, tranne quando serve per riempire il lato corto (scala comunque a fit).
      const scala = Math.min(tw / pw, th / ph)
      const w = pw * scala, h = ph * scala
      const page = out.addPage([tw, th])
      page.drawPage(emb, { x: (tw - w) / 2, y: (th - h) / 2, xScale: scala, yScale: scala })
    }
    return await out.save()
  } catch (e) {
    console.error('[FORMATO-ETICHETTA] ri-formattazione fallita, servo il PDF nativo:', (e as any)?.message)
    return pdfBytes   // mai far fallire il download per il formato
  }
}
