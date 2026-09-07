// GENERAZIONE REPORT SPEDIZIONI (lato browser). Due layout, entrambi come Spedisci.online:
//  - RIEPILOGO (file unico): una riga per CLIENTE (Spedizioni, Colli, Prezzo, Iva, Totale) + totali.
//  - DETTAGLIO (file diviso per cliente/contratto): riga per spedizione (LDV, Data, Rif. Mittente,
//    Destinatario, Colli, Prezzo) + totali. Un file per gruppo, raccolti in ZIP.
// Intestazione = dati del MASTER loggato (ragione sociale, indirizzo, email, PIVA, logo).
// Il "Prezzo" è il NETTO (prezzo cliente); l'IVA è al 22%; il Totale = Prezzo × 1,22.

export type Intestazione = { nome: string; indirizzo: string; email: string; piva: string; logo_url?: string | null }
export type SpedRow = {
  numero?: string; created_at?: string; mitt_nome?: string; dest_nome?: string; dest_citta?: string;
  dest_provincia?: string; colli?: number; costo_totale?: number;
  clienti?: { ragione_sociale?: string } | null; corrieri?: { nome_contratto?: string } | null
}

const IVA = 0.22
const eur = (n: number) => '€ ' + (Math.round(n * 100) / 100).toFixed(2)
const nCli = (s: SpedRow) => (s.clienti?.ragione_sociale || s.mitt_nome || '—').trim()
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

// ── AGGREGAZIONE per il RIEPILOGO (una riga per cliente) ──
export type RigaRiepilogo = { cliente: string; spedizioni: number; colli: number; prezzo: number }
export function aggregaPerCliente(speds: SpedRow[]): RigaRiepilogo[] {
  const m = new Map<string, RigaRiepilogo>()
  for (const s of speds) {
    const k = nCli(s)
    const r = m.get(k) || { cliente: k, spedizioni: 0, colli: 0, prezzo: 0 }
    r.spedizioni += 1
    r.colli += Number(s.colli) || 0
    r.prezzo += Number(s.costo_totale) || 0
    m.set(k, r)
  }
  return [...m.values()].sort((a, b) => b.prezzo - a.prezzo)
}

// ── RAGGRUPPAMENTO per la SUDDIVISIONE ──
export type Gruppo = { key: string; cliente: string; contratto: string; righe: SpedRow[] }
export function raggruppa(speds: SpedRow[], modo: 'cliente' | 'contratto' | 'cliente_contratto'): Gruppo[] {
  const m = new Map<string, Gruppo>()
  for (const s of speds) {
    const cli = nCli(s), con = nCon(s)
    const key = modo === 'cliente' ? cli : modo === 'contratto' ? con : cli + ' • ' + con
    const g = m.get(key) || { key, cliente: modo === 'contratto' ? '' : cli, contratto: modo === 'cliente' ? '' : con, righe: [] }
    g.righe.push(s); m.set(key, g)
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key))
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
function totaliPDF(doc: any, prezzoNetto: number, finalY: number) {
  const W = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  let y = finalY + 12
  if (y + 24 > pageH - 12) { doc.addPage(); y = 24 }
  const x1 = 20, x2 = W - 20
  const iva = prezzoNetto * IVA, tot = prezzoNetto + iva
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60)
  doc.setDrawColor(210, 210, 210); doc.line(x1, y - 4, x2, y - 4)
  doc.text('SUBTOTALE', x1, y); doc.text(eur(prezzoNetto), x2, y, { align: 'right' })
  doc.line(x1, y + 4, x2, y + 4)
  doc.text('Iva (22%)', x1, y + 10); doc.text(eur(iva), x2, y + 10, { align: 'right' })
  doc.setDrawColor(34, 163, 74); doc.line(x1, y + 14, x2, y + 14)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(34, 163, 74)
  doc.text('TOTALE', x1, y + 21); doc.text(eur(tot), x2, y + 21, { align: 'right' })
}

async function nuovoDoc() {
  const { default: jsPDF } = await import('jspdf'); await import('jspdf-autotable')
  return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
}

// RIEPILOGO PDF (foto 1)
export async function pdfRiepilogoB64(intest: Intestazione, periodo: string, righe: RigaRiepilogo[]): Promise<string> {
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = await nuovoDoc()
  const startY = await headerPDF(doc, intest, '', periodo)
  autoTable(doc, {
    startY,
    head: [['Cliente', 'Spedizioni', 'Colli', 'Prezzo', 'Iva', 'Totale']],
    body: righe.map(r => [r.cliente, String(r.spedizioni), String(r.colli), eur(r.prezzo), eur(r.prezzo * IVA), eur(r.prezzo * (1 + IVA))]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [245, 245, 245], textColor: [80, 80, 80], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    theme: 'plain',
  })
  totaliPDF(doc, righe.reduce((a, r) => a + r.prezzo, 0), (doc as any).lastAutoTable.finalY)
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
  totaliPDF(doc, righe.reduce((a, s) => a + (Number(s.costo_totale) || 0), 0), (doc as any).lastAutoTable.finalY)
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
  const corpo = righe.map(r => [r.cliente, r.spedizioni, r.colli, r.prezzo, Math.round(r.prezzo * IVA * 100) / 100, Math.round(r.prezzo * (1 + IVA) * 100) / 100])
  const tp = righe.reduce((a, r) => a + r.prezzo, 0)
  return { corpo, tot: ['TOTALE', righe.reduce((a, r) => a + r.spedizioni, 0), righe.reduce((a, r) => a + r.colli, 0), Math.round(tp * 100) / 100, Math.round(tp * IVA * 100) / 100, Math.round(tp * (1 + IVA) * 100) / 100] }
}
export async function excelRiepilogoB64(righe: RigaRiepilogo[], formato: 'xlsx' | 'csv') {
  const { corpo, tot } = riepilogoRighe(righe)
  return foglioB64(['Cliente', 'Spedizioni', 'Colli', 'Prezzo', 'Iva', 'Totale'], corpo, tot, formato)
}
export async function excelDettaglioB64(righe: SpedRow[], formato: 'xlsx' | 'csv') {
  const corpo = righe.map(s => [s.numero || '', dataIt(s.created_at), s.mitt_nome || '', [s.dest_nome, s.dest_citta, s.dest_provincia].filter(Boolean).join(', '), Number(s.colli) || 0, Math.round((Number(s.costo_totale) || 0) * 100) / 100])
  const tp = righe.reduce((a, s) => a + (Number(s.costo_totale) || 0), 0)
  const tot = ['', '', '', 'TOTALE', righe.reduce((a, s) => a + (Number(s.colli) || 0), 0), Math.round(tp * 100) / 100]
  return foglioB64(['Spedizioni', 'Data', 'Rif. Mittente', 'Destinatario', 'Colli', 'Prezzo'], corpo, tot, formato)
}

// estensione per il nome file
export const estFormato = (f: string) => f === 'xlsx' ? 'xlsx' : f === 'csv' ? 'csv' : 'pdf'
