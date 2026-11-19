/* LA COMPENSAZIONE CONTRASSEGNI DI BRT ("CON027 COMPENSAZIONE CONTRASSEGNI CLIENTE", in PDF). BRT non versa i
 * contrassegni a parte: li compensa con le fatture e manda questo tabulato, una riga per contrassegno, con la
 * spedizione BRT, l'importo, il destinatario e i due riferimenti che il mittente ha messo creando la spedizione.
 *
 * È una stampa a colonne fisse (carattere a spaziatura fissa). Ogni pezzo di testo si rimette alla sua colonna,
 * e le colonne si tagliano dove le segna la riga di trattini sotto l'intestazione. Separare sugli spazi non
 * basta: nel PDF due colonne arrivano attaccate in un pezzo solo ("14166 3177" è il riferimento numerico
 * seguito da quello alfabetico, "M 28.10.2026" la fine di "Verde oliva / M" seguita dalla data di
 * registrazione), e il riferimento alfabetico ha spazi suoi.
 *
 * Solo server: pdfjs legacy, solo testo, come la fattura (lib/fattura-brt-pdf). */

export type RigaCompensazione = {
  data: string                  // data della spedizione BRT, AAAA-MM-GG
  filiale: string               // filiale di partenza ("067")
  serie: string
  numero: string                // numero della spedizione BRT
  importo: number               // contrassegno compensato
  destinatario: string
  rifNumerico: string           // riferimento mittente numerico: lo mette chi crea la spedizione
  rifAlfabetico: string
  dataRegistrazione: string     // AAAA-MM-GG
  numeroRegistrazione: string
}

export type LetturaCompensazione = {
  righe: RigaCompensazione[]
  totale: number | null         // "Totale compensato" stampato da BRT: la somma delle righe deve tornare
  cliente: string | null        // "Cliente intestazione assegno"
  righeNonLette: string[]       // righe che sembrano un contrassegno ma non si leggono: si dicono, non si perdono
}

const numIt = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))
const iso = (gg: string, mm: string, aaaa: string) => `${aaaa}-${mm}-${gg}`

export async function leggiCompensazioneBrt(bytes: Uint8Array): Promise<LetturaCompensazione> {
  const mod: any = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = mod.getDocument ? mod : (mod.default || mod)
  // isEvalSupported: false chiude la falla di pdfjs-dist 3 (CVE-2024-4367): il PDF arriva da fuori.
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise

  const linee: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const pezzi = ((await (await doc.getPage(p)).getTextContent()).items || []).filter((it: any) => it.str) as any[]
    // La larghezza di un carattere si misura sui pezzi stessi: a spaziatura fissa è uguale per tutti.
    const larghezze = pezzi.filter(it => it.str.length >= 4 && it.width > 0).map(it => it.width / it.str.length).sort((a, b) => a - b)
    const passo = larghezze[Math.floor(larghezze.length / 2)]
    if (!passo) continue
    const perY = new Map<number, any[]>()
    for (const it of pezzi) { const y = Math.round(it.transform[5]); perY.set(y, [...(perY.get(y) || []), it]) }
    for (const [, v] of [...perY.entries()].sort((a, b) => b[0] - a[0])) {
      const c: string[] = []
      for (const it of v) {
        const col = Math.round(it.transform[4] / passo)
        for (let k = 0; k < it.str.length; k++) c[col + k] = it.str[k]
      }
      linee.push(Array.from(c, x => x ?? ' ').join('').replace(/\s+$/, ''))
    }
  }

  // Le colonne: la riga di trattini sotto l'intestazione, un gruppo per colonna (spedizione, importo,
  // destinatario, rif. numerico, rif. alfabetico, registrazione). Ogni campo va dall'inizio del suo gruppo
  // all'inizio del successivo, spazio di separazione compreso.
  let colonne: number[] | null = null
  const righe: RigaCompensazione[] = []
  const righeNonLette: string[] = []
  const viste = new Set<string>()
  let cliente: string | null = null
  let totale: number | null = null
  for (const l of linee) {
    const cl = l.match(/Cliente intestazione assegno:\s*(.+)$/)
    if (cl && !cliente) cliente = cl[1].replace(/\s+/g, ' ').trim()
    const tot = l.match(/Totale compensato\s+([\d.]+,\d{2})/)
    if (tot) totale = Math.round(((totale || 0) + numIt(tot[1])) * 100) / 100
    if (/^-{10,}( +-{5,}){5}$/.test(l)) { colonne = [...l.matchAll(/-+/g)].map(m => m.index!); continue }
    if (!/^\s*\d{2}\.\d{2}\.\d{4}\s/.test(l)) continue
    const campo = (i: number) => colonne ? l.slice(colonne[i], colonne[i + 1] ?? l.length).trim() : ''
    const sp = campo(0).match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,3})\s+(\d{1,3})\s+(\d+)$/)
    const imp = campo(1).match(/^[\d.]+,\d{2}$/)
    const reg = campo(5).match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d+)$/)
    if (!colonne || colonne.length !== 6 || !sp || !imp || !reg) { righeNonLette.push(l.replace(/\s+/g, ' ').trim()); continue }
    // Lo stesso testo stampato due volte (succede nei PDF di BRT) è lo stesso contrassegno: si conta una volta.
    const chiave = `${sp[4]}|${sp[5]}|${sp[6]}|${reg[4]}`
    if (viste.has(chiave)) continue
    viste.add(chiave)
    righe.push({
      data: iso(sp[1], sp[2], sp[3]), filiale: sp[4], serie: sp[5], numero: sp[6],
      importo: numIt(imp[0]), destinatario: campo(2).replace(/\s+/g, ' '),
      rifNumerico: campo(3), rifAlfabetico: campo(4).replace(/\s+/g, ' '),
      dataRegistrazione: iso(reg[1], reg[2], reg[3]), numeroRegistrazione: reg[4],
    })
  }
  return { righe, totale, cliente, righeNonLette }
}
