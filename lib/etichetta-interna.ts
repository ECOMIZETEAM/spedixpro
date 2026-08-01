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

// Spezza un testo sulle parole per farlo stare in larghezza, al massimo su `maxRighe` righe.
// L'ultima riga, se avanza roba, finisce con l'ellissi: meglio dire "c'e' dell'altro" che far
// credere che il nome finisca li'.
function aCapo(testo: string, font: any, size: number, larghezza: number, maxRighe: number): string[] {
  const parole = String(testo || '').trim().split(/\s+/).filter(Boolean)
  if (!parole.length) return []
  const righe: string[] = []
  let corrente = ''
  for (const parola of parole) {
    const prova = corrente ? `${corrente} ${parola}` : parola
    if (font.widthOfTextAtSize(prova, size) <= larghezza) { corrente = prova; continue }
    if (corrente) righe.push(corrente)
    if (righe.length >= maxRighe) { corrente = ''; break }
    // Parola singola piu' lunga della riga (un indirizzo web, un codice): si taglia lei.
    corrente = parola
    while (corrente.length > 1 && font.widthOfTextAtSize(corrente, size) > larghezza) corrente = corrente.slice(0, -1)
  }
  if (corrente && righe.length < maxRighe) righe.push(corrente)
  const usate = righe.join(' ').replace(/\s+/g, ' ')
  const tutto = parole.join(' ')
  if (usate.length < tutto.length && righe.length) {
    let ultima = righe[righe.length - 1]
    while (ultima.length > 1 && font.widthOfTextAtSize(ultima + '…', size) > larghezza) ultima = ultima.slice(0, -1)
    righe[righe.length - 1] = ultima + '…'
  }
  return righe
}

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
    // Il testo si MISURA prima di scriverlo. Tagliare a 60 caratteri non voleva dire niente: sono
    // i millimetri a finire, non le lettere — "AZIENDA AGRICOLA FRATELLI ESPOSITO SRL" sta in 60
    // caratteri e occupa 112 mm su una pagina che ne ha 88, quindi usciva dal foglio. E
    // l'etichetta e' l'unica cosa che l'autista ha in mano davanti al citofono: se il nome e'
    // tagliato, non consegna.
    const larghezzaUtile = L - 12 * MM
    const testo = (t: string, x: number, y: number, size = 9, f = font, col = nero) => {
      let s = String(t || '')
      const max = larghezzaUtile - (x - 6 * MM)
      if (!s) return
      // Prima si prova a rimpicciolire (fino a un limite leggibile), poi si taglia con l'ellissi:
      // meglio un nome piu' piccolo ma intero che uno grande e mozzato.
      let dim = size
      while (dim > size * 0.62 && f.widthOfTextAtSize(s, dim) > max) dim -= 0.5
      while (s.length > 1 && f.widthOfTextAtSize(s, dim) > max) s = s.slice(0, -1)
      if (s !== String(t || '') && s.length > 1) s = s.slice(0, -1) + '…'
      p.drawText(s, { x, y, size: dim, font: f, color: col })
    }
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
    // Millimetri contati: sotto ci sono nome, indirizzo, contrassegno, nota e codice a barre, e su
    // 15 cm il primo che avanza spazio deve darlo. L'intestazione e' quella che serve meno.
    y -= 15 * MM
    riga(y); y -= 6 * MM

    testo('MITTENTE', 6 * MM, y, 7, grassetto, grigio); y -= 4.5 * MM
    testo(d.mittente?.nome || '', 6 * MM, y, 10, grassetto); y -= 4.2 * MM
    testo(d.mittente?.indirizzo || '', 6 * MM, y, 9); y -= 4.2 * MM
    testo(`${d.mittente?.cap || ''} ${d.mittente?.citta || ''} ${d.mittente?.provincia ? '(' + d.mittente.provincia + ')' : ''}`, 6 * MM, y, 9)
    y -= 6 * MM
    riga(y); y -= 6 * MM

    testo('DESTINATARIO', 6 * MM, y, 7, grassetto, grigio); y -= 6 * MM
    // Il nome del destinatario non si taglia: e' quello che l'autista legge sul citofono. Se non
    // ci sta va a capo — due righe, che su una ragione sociale lunga bastano sempre.
    for (const riga of aCapo(d.destinatario?.nome || '', grassetto, 14, L - 12 * MM, 2)) {
      testo(riga, 6 * MM, y, 14, grassetto); y -= 5.6 * MM
    }
    y -= 0.4 * MM
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

    // IL FONDO E' DEL CODICE A BARRE. Le barre stanno a un'altezza fissa (14 mm dal bordo, alte
    // 20) e il testo che scende non lo sa: con un nome su due righe la nota finiva stampata SOPRA
    // le barre, e un codice sporcato non si legge — cioe' il pacco non si scansiona piu'.
    const Y_FONDO = 37 * MM

    // Il contrassegno va gridato: chi consegna deve incassare, e se non lo vede non lo chiede.
    // Se il testo sopra ha mangiato lo spazio, il riquadro si appoggia comunque sopra le barre:
    // e' l'ultima cosa a cui rinunciare.
    const cod = Number(d.contrassegno || 0)
    // Il riquadro del contrassegno si appoggia sopra le barre: e' l'ultima cosa a cui rinunciare.
    const yBox = cod > 0 ? Math.max(y - 9 * MM, Y_FONDO) : null

    // La nota PRIMA del contrassegno: "citofonare portineria" serve a chi consegna, e messa dopo
    // il riquadro finiva schiacciata contro le barre e saltava quasi sempre. Resta comunque un di
    // piu': se non c'e' posto si lascia perdere, sulle barre non ci si stampa.
    const tetto = (yBox !== null ? yBox + 10 * MM : Y_FONDO)
    if (d.note && y - 3.5 * MM >= tetto) testo(d.note, 6 * MM, y, 8, font, grigio)

    if (yBox !== null) {
      p.drawRectangle({ x: 6 * MM, y: yBox, width: L - 12 * MM, height: 10 * MM, color: rgb(0, 0, 0) })
      // Importo scritto all'italiana: e' la cifra che l'autista deve farsi dare in mano.
      const cifra = cod.toFixed(2).replace('.', ',')
      p.drawText(`CONTRASSEGNO  € ${cifra}`, { x: 9 * MM, y: yBox + 3.2 * MM, size: 13, font: grassetto, color: rgb(1, 1, 1) })
      y = yBox - 4 * MM
    }

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
