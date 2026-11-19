// GENERAZIONE REPORT SPEDIZIONI (lato browser). Due layout, entrambi come Spedisci.online:
//  - RIEPILOGO (file unico): una riga per DIRETTO — cliente diretto o sotto-master di prima linea —
//    (Spedizioni, Colli, Prezzo, Iva, Totale) + totali.
//  - DETTAGLIO (file diviso per cliente/contratto): riga per spedizione (LDV, Data, Rif. Mittente,
//    Destinatario, Colli, Prezzo) + totali. Un file per gruppo, raccolti in ZIP.
// Intestazione = dati del MASTER loggato (ragione sociale, indirizzo, email, PIVA, logo).
// Il "Prezzo" è il NETTO (prezzo cliente); l'IVA è quella del DIRETTO (aliquota della scheda cliente,
// 22% se vuota; 22% per i sotto-master); il Totale = Prezzo + IVA.

// Il DETTAGLIO Excel/CSV usa il tracciato "foto" a 34 colonne (builder condiviso col report cliente),
// non le 6 colonne corte: ri-esportato qui così la pagina master lo chiama come le altre funzioni gen.*.
export { excelReportSpedizioniB64, righeReportSpedizioni } from '@/lib/report-spedizioni-cols'

export type Intestazione = { nome: string; indirizzo: string; email: string; piva: string; logo_url?: string | null }
export type SpedRow = {
  numero?: string; created_at?: string; mitt_nome?: string; dest_nome?: string; dest_citta?: string;
  dest_provincia?: string; colli?: number; costo_totale?: number;
  clienti?: { ragione_sociale?: string } | null; corrieri?: { nome_contratto?: string } | null
  // A chi il master fattura la riga (cliente diretto o sotto-master di prima linea) e la sua aliquota:
  // li mette la rotta del report. Senza (righe di altre fonti) si ragiona sul cliente della riga, al 22%.
  diretto_id?: string; diretto_nome?: string; aliquota_iva?: number | null
}

const IVA_PREDEFINITA = 22
// IVA fissa al 22% per tutti: gli 82 clienti allo 0% che hanno spedito fra il 15/09 e il 14/10/2026 si
// vedevano 12.010 € di IVA nei PDF. L'aliquota e' quella del diretto, riga per riga.
const aliquotaDi = (s: SpedRow) => (s.aliquota_iva != null && Number.isFinite(Number(s.aliquota_iva))) ? Number(s.aliquota_iva) : IVA_PREDEFINITA
const ivaDi = (s: SpedRow) => (Number(s.costo_totale) || 0) * aliquotaDi(s) / 100
const eur = (n: number) => '€ ' + (Math.round(n * 100) / 100).toFixed(2)
const nCli = (s: SpedRow) => (s.clienti?.ragione_sociale || s.mitt_nome || '—').trim()
// Il DIRETTO (riepilogo e file divisi per cliente): per un master e' a chi fattura, non il cliente finale.
const kDir = (s: SpedRow) => s.diretto_id || ('c:' + nCli(s))
const nDir = (s: SpedRow) => (s.diretto_nome || nCli(s)).trim()
// "Iva (22%)" se l'aliquota e' una sola, altrimenti solo "Iva": con aliquote diverse il numero fra
// parentesi sarebbe falso.
const etichettaIva = (aliquote: number[]) => { const u = Array.from(new Set(aliquote)); return u.length === 1 ? `Iva (${u[0]}%)` : 'Iva' }
const nCon = (s: SpedRow) => (s.corrieri?.nome_contratto || 'Senza contratto').trim()
const dataIt = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleDateString('it-IT') }

export function periodoStr(dal?: string, al?: string): string {
  const f = (s?: string) => { if (!s) return ''; const [y, m, g] = s.slice(0, 10).split('-'); return g && m && y ? `${g}/${m}/${y}` : s }
  return `( ${f(dal)} - ${f(al)} )`
}

// Nome file sicuro (come la cartella 108: MAIUSCOLE/underscore, niente caratteri strani).
export function nomeFileSicuro(s: string): string {
  return (s || 'senza_nome').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'senza_nome'
}

// ── AGGREGAZIONE per il RIEPILOGO (una riga per DIRETTO) ──
// Per un master: una riga per cliente diretto, una per ogni sotto-master di prima linea (e' a lui che
// fattura le spedizioni della sua rete) e una "Spedizioni proprie". Prima era una riga per cliente
// finale: MULTIEXPRESS (1-14/10/2026) ne aveva 1.238, quasi tutte clienti dei sotto-master, e le 474
// spedizioni senza cliente finivano in una riga sola; ora sono 58 righe.
export type RigaRiepilogo = { cliente: string; spedizioni: number; colli: number; prezzo: number; aliquota: number; iva: number }
export function aggregaPerCliente(speds: SpedRow[]): RigaRiepilogo[] {
  const m = new Map<string, RigaRiepilogo>()
  for (const s of speds) {
    const k = kDir(s)
    const r = m.get(k) || { cliente: nDir(s), spedizioni: 0, colli: 0, prezzo: 0, aliquota: aliquotaDi(s), iva: 0 }
    r.spedizioni += 1
    r.colli += Number(s.colli) || 0
    r.prezzo += Number(s.costo_totale) || 0
    r.iva += ivaDi(s)
    m.set(k, r)
  }
  return [...m.values()].sort((a, b) => b.prezzo - a.prezzo)
}

// ── RAGGRUPPAMENTO per la SUDDIVISIONE ──
export type Gruppo = { key: string; cliente: string; contratto: string; righe: SpedRow[] }
// "Per cliente" = per DIRETTO, come il riepilogo: un file per ciascuno a cui il master fattura (il
// dettaglio dentro tiene il cliente finale nella sua colonna).
export function raggruppa(speds: SpedRow[], modo: 'cliente' | 'contratto' | 'cliente_contratto'): Gruppo[] {
  const m = new Map<string, Gruppo>()
  for (const s of speds) {
    const cli = nDir(s), con = nCon(s)
    const key = modo === 'cliente' ? kDir(s) : modo === 'contratto' ? con : kDir(s) + ' • ' + con
    const g = m.get(key) || { key, cliente: modo === 'contratto' ? '' : cli, contratto: modo === 'cliente' ? '' : con, righe: [] }
    g.righe.push(s); m.set(key, g)
  }
  return [...m.values()].sort((a, b) => (a.cliente + ' • ' + a.contratto).localeCompare(b.cliente + ' • ' + b.contratto))
}

// ── logo → dataURL (best-effort: se non si carica, header solo testo) ──
async function logoDataUrl(url?: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url); if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = no; fr.readAsDataURL(blob) })
  } catch { return null }
}

// ── intestazione comune del PDF: logo + dati master a dx, titolo (cliente) + periodo a sx ──
async function headerPDF(doc: any, intest: Intestazione, titoloSx: string, periodo: string): Promise<number> {
  const W = doc.internal.pageSize.getWidth()
  const logo = await logoDataUrl(intest.logo_url)
  if (logo) { try { doc.addImage(logo, 'PNG', 14, 12, 40, 16) } catch { /* formato non gestito: si salta */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(30, 30, 30)
  doc.text(intest.nome || '', W - 14, 20, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90)
  let y = 27
  for (const riga of [intest.indirizzo, intest.email ? 'e-mail : ' + intest.email : '', intest.piva ? 'P.IVA ' + intest.piva : ''].filter(Boolean)) {
    doc.text(String(riga), W - 14, y, { align: 'right' }); y += 5
  }
  if (titoloSx) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30, 30, 30); doc.text(titoloSx, 14, 34) }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90); doc.text(periodo, 14, titoloSx ? 40 : 34)
  const startY = Math.max(y, 46)
  doc.setDrawColor(210, 210, 210); doc.line(14, startY, W - 14, startY)
  return startY + 6
}

// ── blocco TOTALI (SUBTOTALE / IVA / TOTALE) sotto la tabella ──
function totaliPDF(doc: any, prezzoNetto: number, iva: number, etichetta: string, finalY: number) {
  const W = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  let y = finalY + 12
  if (y + 24 > pageH - 12) { doc.addPage(); y = 24 }
  const x1 = 20, x2 = W - 20
  const tot = prezzoNetto + iva
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60)
  doc.setDrawColor(210, 210, 210); doc.line(x1, y - 4, x2, y - 4)
  doc.text('SUBTOTALE', x1, y); doc.text(eur(prezzoNetto), x2, y, { align: 'right' })
  doc.line(x1, y + 4, x2, y + 4)
  doc.text(etichetta, x1, y + 10); doc.text(eur(iva), x2, y + 10, { align: 'right' })
  doc.setDrawColor(34, 163, 74); doc.line(x1, y + 14, x2, y + 14)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(34, 163, 74)
  doc.text('TOTALE', x1, y + 21); doc.text(eur(tot), x2, y + 21, { align: 'right' })
}

async function nuovoDoc() {
  const { default: jsPDF } = await import('jspdf'); await import('jspdf-autotable')
  // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
  return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
}

// RIEPILOGO PDF (foto 1)
export async function pdfRiepilogoB64(intest: Intestazione, periodo: string, righe: RigaRiepilogo[]): Promise<string> {
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = await nuovoDoc()
  const startY = await headerPDF(doc, intest, '', periodo)
  autoTable(doc, {
    startY,
    head: [['Cliente', 'Spedizioni', 'Colli', 'Prezzo', 'Iva', 'Totale']],
    body: righe.map(r => [r.cliente, String(r.spedizioni), String(r.colli), eur(r.prezzo), eur(r.iva), eur(r.prezzo + r.iva)]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    theme: 'plain',
  })
  totaliPDF(doc, righe.reduce((a, r) => a + r.prezzo, 0), righe.reduce((a, r) => a + r.iva, 0), etichettaIva(righe.map(r => r.aliquota)), (doc as any).lastAutoTable.finalY)
  return doc.output('datauristring')
}

// DETTAGLIO PDF (cartella 108)
export async function pdfDettaglioB64(intest: Intestazione, periodo: string, titolo: string, righe: SpedRow[]): Promise<string> {
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = await nuovoDoc()
  const startY = await headerPDF(doc, intest, titolo, periodo)
  autoTable(doc, {
    startY,
    head: [['Spedizioni', 'Data', 'Rif. Mittente', 'Destinatario', 'Colli', 'Prezzo']],
    body: righe.map(s => [
      s.numero || '', dataIt(s.created_at), s.mitt_nome || '',
      [s.dest_nome, s.dest_citta, s.dest_provincia].filter(Boolean).join(', '),
      String(Number(s.colli) || 0), eur(Number(s.costo_totale) || 0),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: 'bold' },
    columnStyles: { 4: { halign: 'center' }, 5: { halign: 'right' } },
    theme: 'plain',
  })
  totaliPDF(doc, righe.reduce((a, s) => a + (Number(s.costo_totale) || 0), 0), righe.reduce((a, s) => a + ivaDi(s), 0), etichettaIva(righe.map(aliquotaDi)), (doc as any).lastAutoTable.finalY)
  return doc.output('datauristring')
}

// ── EXCEL/CSV (stesso contenuto, tabellare) ──
async function foglioB64(intestazioni: string[], corpo: (string | number)[][], totali: (string | number)[], formato: 'xlsx' | 'csv'): Promise<string> {
  const XLSX = await import('xlsx')
  const aoa = [intestazioni, ...corpo, [], totali]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Report')
  return XLSX.write(wb, { bookType: formato === 'csv' ? 'csv' : 'xlsx', type: 'base64' })
}
export function riepilogoRighe(righe: RigaRiepilogo[]) {
  const c2 = (n: number) => Math.round(n * 100) / 100
  const corpo = righe.map(r => [r.cliente, r.spedizioni, r.colli, c2(r.prezzo), c2(r.iva), c2(r.prezzo + r.iva)])
  const tp = righe.reduce((a, r) => a + r.prezzo, 0)
  const ti = righe.reduce((a, r) => a + r.iva, 0)
  return { corpo, tot: ['TOTALE', righe.reduce((a, r) => a + r.spedizioni, 0), righe.reduce((a, r) => a + r.colli, 0), c2(tp), c2(ti), c2(tp + ti)] }
}
export async function excelRiepilogoB64(righe: RigaRiepilogo[], formato: 'xlsx' | 'csv') {
  const { corpo, tot } = riepilogoRighe(righe)
  return foglioB64(['Cliente', 'Spedizioni', 'Colli', 'Prezzo', 'Iva', 'Totale'], corpo, tot, formato)
}
// (excelDettaglioB64 — le vecchie 6 colonne corte — RIMOSSA: il dettaglio Excel/CSV ora usa il
//  tracciato "foto" a 34 colonne via excelReportSpedizioniB64. Il PDF resta pdfDettaglioB64.)

// ── TABELLA GENERICA (altri report con la STESSA grafica, es. Report Agenti) ──
// Intestazione master + tabella + riga totale (verde) in fondo. `totaleRiga` opzionale.
export async function pdfTabellaB64(
  intest: Intestazione, periodo: string, titolo: string,
  headers: string[], rows: (string | number)[][], totaleRiga?: (string | number)[],
  align?: Record<number, 'left' | 'center' | 'right'>
): Promise<string> {
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = await nuovoDoc()
  const startY = await headerPDF(doc, intest, titolo, periodo)
  const columnStyles: any = {}
  for (const k of Object.keys(align || {})) columnStyles[k] = { halign: (align as any)[k] }
  autoTable(doc, {
    startY,
    head: [headers],
    body: rows.map(r => r.map(x => String(x))),
    foot: totaleRiga ? [totaleRiga.map(x => String(x))] : undefined,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: 'bold' },
    footStyles: { fillColor: [255, 255, 255], textColor: [34, 163, 74], fontStyle: 'bold' },
    columnStyles,
    theme: 'plain',
  })
  return doc.output('datauristring')
}
export async function excelTabellaB64(headers: string[], rows: (string | number)[][], totaleRiga: (string | number)[] | undefined, formato: 'xlsx' | 'csv'): Promise<string> {
  const XLSX = await import('xlsx')
  const aoa: any[][] = [headers, ...rows]
  if (totaleRiga) { aoa.push([]); aoa.push(totaleRiga) }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Report')
  return XLSX.write(wb, { bookType: formato === 'csv' ? 'csv' : 'xlsx', type: 'base64' })
}

// estensione per il nome file
export const estFormato = (f: string) => f === 'xlsx' ? 'xlsx' : f === 'csv' ? 'csv' : 'pdf'
