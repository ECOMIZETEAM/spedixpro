/* IL PDF DELLA FATTURA BRT. Gli importi riga per riga restano quelli del TIVAF: dal PDF si prende quello che
 * il TIVAF non ha. In fondo all'ultima pagina BRT stampa la LEGENDA delle sigle usate in quella fattura
 * ("I=SP.GIACENZ f=FUEL SURCH G=COMP.ASSEG…"): una sigla nuova si legge lì invece di indovinarla dai numeri.
 * In più il numero della fattura (per non accoppiare il PDF al file sbagliato) e il totale per codice
 * cliente, che deve tornare al millesimo con la somma del TIVAF (26 fatture di Wave su 26, 02/11/2026).
 *
 * Solo server: pdfjs legacy, solo testo, come le altre letture (estrai-visura, etichetta-sda). */

export type LetturaPdfBrt = { numeroFattura: string | null; legenda: Record<string, string>; totale: number | null }

const numIt = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))

export async function leggiPdfFatturaBrt(bytes: Uint8Array): Promise<LetturaPdfBrt> {
  const mod: any = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = mod.getDocument ? mod : (mod.default || mod)
  // isEvalSupported: false chiude la falla di pdfjs-dist 3 (CVE-2024-4367): il PDF arriva da fuori.
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise

  // Le righe del PDF come si leggono: i pezzi di testo raggruppati per altezza, da sinistra a destra.
  const righe: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    const perY = new Map<number, { x: number; s: string }[]>()
    for (const it of (tc.items || []) as any[]) {
      const y = Math.round(it.transform[5]); const v = perY.get(y) || []; v.push({ x: it.transform[4], s: it.str || '' }); perY.set(y, v)
    }
    for (const [, v] of [...perY.entries()].sort((a, b) => b[0] - a[0])) {
      const l = v.sort((a, b) => a.x - b.x).map(x => x.s).join(' ').replace(/\s+/g, ' ').trim()
      if (l) righe.push(l)
    }
  }

  // "19/10/26 68195 (998) 1" in testa al dettaglio, col giorno a una cifra quando è prima del 10 ("8/06/26
  // 39876 (998) 1"); se manca, quello della prima pagina: "Fattura - EUR 39876 (998) 08/06/2026".
  let numeroFattura: string | null = null
  for (const l of righe) { const m = l.match(/\b\d{1,2}\/\d{2}\/\d{2}\s+(\d{4,7})\s+\(\d+\)/); if (m) { numeroFattura = m[1]; break } }
  if (!numeroFattura) for (const l of righe) { const m = l.match(/\b(\d{4,7})\s+\(\d+\)\s+\d{2}\/\d{2}\/\d{4}\b/); if (m) { numeroFattura = m[1]; break } }

  // La legenda: la riga "Legenda:" e quelle subito sotto fatte di coppie SIGLA=NOME. I nomi hanno spazi e
  // punti ("COLLI INCO", "A.C. PLUS", "SUPER./GDO"): si taglia davanti a ogni "x=" e non sugli spazi.
  const legenda: Record<string, string> = {}
  for (let i = 0; i < righe.length; i++) {
    if (!/^Legenda\b/i.test(righe[i])) continue
    const blocco = [righe[i].replace(/^Legenda:?\s*/i, '')]
    for (let k = i + 1; k < righe.length && /^\S=/.test(righe[k]); k++) blocco.push(righe[k])
    for (const parte of blocco.join(' ').split(/\s+(?=\S=)/)) {
      const m = parte.match(/^(\S)=(.+)$/)
      if (m) legenda[m[1]] = m[2].trim().slice(0, 20)
    }
  }

  // "Tot.Cli.: 677742 WAVESHIP LLC EIN Tot. 1441,092 Franchi …": uno per codice cliente. Nel testo estratto
  // la stessa riga può comparire due volte: si conta una sola volta per codice e importo.
  const totali = new Map<string, number>()
  for (const l of righe) {
    const m = l.match(/Tot\.Cli\.?:?\s*(\d+)\b.*?\bTot\.?\s+([\d.]+,\d+)/)
    if (m) totali.set(m[1] + '|' + m[2], numIt(m[2]))
  }
  const totale = totali.size ? Math.round([...totali.values()].reduce((s, x) => s + x, 0) * 1000) / 1000 : null

  return { numeroFattura, legenda, totale }
}
