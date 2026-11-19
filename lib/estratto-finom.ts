/* L'ESTRATTO CONTO DI FINOM ("Lista movimenti" in PDF), il conto di Ecomize Solution.
 * Ogni movimento ha: data, nome della controparte (in grassetto), causale, IBAN e BIC (i bonifici), importo
 * col segno, saldo dopo il movimento. Solo server: pdfjs legacy, solo testo, come lib/fattura-brt-pdf.
 *
 * La lettura si verifica da sola col saldo: ogni riga deve dare il saldo della riga precedente piu' il suo
 * importo, e la prima riga deve partire dal saldo iniziale. Se anche un centesimo non torna, il PDF non e'
 * stato letto bene e non si usa (ottobre 2026: 1.073 righe, 0 errori). */

export type RigaEstratto = {
  data: string            // 'YYYY-MM-DD'
  nome: string            // controparte, come la scrive la banca
  causale: string
  iban: string | null
  importo: number         // + entrata, - uscita
  saldo: number           // saldo dopo il movimento
}

export type Estratto = {
  banca: 'finom'
  intestatario: string
  contoIban: string | null
  dal: string
  al: string
  saldoIniziale: number
  saldoFinale: number
  righe: RigaEstratto[]   // dalla piu' vecchia alla piu' recente
}

const euro = (s: string) => Number(s.replace(/[€$\s]/g, '').replace(/\./g, '').replace(',', '.'))
const giorno = (s: string) => s.split('/').reverse().join('-')
const r2 = (x: number) => Math.round(x * 100) / 100

export async function leggiEstrattoFinom(bytes: Uint8Array): Promise<Estratto> {
  const mod: any = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = mod.getDocument ? mod : (mod.default || mod)
  // isEvalSupported: false chiude la falla di pdfjs-dist 3 (CVE-2024-4367): il PDF arriva da fuori.
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise
  let intestatario = '', contoIban: string | null = null, dal = '', al = ''
  let saldoIniziale: number | null = null, saldoFinale: number | null = null
  const righe: RigaEstratto[] = []

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n)
    const tc = await pagina.getTextContent()
    // Il nome della controparte e' in grassetto (Lato-Bold), la causale no: il nome del font si legge
    // solo dopo averlo caricato con la lista delle operazioni della pagina.
    await pagina.getOperatorList()
    const grassetto = new Set<string>()
    for (const f of new Set<string>(tc.items.map((i: any) => i.fontName))) {
      try { if (/bold/i.test(pagina.commonObjs.get(f)?.name || '')) grassetto.add(f) } catch { /* font non caricato */ }
    }
    const items = (tc.items as any[]).filter(i => String(i.str).trim())
      .map(i => ({ x: i.transform[4] as number, y: i.transform[5] as number, s: String(i.str).trim(), bold: grassetto.has(i.fontName) }))
    const aDestra = (etichetta: string) => {
      const e = items.find(i => i.s.startsWith(etichetta))
      return e ? items.find(i => Math.abs(i.y - e.y) < 2 && i.x > e.x + 20)?.s ?? null : null
    }
    if (n === 1) {
      if (!items.some(i => /LISTA MOVIMENTI/i.test(i.s)) || !items.some(i => /finom/i.test(i.s) || /FNOM/.test(i.s))) {
        throw new Error('Non sembra un estratto conto Finom ("Lista movimenti")')
      }
      intestatario = items.slice().sort((a, b) => b.y - a.y || a.x - b.x)[0]?.s || ''
      contoIban = (items.find(i => i.s.startsWith('IBAN:') && i.x < 100)?.s.slice(5) || '').replace(/\s/g, '') || null
      const si = aDestra('Saldo iniziale'), sf = aDestra('Saldo finale'), d1 = aDestra('Da:'), d2 = aDestra('A:')
      if (!si || !sf || !d1 || !d2) throw new Error('Intestazione dell\'estratto non riconosciuta (saldi o periodo mancanti)')
      saldoIniziale = euro(si); saldoFinale = euro(sf); dal = giorno(d1); al = giorno(d2)
    }
    const date = items.filter(i => i.x < 100 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.s)).sort((a, b) => b.y - a.y)
    date.forEach((d, k) => {
      const sotto = k + 1 < date.length ? date[k + 1].y : -Infinity
      const blocco = items.filter(i => i.y <= d.y + 1 && i.y > sotto + 1 && i.x >= 100)
      const desc = blocco.filter(i => i.x < 380).sort((a, b) => b.y - a.y)
      const importi = blocco.filter(i => i.x >= 380 && i.x < 495 && /€/.test(i.s)).sort((a, b) => b.y - a.y)
      const saldi = blocco.filter(i => i.x >= 495 && /€/.test(i.s))
      if (!importi.length || !saldi.length) throw new Error(`Movimento del ${d.s} a pagina ${n} senza importo o saldo`)
      const testo = desc.filter(i => !i.s.startsWith('IBAN:') && !i.s.startsWith('BIC:'))
      righe.push({
        data: giorno(d.s),
        nome: testo.filter(i => i.bold).map(i => i.s).join(' '),
        causale: testo.filter(i => !i.bold).map(i => i.s).join(' ').replace(/\s*Creato con Finom\.co\s*/g, ' ').trim(),
        iban: desc.find(i => i.s.startsWith('IBAN:'))?.s.slice(5).replace(/\s/g, '') || null,
        importo: euro(importi[0].s),
        saldo: euro(saldi[0].s),
      })
    })
  }
  if (saldoIniziale === null || saldoFinale === null) throw new Error('Saldi dell\'estratto non trovati')
  if (!righe.length) throw new Error('Nessun movimento nell\'estratto')

  // La banca elenca dal piu' recente: si gira e si controlla il saldo progressivo dal saldo iniziale.
  righe.reverse()
  let atteso = saldoIniziale
  for (const r of righe) {
    atteso = r2(atteso + r.importo)
    if (Math.abs(atteso - r.saldo) > 0.005) {
      throw new Error(`Il saldo non torna al movimento del ${r.data} (${r.nome}, ${r.importo} €): letto ${r.saldo}, atteso ${atteso}. Il PDF non e' stato letto bene: non lo uso.`)
    }
  }
  if (Math.abs(atteso - saldoFinale) > 0.005) throw new Error(`Il saldo finale non torna: letto ${saldoFinale}, dai movimenti ${atteso}`)
  return { banca: 'finom', intestatario, contoIban, dal, al, saldoIniziale, saldoFinale, righe }
}
