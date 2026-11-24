import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { contrattiDelDetentore, gruppiGls, utenteDetentore } from '@/lib/controllo-fattura-accesso'
import { leggiPdfGls } from '@/lib/fattura-gls-pdf'
import { compattaRigheGls, numeroDocumentoGls, titoloDocumentoGls } from '@/lib/fattura-gls'

// Novanta pagine di PDF lette in memoria: più del minuto standard non serve, ma il margine sì.
export const maxDuration = 120

// IL PDF DI GLS (borderò o allegato della fattura): lo legge il server (lib/fattura-gls-pdf) e torna al
// browser le righe compatte; il browser le converte nel formato del controllo (righeControlloGls) e le
// manda a /api/fatture-corriere/analizza a pacchetti, come quelle di BRT. Il file non si salva. Solo per il
// detentore del contratto.
//
// Torna anche il carburante del LISTINO del contratto: il contratto di Wave dice 3%, e se GLS ne mette di
// più (a ottobre il 12%) la pagina lo dice in alto, con quanto si è pagato in più (Lorenzo, 24/11).
export async function POST(req: NextRequest) {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const admin = createAdminSupabase()
  const corpo = await req.json().catch(() => ({})) as { pdfBase64?: string; contrattoId?: string }
  const gruppo = gruppiGls(await contrattiDelDetentore(admin, u.masterId, ['gls'])).find(g => g.ids.includes(String(corpo.contrattoId || '')))
  if (!gruppo) return NextResponse.json({ error: 'Contratto GLS non tuo: il documento di GLS lo controlla solo chi detiene il contratto.' }, { status: 403 })

  const raw = String(corpo.pdfBase64 || '')
  const dati = raw.includes(',') ? raw.split(',').pop()! : raw
  if (!dati) return NextResponse.json({ error: 'Nessun PDF ricevuto.' }, { status: 400 })
  const bytes = Buffer.from(dati, 'base64')
  if (bytes.length > 20 * 1024 * 1024) return NextResponse.json({ error: 'PDF troppo grande.' }, { status: 400 })

  let lettura
  try { lettura = await leggiPdfGls(new Uint8Array(bytes)) }
  catch (e: any) { return NextResponse.json({ error: 'Non riesco a leggere il PDF: ' + String(e?.message || e) }, { status: 400 }) }
  if (!lettura.righe.length) return NextResponse.json({ error: lettura.errori.join(' ') || 'Nel PDF non ci sono spedizioni.' }, { status: 400 })

  // Il PDF è dello stesso conto? Il codice contratto stampato da GLS contro quello delle credenziali. Un
  // contratto del PDF che in Moove non c'è (il 4724 di Wave, solo arrivi) non è un errore: le sue righe
  // restano "fuori Moove". Se non ce n'è nessuno dei suoi, il PDF è di un altro conto.
  const avvisi: string[] = []
  const codiciPdf = lettura.contratti.map(c => c.codice)
  if (gruppo.codice && !codiciPdf.includes(gruppo.codice)) {
    return NextResponse.json({ error: `Il PDF è del contratto GLS ${codiciPdf.join(', ') || '?'}, il contratto scelto è il ${gruppo.codice} (${gruppo.nomi.join(', ')}). Scegli il contratto giusto.` }, { status: 400 })
  }
  for (const c of lettura.contratti.filter(c => gruppo.codice && c.codice !== gruppo.codice)) {
    avvisi.push(`Nel PDF c'è anche il contratto GLS ${c.codice} (${c.righe} spedizioni), che in Moove non c'è: le sue righe le trovi fra quelle fuori Moove.`)
  }
  // Il contratto di Moove deve tornare coi totali stampati e avere il carburante: se no ci si ferma. Un avviso
  // giallo non basta, perché il controllo andrebbe avanti, finirebbe nello storico e manderebbe pesi alla
  // Rettifica con righe perse o col carburante a zero (ogni riga "listino più alto del vero").
  const nostro = lettura.contratti.filter(c => !gruppo.codice || c.codice === gruppo.codice)
  const bloccanti = nostro.flatMap(c => [
    ...(!c.stampato ? [`contratto ${c.codice}: non trovo i totali stampati da GLS`] : !c.quadra ? [`contratto ${c.codice}: le righe lette (${c.righe}, nolo ${c.nolo.toLocaleString('it-IT')} €) non tornano coi totali stampati (${c.stampato.righe}, nolo ${c.stampato.nolo.toLocaleString('it-IT')} €)`] : []),
    ...(c.carburante == null && c.nolo > 0 ? [`contratto ${c.codice}: non trovo il carburante stampato`] : []),
  ])
  if (bloccanti.length) {
    console.warn('[fattura-gls] PDF non letto per intero', JSON.stringify({ master: u.masterId, bloccanti, errori: lettura.errori }))
    return NextResponse.json({ error: `Non ho letto il PDF per intero (${bloccanti.join('; ')}): i confronti sarebbero sbagliati, quindi mi fermo. Manda il PDF a chi segue Moove.` }, { status: 422 })
  }

  // Il carburante del listino del detentore su questi contratti: quello delle fasce della zona Italia (Wave: 3%
  // su tutte). 0 o vuoto vuol dire "non dichiarato" (c'è chi lo tiene dentro il prezzo), non "0% da contratto":
  // altrimenti tutto il carburante di GLS uscirebbe da contestare. Una lettura che non riesce ferma tutto.
  let carburanteListino: number | null = null
  const { data: listini, error: errL } = await admin.from('listini_corrieri').select('id').eq('master_id', u.masterId)
  if (errL) return NextResponse.json({ error: 'Lettura dei listini non riuscita: ' + errL.message }, { status: 500 })
  const idsListini = (listini || []).map((l: any) => l.id)
  if (idsListini.length) {
    const { data: fasce, error: errFa } = await admin.from('listini_corrieri_fasce').select('fuel,zone(nome)').in('listino_id', idsListini).in('corriere_id', gruppo.ids).limit(5000)
    if (errFa) return NextResponse.json({ error: 'Lettura delle fasce non riuscita: ' + errFa.message }, { status: 500 })
    const conta = (filtro: (z: string) => boolean) => {
      const m = new Map<number, number>()
      for (const f of fasce || []) { const v = Number((f as any).fuel) || 0; if (v > 0 && filtro(String((f as any).zone?.nome || ''))) m.set(v, (m.get(v) || 0) + 1) }
      return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    }
    carburanteListino = conta(z => /^italia$/i.test(z.trim())) ?? conta(z => !/europa|estero|internaz/i.test(z))
  }

  const numero = numeroDocumentoGls(lettura)
  return NextResponse.json({
    numero, titolo: titoloDocumentoGls(lettura),
    tracciato: lettura.tracciato, dal: lettura.dal, al: lettura.al, cliente: lettura.cliente,
    totaleCliente: lettura.totaleCliente,
    contratti: lettura.contratti.map(c => ({ codice: c.codice, righe: c.righe, nolo: c.nolo, carburante: c.carburante, percentuale: c.percentualeCarburante, quadra: c.quadra })),
    carburanteListino, contrattiMoove: gruppo.nomi,
    errori: lettura.errori, avvisi,
    righe: compattaRigheGls(lettura.righe),
  })
}
