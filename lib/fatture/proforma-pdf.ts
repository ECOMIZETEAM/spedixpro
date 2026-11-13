import { unitaVoce, type RigaVoce } from './voci'
import { etichettaVoce, type Emittente, type Destinatario, type MovimentoProforma, type Accrediti } from './proforma'

// IL PDF DELLA PROFORMA. Prima pagina: chi la emette, a chi, il riepilogo per voce con imponibile, IVA
// e totale; sotto, fuori dal totale, ricariche e contrassegni del periodo. Dalla seconda in poi il
// dettaglio, movimento per movimento: e' quello che il cliente controlla quando una cifra non gli torna.

const eur = (n: number) => (Math.round(n * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataIt = (iso: string) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
const giornoIt = (g: string) => `${g.slice(8, 10)}/${g.slice(5, 7)}/${g.slice(0, 4)}`

const ARANCIO: [number, number, number] = [249, 115, 22]
const GRIGIO: [number, number, number] = [110, 110, 110]

// Il logo del master, se e' un PNG o un JPG raggiungibile. Mai bloccante: senza, resta il nome.
async function logoDa(url: string | null): Promise<{ dati: string; formato: 'PNG' | 'JPEG' } | null> {
  if (!url) return null
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    const tipo = (r.headers.get('content-type') || '').toLowerCase()
    const formato = tipo.includes('png') ? 'PNG' : (tipo.includes('jpeg') || tipo.includes('jpg')) ? 'JPEG' : null
    if (!formato) return null
    const b = Buffer.from(await r.arrayBuffer())
    if (b.length > 2_000_000) return null
    return { dati: `data:${tipo.split(';')[0]};base64,${b.toString('base64')}`, formato }
  } catch { return null }
}

export async function pdfProforma(p: {
  numero: string
  data: string            // AAAA-MM-GG
  dal: string
  al: string
  emittente: Emittente
  destinatario: Destinatario
  righe: RigaVoce[]
  imponibile: number
  aliquota: number
  natura: string | null
  iva: number
  totale: number
  ricariche: Accrediti
  contrassegni: Accrediti
  movimenti: MovimentoProforma[]
}): Promise<Uint8Array> {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  // Compresso: senza, il cliente piu' grosso (7.000 righe in un mese) supera i 6 MB.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const L = 14, R = 196
  const e = p.emittente, d = p.destinatario

  // Testata: logo (o nome) a sinistra, titolo a destra.
  let y = 14
  const logo = await logoDa(e.logo)
  if (logo) {
    try {
      // Dentro un riquadro di 60 x 16 mm, senza deformarlo.
      const pr = doc.getImageProperties(logo.dati)
      const k = Math.min(60 / pr.width, 16 / pr.height)
      doc.addImage(logo.dati, logo.formato, L, y, pr.width * k, pr.height * k)
    } catch { doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text(e.nome, L, y + 8) }
  } else {
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text(e.nome, L, y + 8)
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...ARANCIO)
  doc.text('FATTURA PROFORMA', R, y + 5, { align: 'right' })
  doc.setTextColor(0); doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text(`N. ${p.numero} del ${giornoIt(p.data)}`, R, y + 11, { align: 'right' })
  doc.text(`Periodo: dal ${giornoIt(p.dal)} al ${giornoIt(p.al)}`, R, y + 16, { align: 'right' })

  // Due colonne: chi emette, a chi.
  y = 40
  const blocco = (x: number, titolo: string, nome: string, righe: string[]) => {
    doc.setFontSize(8); doc.setTextColor(...GRIGIO); doc.setFont('helvetica', 'bold')
    doc.text(titolo, x, y)
    doc.setTextColor(0); doc.setFontSize(10)
    const nomeR = doc.splitTextToSize(nome || '—', 85) as string[]
    doc.text(nomeR, x, y + 5)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    let yy = y + 5 + nomeR.length * 4.5
    for (const r of righe.filter(Boolean)) {
      const rr = doc.splitTextToSize(r, 85) as string[]
      doc.text(rr, x, yy); yy += rr.length * 4
    }
    return yy
  }
  const fineSx = blocco(L, 'EMESSA DA', e.nome, [
    e.indirizzo,
    e.piva ? `P.IVA ${e.piva}` : '', e.cf && e.cf !== e.piva ? `C.F. ${e.cf}` : '',
    e.email ? `Email ${e.email}` : '', e.pec ? `PEC ${e.pec}` : '', e.telefono ? `Tel. ${e.telefono}` : '',
  ])
  const fineDx = blocco(110, 'INTESTATA A', d.ragione_sociale, [
    d.indirizzo,
    d.piva ? `P.IVA ${d.piva}` : '', d.cf && d.cf !== d.piva ? `C.F. ${d.cf}` : '',
    d.email ? `Email ${d.email}` : '', d.pec ? `PEC ${d.pec}` : '', d.codice_cliente ? `Codice cliente ${d.codice_cliente}` : '',
  ])
  y = Math.max(fineSx, fineDx) + 4

  // Riepilogo.
  const ivaTesto = p.aliquota === 0 ? `IVA 0%${p.natura ? ` (${p.natura})` : ''}` : `IVA ${p.aliquota.toLocaleString('it-IT')}%`
  autoTable(doc, {
    startY: y,
    head: [['Descrizione', 'Quantità', 'Importo €']],
    body: p.righe.length
      ? p.righe.map(r => [r.descrizione, `${r.quantita} ${unitaVoce(r.voce, r.quantita)}`, eur(r.importo)])
      : [['Nessuna spesa nel periodo', '', eur(0)]],
    foot: [
      ['Imponibile', '', eur(p.imponibile)],
      [ivaTesto, '', eur(p.iva)],
      ['Totale', '', eur(p.totale)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: ARANCIO },
    footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 36 }, 2: { halign: 'right', cellWidth: 32 } },
    margin: { left: L, right: 210 - R },
    didParseCell: (c: any) => { if (c.section !== 'body' && c.column.index > 0) c.cell.styles.halign = 'right' },
  })
  y = ((doc as any).lastAutoTable?.finalY || y) + 6

  // Fuori dal totale: soldi entrati nel conto del cliente nello stesso periodo.
  const info: string[] = []
  if (p.ricariche.n) info.push(`Ricariche nel periodo: ${p.ricariche.n} per € ${eur(p.ricariche.importo)}`)
  if (p.contrassegni.n) info.push(`Contrassegni accreditati nel periodo: ${p.contrassegni.n} per € ${eur(p.contrassegni.importo)}`)
  if (info.length) {
    doc.setFontSize(8); doc.setTextColor(...GRIGIO); doc.setFont('helvetica', 'bold')
    doc.text('PER INFORMAZIONE (NON INCLUSI NEL TOTALE)', L, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(0); doc.setFontSize(8.5)
    info.forEach((r, i) => doc.text(r, L, y + 5 + i * 4.5))
    y += 5 + info.length * 4.5 + 3
  }
  if (e.iban) {
    doc.setFontSize(8); doc.setTextColor(...GRIGIO); doc.setFont('helvetica', 'bold')
    doc.text('COORDINATE BANCARIE', L, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(0); doc.setFontSize(8.5)
    doc.text(riga(`IBAN ${e.iban}`, e.banca ? `- ${e.banca}` : '', e.intestatario ? `- intestato a ${e.intestatario}` : ''), L, y + 5)
    y += 11
  }

  // Dettaglio.
  if (p.movimenti.length) {
    doc.addPage()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
    doc.text(`Dettaglio — ${p.movimenti.length} movimenti`, L, 16)
    autoTable(doc, {
      startY: 20,
      head: [['Data', 'Voce', 'Descrizione', 'Importo €']],
      body: p.movimenti.map(m => [dataIt(m.created_at), etichettaVoce(m.voce), m.descrizione, eur(m.importo)]),
      styles: { fontSize: 7, cellPadding: 1 },
      headStyles: { fillColor: ARANCIO },
      columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 34 }, 3: { halign: 'right', cellWidth: 20 } },
      margin: { left: L, right: 210 - R },
    })
  }

  // Piede su ogni pagina: la proforma non e' una fattura.
  const pagine = doc.getNumberOfPages()
  for (let i = 1; i <= pagine; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5); doc.setTextColor(...GRIGIO); doc.setFont('helvetica', 'normal')
    doc.text('Documento non valido ai fini fiscali', L, 289)
    doc.text(`Proforma ${p.numero} - pagina ${i} di ${pagine}`, R, 289, { align: 'right' })
  }
  return new Uint8Array(doc.output('arraybuffer'))
}

function riga(...p: string[]) { return p.filter(Boolean).join(' ') }
