import { barreCode128 } from '@/lib/codice-a-barre'

// ETICHETTA DEL CIRCUITO INTERNO.
//
// Sui contratti dei provider l'etichetta la stampa il corriere. Sul circuito interno il corriere
// siamo noi: la lettera di vettura la produciamo qui, col logo del master che spedisce — e' la sua
// rete, deve essere il suo marchio ad andare sul pacco.
//
// Formato 10x15 cm, quello delle stampanti termiche da magazzino. Una pagina per collo: ogni collo
// viaggia da solo e deve avere il suo codice sopra, altrimenti in deposito non si distinguono.

type Dati = {
  numero: string
  mittente: { nome?: string; indirizzo?: string; cap?: string; citta?: string; provincia?: string; telefono?: string }
  destinatario: { nome?: string; indirizzo?: string; cap?: string; citta?: string; provincia?: string; telefono?: string }
  colli: number
  peso?: number | null
  contrassegno?: number | null
  note?: string | null
  riferimento?: string | null
  logoPng?: Uint8Array | null
  nomeMaster?: string | null
}

const MM = 72 / 25.4          // punti PDF per millimetro
const L = 100 * MM, H = 150 * MM

export async function etichettaInterna(d: Dati): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const grassetto = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: any = null
  if (d.logoPng?.length) { try { logo = await pdf.embedPng(d.logoPng) } catch { logo = null } }

  const nColli = Math.max(1, Number(d.colli) || 1)
  for (let i = 1; i <= nColli; i++) {
    const p = pdf.addPage([L, H])
    const nero = rgb(0, 0, 0), grigio = rgb(0.45, 0.45, 0.45)
    const testo = (t: string, x: number, y: number, size = 9, f = font, col = nero) =>
      p.drawText(String(t || '').slice(0, 60), { x, y, size, font: f, color: col })
    const riga = (y: number) => p.drawLine({ start: { x: 6 * MM, y }, end: { x: L - 6 * MM, y }, thickness: 0.7, color: grigio })

    let y = H - 8 * MM
    if (logo) {
      const w = 34 * MM, h = (logo.height / logo.width) * w
      p.drawImage(logo, { x: 6 * MM, y: y - h, width: w, height: Math.min(h, 14 * MM) })
    } else if (d.nomeMaster) {
      testo(d.nomeMaster, 6 * MM, y - 5 * MM, 13, grassetto)
    }
    // Collo n di N: senza, in deposito non si sa se il carico e' completo.
    testo(`COLLO ${i} DI ${nColli}`, L - 34 * MM, y - 5 * MM, 11, grassetto)
    y -= 18 * MM
    riga(y); y -= 6 * MM

    testo('MITTENTE', 6 * MM, y, 7, grassetto, grigio); y -= 4.5 * MM
    testo(d.mittente?.nome || '', 6 * MM, y, 10, grassetto); y -= 4.2 * MM
    testo(d.mittente?.indirizzo || '', 6 * MM, y, 9); y -= 4.2 * MM
    testo(`${d.mittente?.cap || ''} ${d.mittente?.citta || ''} ${d.mittente?.provincia ? '(' + d.mittente.provincia + ')' : ''}`, 6 * MM, y, 9)
    y -= 7 * MM
    riga(y); y -= 7 * MM

    testo('DESTINATARIO', 6 * MM, y, 7, grassetto, grigio); y -= 6 * MM
    testo(d.destinatario?.nome || '', 6 * MM, y, 14, grassetto); y -= 6 * MM
    testo(d.destinatario?.indirizzo || '', 6 * MM, y, 11); y -= 6 * MM
    testo(`${d.destinatario?.cap || ''} ${d.destinatario?.citta || ''} ${d.destinatario?.provincia ? '(' + d.destinatario.provincia + ')' : ''}`, 6 * MM, y, 13, grassetto)
    y -= 5.5 * MM
    if (d.destinatario?.telefono) { testo(`Tel. ${d.destinatario.telefono}`, 6 * MM, y, 10); y -= 5.5 * MM }
    y -= 1 * MM
    riga(y); y -= 6 * MM

    const peso = Number(d.peso || 0)
    if (peso > 0) testo(`Peso ${peso.toFixed(2)} kg`, 6 * MM, y, 10, grassetto)
    if (d.riferimento) testo(`Rif. ${d.riferimento}`, 42 * MM, y, 9)
    y -= 6 * MM

    // Il contrassegno va gridato: chi consegna deve incassare, e se non lo vede non lo chiede.
    const cod = Number(d.contrassegno || 0)
    if (cod > 0) {
      p.drawRectangle({ x: 6 * MM, y: y - 9 * MM, width: L - 12 * MM, height: 10 * MM, color: rgb(0, 0, 0) })
      p.drawText(`CONTRASSEGNO  € ${cod.toFixed(2)}`, { x: 9 * MM, y: y - 6.5 * MM, size: 13, font: grassetto, color: rgb(1, 1, 1) })
      y -= 13 * MM
    }
    if (d.note) { testo(d.note, 6 * MM, y, 8, font, grigio); y -= 5 * MM }

    // ── Codice a barre in fondo, dove il lettore lo cerca ──
    const larghezze = barreCode128(d.numero)
    const totModuli = larghezze.reduce((s, w) => s + w, 0)
    const modulo = (L - 16 * MM) / totModuli
    const altezzaBarre = 20 * MM
    const yBarre = 14 * MM
    let x = 8 * MM
    let barra = true
    for (const w of larghezze) {
      if (barra) p.drawRectangle({ x, y: yBarre, width: w * modulo, height: altezzaBarre, color: nero })
      x += w * modulo
      barra = !barra
    }
    const larghezzaTesto = grassetto.widthOfTextAtSize(d.numero, 14)
    p.drawText(d.numero, { x: (L - larghezzaTesto) / 2, y: 7 * MM, size: 14, font: grassetto, color: nero })
  }

  return pdf.save()
}
