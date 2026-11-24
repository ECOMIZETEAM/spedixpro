/* IL PDF DI GLS (borderò settimanale o allegato della fattura), letto riga per riga. I due tracciati e cosa
 * vogliono dire sono in lib/fattura-gls.
 *
 * La pagina è orizzontale: pdfjs dà le coordinate del testo ruotate (la x della pagina sta in transform[5]).
 * Le colonne si trovano per NOME d'intestazione, non per posizione: i due tracciati hanno colonne diverse
 * ("Info arrivo" c'è solo nell'allegato) e le stesse colonne in punti diversi. Il testo si assegna alla
 * colonna che inizia più a sinistra di lui; gli importi, allineati a destra, alla colonna col bordo destro
 * più vicino.
 *
 * Il controllo di lettura sono i totali che GLS stampa per contratto ("Totali Contratto"): le righe lette
 * devono sommare quelli, voce per voce. Sui quattro PDF di Wave (ottobre e novembre 2026) tornano tutti.
 *
 * Solo server: pdfjs legacy, solo testo, come le altre letture (fattura-brt-pdf, compensazione-brt). */
import type { ContrattoGls, DettaglioGls, LetturaGls, RigaGls, TotaliGls } from '@/lib/fattura-gls'

type Pezzo = { x: number; y: number; d: number; s: string }

// "06160" e "6160" sono lo stesso contratto: lo stesso confronto lo fa lib/controllo-fattura-accesso.
export const normalizzaCodice = (c: string) => String(c || '').trim().replace(/^0+(?=\d)/, '')
const numIt = (s: string) => { const n = Number(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const IMPORTO = /^-?\d{1,3}(\.\d{3})*,\d{2}$/
const r2 = (n: number) => Math.round(n * 100) / 100
const isoDa = (s: string) => { const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }

// Colonne di testo (allineate a sinistra) e colonne d'importo (allineate a destra), coi nomi stampati.
const TESTO: [keyof RigaGls | 'pesoR' | 'pesoV', string][] = [
  ['filiale', 'Filiale'], ['tipo', 'Tipo sped.'], ['servizio', 'Servizio'], ['data', 'Data'], ['spedizione', 'Spedizione'],
  ['infoArrivo', 'Info arrivo'], ['bda', 'BDA'], ['destinatario', 'Destinatario'], ['mittente', 'Mittente'], ['localita', 'Località'],
  ['colli', 'Colli'], ['pesoR', 'Peso R.'], ['pesoV', 'Peso Vol.'],
]
const IMPORTI: [keyof TotaliGls, string[]][] = [
  ['nolo', ['Nolo']], ['assicurazione', ['Dir.Assicurativo']], ['contrassegno', ['Dir.C/Assegno']], ['varie', ['Varie']],
  // La stessa colonna, due nomi: "Serv.Agg," nell'allegato, "Sprinter" nel borderò.
  ['servizi', ['Serv.Agg,', 'Serv.Agg.', 'Sprinter']],
]
// Le righe che chiudono l'elenco delle spedizioni: dopo, non c'è più una spedizione da leggere.
const FINE = /^(\d[\d.]*\s+)?Spedizioni$|^Totali\b|^Supp\. Carburante|^Riepilogo|^Elaborato da/

// La pagina ruotata dà x e y scambiate; se un giorno GLS la stampa diritta, si legge lo stesso: vale
// l'orientamento in cui le intestazioni "Filiale", "Spedizione" e "Nolo" stanno sulla stessa riga.
function orienta(items: any[]): Pezzo[] {
  const ruotata = items.map(i => ({ x: i.transform[5], y: i.transform[4], d: i.transform[5] + (i.width || 0), s: String(i.str).trim() }))
  const diritta = items.map(i => ({ x: i.transform[4], y: -i.transform[5], d: i.transform[4] + (i.width || 0), s: String(i.str).trim() }))
  const allineate = (p: Pezzo[]) => {
    const f = p.find(i => i.s === 'Filiale'), s = p.find(i => i.s === 'Spedizione'), n = p.find(i => i.s === 'Nolo')
    return !!f && !!s && !!n && Math.abs(f.y - s.y) < 8 && Math.abs(s.y - n.y) < 8 && f.x < s.x && s.x < n.x
  }
  return allineate(ruotata) || !allineate(diritta) ? ruotata : diritta
}

// Toglie i doppioni: GLS stampa alcune righe due volte (grassetto finto), a 2 punti di distanza. Conta anche
// l'altezza: il dettaglio "Oversize 15,00" sta nella stessa colonna dei 15,00 della riga sopra, 13 punti
// più in basso, ed è un'altra cosa.
const unici = (l: Pezzo[]) => {
  const tenuti: Pezzo[] = []
  for (const i of l) if (!tenuti.some(t => t.s === i.s && Math.abs(t.x - i.x) < 3 && Math.abs(t.y - i.y) < 4)) tenuti.push(i)
  return tenuti
}

export async function leggiPdfGls(bytes: Uint8Array): Promise<LetturaGls> {
  const mod: any = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = mod.getDocument ? mod : (mod.default || mod)
  // isEvalSupported: false chiude la falla di pdfjs-dist 3 (CVE-2024-4367): il PDF arriva da fuori.
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise

  const righe: RigaGls[] = []
  const stampati = new Map<string, TotaliGls>()
  const carburante = new Map<string, number>()
  const riepilogo: Record<string, number> = {}
  const errori: string[] = []
  let cliente: string | null = null, dal: string | null = null, al: string | null = null
  let allegato = false, totaleCliente: number | null = null, contratto = ''
  // Le colonne d'importo dell'ultima intestazione vista: servono anche alle righe dei totali, che sulla
  // pagina del riepilogo possono stare senza intestazione.
  let bordiImporti: [keyof TotaliGls, number][] = []
  let xColli = 0

  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    const it = orienta(((tc.items || []) as any[]).filter(i => String(i.str || '').trim()))
    const riga = (y: number, tolleranza = 3) => unici(it.filter(i => Math.abs(i.y - y) <= tolleranza)).sort((a, b) => a.x - b.x)

    for (const i of it) {
      const per = i.s.match(/dal\s+(\d{2}\/\d{2}\/\d{4})\s+al\s+(\d{2}\/\d{2}\/\d{4})/)
      if (per) { const a = isoDa(per[1]), b = isoDa(per[2]); if (a && (!dal || a < dal)) dal = a; if (b && (!al || b > al)) al = b }
      if (/^Cliente:/.test(i.s) && !cliente) cliente = (i.s.match(/\d{4,}/)?.[0]) || riga(i.y).find(x => x.x > i.x && /^\d{4,}$/.test(x.s))?.s || null
      if (i.s === 'Info arrivo' || /^Serv\.Agg/.test(i.s) || /^Riepilogo servizi fatturati/.test(i.s)) allegato = true
    }
    // Il contratto della pagina: "Contratto: 6160" in un pezzo solo o in due ("Contratto:" e "6160").
    const contrattiPagina = it.filter(i => /^Contratto:?/.test(i.s)).map(i => ({ y: i.y, codice: normalizzaCodice(i.s.match(/\d{3,}/)?.[0] || riga(i.y).find(x => x.x > i.x && /^\d{3,}$/.test(x.s))?.s || '') })).filter(c => c.codice).sort((a, b) => a.y - b.y)
    const contrattoA = (y: number) => { let c = contratto; for (const x of contrattiPagina) if (x.y < y) c = x.codice; return c }

    const hSped = it.find(i => i.s === 'Spedizione' && riga(i.y, 6).some(x => x.s === 'Nolo'))
    if (hSped) {
      const testata = unici(it.filter(i => Math.abs(i.y - hSped.y) <= 6))
      const colonne = TESTO.map(([k, n]) => [k, testata.find(i => i.s === n)?.x] as const).filter(([, x]) => x != null) as [string, number][]
      colonne.sort((a, b) => a[1] - b[1])
      bordiImporti = IMPORTI.map(([k, nomi]) => [k, testata.find(i => nomi.includes(i.s))?.d] as const).filter(([, d]) => d != null) as [keyof TotaliGls, number][]
      const mancanti = IMPORTI.filter(([k]) => !bordiImporti.some(([b]) => b === k)).map(([, n]) => n[0])
      if (mancanti.length) { errori.push(`Pagina ${p}: non trovo le colonne ${mancanti.join(', ')}.`); continue }
      const xPesoV = colonne.find(([k]) => k === 'pesoV')?.[1] ?? Infinity
      xColli = colonne.find(([k]) => k === 'colli')?.[1] ?? 0
      const colonnaTesto = (x: number) => { let c = colonne[0][0]; for (const [k, cx] of colonne) if (x >= cx - 4) c = k; return c }
      const colonnaImporto = (d: number) => { let m = bordiImporti[0][0], best = Infinity; for (const [k, b] of bordiImporti) { const dd = Math.abs(d - b); if (dd < best) { best = dd; m = k } } return m }
      const eImporto = (i: Pezzo) => IMPORTO.test(i.s) && i.x > xPesoV + 30

      const fine = it.filter(i => i.y > hSped.y && FINE.test(i.s)).map(i => i.y).sort((a, b) => a - b)
      const ancore = it.filter(i => i.y > hSped.y + 3 && Math.abs(i.x - hSped.x) < 6 && /^\d{9}$/.test(i.s)).sort((a, b) => a.y - b.y)
      for (let a = 0; a < ancore.length; a++) {
        const y0 = ancore[a].y
        const y1 = Math.min(a + 1 < ancore.length ? ancore[a + 1].y : Infinity, fine.find(y => y > y0 + 3) ?? Infinity)
        const pezzi = unici(it.filter(i => i.y > y0 - 4 && i.y < y1 - 1))
        const campi: Record<string, string[]> = {}
        const importi: Partial<Record<keyof TotaliGls, number>> = {}
        const dettagli: DettaglioGls[] = []
        for (const i of pezzi.filter(i => Math.abs(i.y - y0) <= 4).sort((a, b) => a.x - b.x)) {
          if (eImporto(i)) { const k = colonnaImporto(i.d); importi[k] = (importi[k] || 0) + numIt(i.s) } else (campi[colonnaTesto(i.x)] ||= []).push(i.s)
        }
        // Sotto la riga: il dettaglio delle varie ("Oversize 15,00") o il seguito di un nome lungo.
        const sotto = new Map<number, Pezzo[]>()
        for (const i of pezzi.filter(i => i.y > y0 + 4)) { const k = Math.round(i.y); (sotto.get(k) || sotto.set(k, []).get(k)!).push(i) }
        for (const [, l] of [...sotto.entries()].sort((a, b) => a[0] - b[0])) {
          const soldi = l.filter(eImporto), testi = l.filter(i => !eImporto(i))
          if (soldi.length && testi.length) { dettagli.push({ nome: testi.sort((a, b) => a.x - b.x).map(i => i.s).join(' '), importo: r2(soldi.reduce((s, i) => s + numIt(i.s), 0)) }); continue }
          for (const i of testi) { const k = colonnaTesto(i.x); if (k === 'destinatario' || k === 'mittente' || k === 'localita' || k === 'infoArrivo') (campi[k] ||= []).push(i.s) }
        }
        const t = (k: string) => (campi[k] || []).join(' ').trim()
        const filiale = t('filiale'), spedizione = ancore[a].s
        righe.push({
          contratto: contrattoA(y0), filiale, tipo: t('tipo'), servizio: t('servizio'),
          data: /^\d{4}-\d{2}-\d{2}$/.test(t('data')) ? t('data') : isoDa(t('data')),
          spedizione, tracking: filiale + spedizione, infoArrivo: t('infoArrivo'), bda: t('bda'),
          destinatario: t('destinatario'), mittente: t('mittente'), localita: t('localita'),
          colli: Math.round(numIt(t('colli'))), pesoReale: numIt(t('pesoR')), pesoVolume: numIt(t('pesoV')),
          nolo: r2(importi.nolo || 0), assicurazione: r2(importi.assicurazione || 0), contrassegno: r2(importi.contrassegno || 0),
          varie: r2(importi.varie || 0), servizi: r2(importi.servizi || 0), dettagli,
        })
      }
    }
    // I totali stampati. Ogni etichetta si prende una volta sola (GLS le stampa due volte, sfalsate).
    const visti = new Set<string>()
    const colonnaImportoTot = (d: number) => { let m: keyof TotaliGls = 'nolo', best = Infinity; for (const [k, b] of bordiImporti) { const dd = Math.abs(d - b); if (dd < best) { best = dd; m = k } } return m }
    const leggiTotali = (y: number, etichetta: Pezzo): TotaliGls => {
      const l = riga(y, 4).filter(i => i !== etichetta && !/^Totali/.test(i.s))
      const tot: TotaliGls = { righe: 0, colli: 0, nolo: 0, assicurazione: 0, contrassegno: 0, varie: 0, servizi: 0 }
      for (const i of l) {
        const n = i.s.match(/^(\d[\d.]*)\s+Spedizioni$/)
        if (n) { tot.righe = numIt(n[1]); continue }
        if (/^\d[\d.]*$/.test(i.s)) {
          // "397" e "Spedizioni" in due pezzi: il numero subito a sinistra della parola è il conto.
          if (l.some(x => x.s === 'Spedizioni' && x.x > i.x && x.x - i.x < 40)) tot.righe = numIt(i.s)
          else if (Math.abs(i.x - xColli) < 40) tot.colli = numIt(i.s)
          continue
        }
        if (IMPORTO.test(i.s)) { const k = colonnaImportoTot(i.d); (tot as any)[k] = r2(((tot as any)[k] || 0) + numIt(i.s)) }
      }
      return tot
    }
    // Per contratto, non uno per pagina: due contratti che chiudono sulla stessa pagina hanno due totali.
    for (const i of it.sort((a, b) => a.y - b.y)) {
      const diChi = contrattoA(i.y + 1) || contratto
      if (/^Totali Contratto/.test(i.s) && !visti.has('contratto|' + diChi)) {
        visti.add('contratto|' + diChi)
        const conNumeri = [i.y, i.y - 2, i.y + 2, i.y - 3, i.y + 3].map(y => riga(y, 1)).find(l => l.some(x => IMPORTO.test(x.s)))
        const y = conNumeri?.length ? conNumeri.find(x => IMPORTO.test(x.s))!.y : i.y
        stampati.set(diChi, leggiTotali(y, i))
      }
      if (/^Supp\. Carburante/.test(i.s) && !visti.has('carburante|' + diChi)) {
        visti.add('carburante|' + diChi)
        const v = riga(i.y).find(x => x !== i && IMPORTO.test(x.s))
        if (v) carburante.set(diChi, numIt(v.s))
      }
      if (/^Totali Cliente/.test(i.s) && !visti.has('cliente')) {
        visti.add('cliente')
        const l = [i.y, i.y - 2, i.y + 2, i.y - 3, i.y + 3].map(y => riga(y, 1)).find(x => x.some(z => IMPORTO.test(z.s))) || []
        totaleCliente = r2(l.filter(x => IMPORTO.test(x.s)).reduce((s, x) => s + numIt(x.s), 0))
      }
    }
    if (contrattiPagina.length) contratto = contrattiPagina[contrattiPagina.length - 1].codice
    // Il riepilogo dell'allegato: "NOLI NAZIONALI 2.060,90", "FUEL 247,07", … "Totale (IVA Esclusa) 2.777,47".
    const rp = it.find(i => /^Riepilogo servizi fatturati/.test(i.s))
    if (rp) {
      for (const i of it.filter(x => x.y > rp.y && /^[A-Za-z]/.test(x.s) && !/^_+$/.test(x.s) && !FINE.test(x.s))) {
        const v = riga(i.y).filter(x => x !== i && x.x > i.x && IMPORTO.test(x.s)).sort((a, b) => a.x - b.x)[0]
        if (v && !(i.s.toUpperCase() in riepilogo)) riepilogo[i.s.toUpperCase()] = numIt(v.s)
      }
    }
  }

  if (!righe.length) return { tracciato: allegato ? 'allegato' : 'bordero', cliente, dal, al, contratti: [], righe, totaleCliente, errori: ['Non trovo spedizioni: non sembra un borderò né un allegato di fattura GLS.', ...errori] }

  // L'allegato ha un solo contratto e il carburante nel riepilogo ("FUEL").
  const codici = Array.from(new Set(righe.map(r => r.contratto)))
  if (allegato && riepilogo['FUEL'] != null && codici.length === 1 && !carburante.has(codici[0])) carburante.set(codici[0], riepilogo['FUEL'])
  const totRiep = Object.entries(riepilogo).find(([k]) => /^TOTALE/.test(k))?.[1]
  if (allegato && totRiep != null) totaleCliente = totRiep

  const contratti: ContrattoGls[] = codici.map(codice => {
    const l = righe.filter(r => r.contratto === codice)
    const somma = (k: keyof RigaGls) => r2(l.reduce((s, r) => s + Number(r[k] || 0), 0))
    const t: TotaliGls = { righe: l.length, colli: l.reduce((s, r) => s + r.colli, 0), nolo: somma('nolo'), assicurazione: somma('assicurazione'), contrassegno: somma('contrassegno'), varie: somma('varie'), servizi: somma('servizi') }
    const st = stampati.get(codice) || null
    const quadra = !!st && st.righe === t.righe && Math.abs(st.colli - t.colli) < 0.5
      && (['nolo', 'assicurazione', 'contrassegno', 'varie', 'servizi'] as const).every(k => Math.abs(st[k] - t[k]) < 0.015)
    const fuel = carburante.get(codice) ?? null
    // La percentuale sul nolo STAMPATO da GLS: se una riga si perdesse, sul nolo letto il carburante
    // salirebbe (2,97% → 3,30% con un decimo di righe in meno) e sembrerebbe da contestare.
    const noloBase = st?.nolo || t.nolo
    return { codice, ...t, carburante: fuel, percentualeCarburante: fuel != null && noloBase > 0 ? Math.round(fuel / noloBase * 1e8) / 1e6 : null, stampato: st, quadra }
  })

  // Un contratto coi totali stampati ma senza righe lette: le sue pagine non si sono lette.
  for (const k of stampati.keys()) if (k && !codici.includes(k)) errori.push(`Contratto ${k}: GLS stampa i totali ma non ho letto nessuna spedizione: le sue pagine non si leggono.`)
  const tipiNoti = new Set(['Partenze', 'Arrivo', 'Addebito'])
  const strani = Array.from(new Set(righe.map(r => r.tipo).filter(t => !tipiNoti.has(t))))
  if (strani.length) errori.push(`Tipi di spedizione che non conosco: ${strani.map(t => `"${t || 'vuoto'}"`).join(', ')}. Quelle righe non si confrontano come andate.`)
  if (!al) errori.push('Non trovo il periodo del documento ("dal … al …").')
  for (const c of contratti) {
    if (!c.stampato) errori.push(`Contratto ${c.codice}: non trovo i totali stampati, non posso controllare di aver letto tutte le righe.`)
    else if (!c.quadra) errori.push(`Contratto ${c.codice}: le righe lette non tornano coi totali stampati da GLS (lette ${c.righe} spedizioni per ${c.nolo.toLocaleString('it-IT')} € di nolo, stampate ${c.stampato.righe} per ${c.stampato.nolo.toLocaleString('it-IT')} €). Non usare questi numeri: segnalalo.`)
    if (c.carburante == null && c.nolo > 0) errori.push(`Contratto ${c.codice}: non trovo il carburante stampato.`)
  }
  // Il totale da scalare dal credito: righe + carburante. Deve tornare col "Totali Cliente" (o col totale
  // del riepilogo dell'allegato).
  if (totaleCliente != null) {
    const calcolato = r2(contratti.reduce((s, c) => s + c.nolo + c.assicurazione + c.contrassegno + c.varie + c.servizi + (c.carburante || 0), 0))
    if (Math.abs(calcolato - totaleCliente) > 0.02) errori.push(`Il totale stampato da GLS (${totaleCliente.toLocaleString('it-IT')} €) non torna con le righe lette più il carburante (${calcolato.toLocaleString('it-IT')} €).`)
  }
  return { tracciato: allegato ? 'allegato' : 'bordero', cliente, dal, al, contratti, righe, totaleCliente, errori }
}
