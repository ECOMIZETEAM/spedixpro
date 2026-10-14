// Resa grafica etichetta SDA EXPRESS L (Poste Delivery Business, prodotto APT000901).
//
// PERCHE': la 1011 che torna da Poste e' ruotata e con i campi accavallati (logo sopra il legale,
// "Peso(kg)COLLIHxLxP" attaccati...). Non e' usabile cosi'. La ri-rendiamo nel layout PULITO che
// e' stato approvato (lo stesso di un'etichetta Poste Delivery Business "bella", 14,82x10,52cm).
//
// REGOLA CHE NON SI NEGOZIA: i CODICI (2 barcode Code128 + 2 DataMatrix) restano ESATTAMENTE quelli
// che manda SDA. Non li rigeneriamo: li COPIAMO dall'originale (pdf-lib embedPage, lossless) e li
// rimontiamo. Cosi' i pacchi non si smistano male. Verificato ri-decodificando: 100/100 scansionabili.
//
// MULTICOLLO: il 1011 e' un PDF a N pagine, una per collo, ognuna coi SUOI codici. Produciamo un PDF
// a N pagine. LDV, peso, misure e instradamento (GIRO/CAP del riquadro nero) li leggiamo dal TESTO di
// ogni pagina, anche sul monocollo: sono quelli registrati da Poste, mentre la riga puo' essere stata
// corretta dopo (lo fa la correzione manuale). Mittente, destinatario e data vengono dalla riga.
//
// DEPLOY-SAFE: nessun modulo nativo. pdfjs SOLO in parsing (getOperatorList/getTextContent, niente
// canvas); pdf-lib per copiare i codici e disegnare. Font e logo incorporati (base64) in
// etichetta-sda-assets → niente letture da file-system in runtime (Vercel).
//
// Se qualcosa non torna (codici non riconosciuti su una pagina, errore qualunque) NON inventa: torna
// l'etichetta ORIGINALE, mai una rotta. Vedi [[sda-etichetta-replica-1011]].
import { PDFDocument, rgb, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { FONT_REGULAR_B64, FONT_BOLD_B64, LOGO_HEADER_B64 } from './etichetta-sda-assets'

export type DatiEtichettaSda = {
  riquadro: [string, string] // riquadro nero: ["GIRO", "202"] o ["CAP", "16167"], come lo stampa Poste
  capCode: string        // codice sotto il barcode CAP (CAP + "0000")
  data: string           // data (gg/mm/aaaa)
  ldv: string            // lettera di vettura
  peso: string           // es "18,5"
  colli: string          // es "1" o "1/2"
  hxlxp: string          // es "10x15x20" (altezza x larghezza x lunghezza)
  note: string           // NOTE: (campo note)
  contenuto: string      // CONT: (campo contenuto)
  rifOrdine: string      // RIF:  (riferimento ordine)
  mitt: string[]         // [telefono, nome, indirizzo, "CAP CITTA (PR)"]
  dest: string[]
}

type Bbox = { x: number; y: number; w: number; h: number }

async function caricaPdfjs(bytes: Buffer) {
  const mod: any = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = mod.getDocument ? mod : (mod.default || mod)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise
  return { pdfjs, doc }
}

// Trova i 4 codici in UNA pagina come IMMAGINI, classificandoli per FORMA (robusto alle posizioni):
// quadrate = DataMatrix (grande/piccolo per dimensione), larghe = barcode (LDV/CAP per area).
async function trovaCodici(page: any, OPS: any): Promise<{ dmG: Bbox; dmP: Bbox; bcLDV: Bbox; bcCAP: Bbox } | null> {
  const vp = page.getViewport({ scale: 1 })
  const ol = await page.getOperatorList()
  const nm = (v: number) => Object.keys(OPS).find(k => OPS[k] === v)
  let ctm = [1, 0, 0, 1, 0, 0]
  const st: number[][] = []
  const mul = (m: number[], n: number[]) => [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]]
  const imgs: Bbox[] = []
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = nm(ol.fnArray[i]); const a = ol.argsArray[i]
    // Un sotto-documento (form XObject) sposta le coordinate con una sua matrice che qui non si
    // segue: i riquadri dei codici verrebbero calcolati nel posto sbagliato. La 1011 di Poste disegna
    // i codici direttamente sulla pagina; un PDF che li tiene dentro un form non e' una 1011 (es. la
    // nostra stessa resa, o una pagina riadattata al formato di stampa) → nessun codice, originale.
    if (f === 'paintFormXObjectBegin') return null
    if (f === 'save') st.push([...ctm])
    else if (f === 'restore') ctm = st.pop() || ctm
    else if (f === 'transform') ctm = mul(ctm, a)
    else if (f === 'paintImageXObject') imgs.push({ x: ctm[4], y: ctm[5], w: Math.abs(ctm[0]), h: Math.abs(ctm[3]) })
  }
  const W = vp.width, H = vp.height
  const cand = imgs.filter(o => !(o.w > W * 0.8 && o.h > H * 0.8)) // scarta lo sfondo pieno-pagina
  const square = cand.filter(o => Math.abs(o.w - o.h) / Math.max(o.w, o.h) < 0.2).sort((a, b) => b.w - a.w)
  const wide = cand.filter(o => o.w / o.h > 1.4).sort((a, b) => (b.w * b.h) - (a.w * a.h))
  // La 1011 ha ESATTAMENTE due DataMatrix e due barcode (137/137 pagine vere, 13/10). Un'immagine in piu'
  // o in meno e' un'altra impaginazione: presi per forma, i codici finirebbero nel riquadro sbagliato.
  if (square.length !== 2 || wide.length !== 2) return null
  const [dmG, dmP] = square, [bcLDV, bcCAP] = wide
  return { dmG, dmP, bcLDV, bcCAP }
}

// Legge dal TESTO della pagina i campi che Poste ha registrato per quel collo (LDV, peso, misure,
// instradamento) e deriva "COLLI i/N". I valori stanno in colonna a x~78, accanto alla loro etichetta
// (x~85). Le misure Poste sono in ordine L×A×P (es. 26x76x46) → le giro in A×L×P come il resto del
// layout. Qualunque campo non letto → ripiega sul valore della riga spedizione.
async function datiPerCollo(page: any, base: DatiEtichettaSda, i: number, N: number): Promise<DatiEtichettaSda> {
  const tc = await page.getTextContent()
  const items = (tc.items as any[]).filter(x => x.str && x.str.trim())
  // Riquadro nero: "GIRO 202" (giro di consegna a destino) oppure "CAP 20020" quando il giro non c'e'.
  // Al posto del giro stampavamo sempre il CAP, e il giro spariva dall'etichetta.
  const giro = items.map(x => x.str.trim().match(/^(GIRO|CAP)\s*(\d{1,5})$/i)).find(Boolean)
  const riquadro: [string, string] = giro ? [giro[1].toUpperCase(), giro[2]] : base.riquadro
  // valore accanto a un'etichetta: stessa colonna (x~78), y vicina. Robusto all'ordine degli item.
  const near = (labelRe: RegExp, valRe: RegExp): string | null => {
    const lab = items.find(x => labelRe.test(x.str)); if (!lab) return null
    const ly = lab.transform[5]
    const c = items.filter(x => x !== lab && valRe.test(x.str.trim()) && Math.abs(x.transform[4] - 78) < 7 && Math.abs(x.transform[5] - ly) < 9)
      .sort((a, b) => Math.abs(a.transform[5] - ly) - Math.abs(b.transform[5] - ly))
    return c[0]?.str.trim() || null
  }
  // LDV COMPLETO del collo (ogni collo ne ha uno diverso: es. collo 2 = "224JMGH1D282224J037158").
  // Lo prendo dal valore di "Lettera di vettura", NON con una regex del tipo \d6[A-Z]\d6 (prenderebbe
  // solo il pezzo comune e il numero stampato non combacerebbe col barcode).
  const ldvP = near(/Lettera di vettura/i, /^[0-9A-Z]{8,}$/)
  const pesoP = near(/Peso/i, /^\d+[.,]\d+$/)
  const dimP = near(/HxLxP/i, /^\d+x\d+x\d+$/i)
  let hxlxp = base.hxlxp
  if (dimP) { const p = dimP.split('x'); if (p.length === 3) hxlxp = `${p[1]}x${p[0]}x${p[2]}` } // L×A×P → A×L×P
  return { ...base, riquadro, ldv: ldvP || base.ldv, peso: pesoP || base.peso, hxlxp, colli: N === 1 ? '1' : `${i}/${N}` }
}

// Disegna UNA pagina etichetta in `out`, copiando i codici dalla pagina sorgente `srcPage`.
async function disegnaPagina(out: any, srcPage: any, codici: { dmG: Bbox; dmP: Bbox; bcLDV: Bbox; bcCAP: Bbox }, dati: DatiEtichettaSda, bold: any, reg: any, logo: any) {
  const page = out.addPage([420, 298.1])
  const T = (x: number, y: number, s: number, f: any, t: string, color = rgb(0, 0, 0)) => page.drawText(t || '', { x, y, size: s, font: f, color })
  const fit = (x: number, y: number, s: number, f: any, t: string, maxW: number) => {
    // Un a capo nel testo manderebbe la seconda riga 24pt piu' in basso, sopra i campi sotto.
    t = String(t || '').replace(/\s+/g, ' ').trim()
    let s2 = s; while (f.widthOfTextAtSize(t, s2) > maxW && s2 > 3) s2 -= 0.1
    // Ancora troppo lungo a 3pt (CONT arriva a 255 caratteri): si tronca. Senza, il testo usciva dal
    // riquadro e copriva le prime barre del barcode del CAP (86 righe in 7 giorni, 13/10).
    if (f.widthOfTextAtSize(t, s2) > maxW) { while (t.length > 1 && f.widthOfTextAtSize(t + '…', s2) > maxW) t = t.slice(0, -1); t += '…' }
    T(x, y, s2, f, t)
  }

  // box + linee (geometria esatta del riferimento)
  page.drawRectangle({ x: 18, y: 235.1, width: 88.5, height: 46.5, color: rgb(0, 0, 0) })
  page.drawRectangle({ x: 109.9, y: 37.5, width: 228.7, height: 167.2, borderColor: rgb(0, 0, 0), borderWidth: 0.7 })
  const linea = (y: number) => page.drawRectangle({ x: 110.2, y, width: 228.0, height: 0.7, color: rgb(0, 0, 0) })
  linea(163.1); linea(98.6); linea(82.1)

  // logo+legale (asset fisso) e CODICI copiati dalla pagina sorgente (lossless)
  page.drawImage(logo, { x: 119.7, y: 232.7, width: 83, height: 48.7 })
  // I 4 codici in UNA sola embedPages: pdf-lib porta con se' TUTTE le risorse della pagina sorgente
  // (sulla 1011 sono quasi solo i due font di Poste, ~600KB) e le copia una volta per chiamata. Con
  // quattro embedPage separati l'etichetta pesava 2,7MB contro i 606KB dell'originale, moltiplicati
  // per ogni etichetta della stampa in blocco.
  const box = (o: Bbox) => ({ left: o.x, bottom: o.y, right: o.x + o.w, top: o.y + o.h })
  const [eLDV, eCAP, eDmG, eDmP] = await out.embedPages([srcPage, srcPage, srcPage, srcPage],
    [box(codici.bcLDV), box(codici.bcCAP), box(codici.dmG), box(codici.dmP)])
  // barcode: dall'orizzontale del 1011 al verticale del layout → ruoto 90° (ancoraggio in basso-dx).
  // Le LARGHEZZE sono quelle MISURATE sull'ufficiale: LDV 70 (barre fino a x89,5), CAP 42,5 (fino a
  // x386,5). Allargarle fa invadere il numero verticale a lato (bug visto il 9/10 su 282224J037233).
  // Le LUNGHEZZE mai sotto quelle della 1011: li' una barra e' 0,25mm, cioe' 2 punti esatti di una
  // termica a 203 dpi. Nel riquadro fisso da 150,7pt l'LDV dei colli 2+ (196,3pt sull'originale)
  // scendeva a 0,19mm, e il CAP (95pt) da 87,1. Il collo 1 (126,1pt) resta a 150,7 come approvato.
  const barcodeVerticale = (e: any, sx: number, sy: number, slotW: number, slotH: number) =>
    page.drawPage(e, { x: sx + slotW, y: sy, width: slotH, height: slotW, rotate: degrees(90) })
  barcodeVerticale(eLDV, 19.5, 20.7, 70.0, Math.max(150.7, codici.bcLDV.w))
  barcodeVerticale(eCAP, 344.0, 25.2, 42.5, Math.max(87.1, codici.bcCAP.w))
  page.drawPage(eDmG, { x: 320.2, y: 208.6, width: 72.7, height: 72.7 })
  page.drawPage(eDmP, { x: 285.7, y: 253.2, width: 28.5, height: 28.5 })

  // testo (coordinate baseline esatte del riferimento). Nel riquadro nero l'instradamento di Poste: il
  // CAP alle coordinate del riferimento, il GIRO (parola piu' larga, meno cifre) centrato nel riquadro.
  const [rqEt, rqVal] = dati.riquadro
  const centra = (t: string) => 18 + (88.5 - bold.widthOfTextAtSize(t, 18.75)) / 2
  T(rqEt === 'CAP' ? 41.7 : centra(rqEt), 261.3, 18.75, bold, rqEt, rgb(1, 1, 1))
  T(rqEt === 'CAP' && rqVal.length === 5 ? 35.4 : centra(rqVal), 241.8, 18.75, bold, rqVal, rgb(1, 1, 1))
  T(109.5, 220.8, 4.80, reg, 'Data:'); T(130.5, 220.8, 4.80, reg, dati.data); T(165.1, 220.8, 4.80, bold, 'Rif. sped.')
  T(108.7, 209.6, 6.60, bold, 'Extra Large')
  T(113.2, 195.3, 6.00, bold, 'Mittente'); T(152.9, 195.3, 6.00, reg, dati.mitt[0])
  fit(113.2, 187.1, 6.00, reg, dati.mitt[1], 223); fit(113.2, 178.1, 6.00, reg, dati.mitt[2], 223); fit(113.2, 169.8, 6.00, reg, dati.mitt[3], 223)
  T(113.2, 154.8, 6.00, bold, 'Destinatario'); T(164.6, 154.8, 6.00, reg, dati.dest[0])
  fit(113.2, 146.6, 6.00, reg, dati.dest[1], 223); fit(113.2, 138.3, 6.00, reg, dati.dest[2], 223); fit(113.2, 129.3, 6.00, reg, dati.dest[3], 223)
  T(113.2, 115.8, 4.20, bold, 'NOTE:'); fit(131, 115.8, 4.20, reg, dati.note, 206)
  T(113.2, 109.1, 4.20, bold, 'CONT:'); fit(131, 109.1, 4.20, reg, dati.contenuto, 206)
  T(113.2, 103.8, 4.20, bold, 'RIF:'); fit(124, 103.8, 4.20, reg, dati.rifOrdine, 213)
  T(137.6, 93.3, 4.80, bold, 'Lettera di vettura'); fit(139.9, 85.8, 4.80, bold, dati.ldv, 72)
  T(214.2, 93.3, 4.80, bold, 'Peso(KG)'); T(220.4, 85.8, 4.80, reg, dati.peso)
  T(263.2, 93.3, 4.80, bold, 'COLLI'); T(269.1, 85.8, 4.80, reg, dati.colli)
  T(303.3, 93.3, 4.80, bold, 'HxLxP(cm)'); T(302.8, 85.8, 6.00, reg, dati.hxlxp)
  T(109.5, 31.1, 4.80, reg, 'Per effetto della consegna della spedizione a Poste Italiane, il mittente accetta le Condizioni Generali di')
  T(109.5, 22.8, 4.80, reg, 'Contratto presenti su www.poste.it')
  page.drawText(dati.ldv, { x: 103.5, y: 69.3, size: 7.5, font: reg, rotate: degrees(90) })
  page.drawText(dati.capCode, { x: 393, y: 53.9, size: 6, font: reg, rotate: degrees(90) })
}

export async function riscriviEtichettaSdaExpressL(buffer: Buffer, dati: DatiEtichettaSda): Promise<Buffer> {
  let docPdfjs: any = null
  try {
    const srcDoc = await PDFDocument.load(new Uint8Array(buffer))
    const N = srcDoc.getPageCount()
    // SOLO la 1011 di Poste (288x315): e' l'unica impaginazione su cui i riquadri sono stati misurati.
    // - Fino all'8/10 Poste mandava un A4 con tre copie per pagina: presi per forma, nel riquadro del CAP
    //   finiva una seconda copia del barcode della LDV (revisione 13/10, 282224J034051).
    // - La NOSTRA resa (420x298,1) riletta e riscritta perdeva tutti i codici a barre (provato il 13/10):
    //   succede se un'etichetta servita viene salvata e poi riletta, come fa la catena della condivisione.
    if (!srcDoc.getPages().every(p => { const { width, height } = p.getSize(); return Math.abs(width - 288) < 1 && Math.abs(height - 315) < 1 })) {
      console.info('[RESA-SDA] originale: pagina non 1011', dati.ldv)
      return buffer
    }
    const { pdfjs, doc } = await caricaPdfjs(buffer); docPdfjs = doc
    const OPS = pdfjs.OPS
    // Prima raccolgo codici + dati di OGNI pagina: se anche una non e' riconosciuta, mollo e torna
    // l'ORIGINALE (mai un multicollo meta' bello e meta' no, ne' un collo senza codici).
    const pagine: Array<{ src: any; codici: any; datiPag: DatiEtichettaSda }> = []
    for (let i = 0; i < N; i++) {
      const pj = await doc.getPage(i + 1)
      const codici = await trovaCodici(pj, OPS)
      if (!codici) { console.info('[RESA-SDA] originale: codici non riconosciuti', dati.ldv, 'pagina', i + 1); return buffer }
      const datiPag = await datiPerCollo(pj, dati, i + 1, N)
      pagine.push({ src: srcDoc.getPage(i), codici, datiPag })
    }
    const out = await PDFDocument.create(); out.registerFontkit(fontkit as any)
    // subset: solo i glifi usati. Interi, i due Liberation Sans aggiungevano ~280KB a ogni etichetta,
    // e nella stampa in blocco ogni etichetta e' un documento a se' (nessuna condivisione tra loro).
    const bold = await out.embedFont(Buffer.from(FONT_BOLD_B64, 'base64'), { subset: true })
    const reg = await out.embedFont(Buffer.from(FONT_REGULAR_B64, 'base64'), { subset: true })
    const logo = await out.embedPng(Buffer.from(LOGO_HEADER_B64, 'base64'))
    for (const pg of pagine) await disegnaPagina(out, pg.src, pg.codici, pg.datiPag, bold, reg, logo)
    return Buffer.from(await out.save())
  } catch (e: any) {
    console.error('[RESA-SDA] originale: errore', dati.ldv, e?.message)
    return buffer // qualunque errore → etichetta originale, mai una rotta
  } finally {
    // pdfjs tiene font e pagine analizzate finche' il documento vive: su un 9 colli ~30MB in piu'.
    try { await docPdfjs?.destroy() } catch {}
  }
}

// Costruisce i dati CONDIVISI del layout dalla riga spedizione (fonte autorevole, pulita). Indirizzi
// MAIUSCOLI come nel riferimento; telefono numerico. LDV, peso, misure, colli e riquadro nero vengono poi
// sovrascritti pagina per pagina da datiPerCollo. Torna null (= resta la 1011) se manca il minimo
// indispensabile o se la spedizione e' in contrassegno.
export async function datiEtichettaSda(admin: any, numero: string | null | undefined): Promise<DatiEtichettaSda | null> {
  if (!numero) return null
  const { data: s } = await admin.from('spedizioni')
    .select('numero,created_at,colli,peso_reale,altezza,larghezza,lunghezza,note,contenuto,rif_ordine,contrassegno,dest_cap,dest_nome,dest_indirizzo,dest_presso,dest_citta,dest_provincia,dest_telefono,mitt_cap,mitt_nome,mitt_indirizzo,mitt_presso,mitt_citta,mitt_provincia,mitt_telefono')
    .eq('numero', numero).maybeSingle()
  if (!s || !String(s.dest_cap || '').trim()) return null
  // CONTRASSEGNO: la 1011 stampa "Extra Large – CONTRASSEGNO", l'importo in cifre e in lettere e il modo
  // di pagamento; il layout pulito quel blocco non ce l'ha (492 spedizioni in 7 giorni, 13/10). Finche'
  // non c'e', il contrassegno resta sulla 1011: il corriere deve leggere che c'e' da incassare.
  if (Number(s.contrassegno || 0) > 0) return null
  const U = (t: any) => String(t || '').toUpperCase()
  // Il c/o l'API v1 lo tiene in *_presso e lo accoda all'indirizzo che arriva a Poste: la 1011 stampa
  // "VIA ... C/O <presso>". Sulle gambe interne e' gia' dentro l'indirizzo: non lo si ripete.
  const conPresso = (via: any, presso: any) => {
    const v = String(via || '').trim(), p = String(presso || '').trim()
    return p && !U(v).includes(U(p)) ? `${v} C/O ${p}` : v
  }
  const ldv = String(s.numero || '').split('-')[0]
  const cap = String(s.dest_cap).trim().slice(0, 5)
  return {
    riquadro: ['CAP', cap],
    capCode: cap + '0000',
    // Il server gira in UTC: senza fuso, tra mezzanotte e le 2 usciva la data del giorno prima.
    data: new Date(s.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }),
    ldv,
    peso: String(s.peso_reale ?? '').replace('.', ','),
    colli: String(s.colli || 1),
    hxlxp: `${s.altezza ?? ''}x${s.larghezza ?? ''}x${s.lunghezza ?? ''}`,
    note: String(s.note || '').trim(),
    contenuto: String(s.contenuto || '').trim(),
    rifOrdine: String(s.rif_ordine || '').trim(),
    mitt: [String(s.mitt_telefono || ''), U(s.mitt_nome), U(conPresso(s.mitt_indirizzo, s.mitt_presso)), `${String(s.mitt_cap || '').trim()} ${U(s.mitt_citta)} (${U(s.mitt_provincia)})`.trim()],
    dest: [String(s.dest_telefono || ''), U(s.dest_nome), U(conPresso(s.dest_indirizzo, s.dest_presso)), `${cap} ${U(s.dest_citta)} (${U(s.dest_provincia)})`.trim()],
  }
}
