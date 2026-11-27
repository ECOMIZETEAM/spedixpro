import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { accessoProforma } from '@/lib/fatture/proforma-accesso'
import {
  calcolaProforma, motivoPeriodo, emittenteDa, destinatarioDa, aliquotaDi, ivaDi, CAMPI_MASTER, CAMPI_CLIENTE,
} from '@/lib/fatture/proforma'
import { pdfProforma } from '@/lib/fatture/proforma-pdf'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'
import { giornoRoma } from '@/lib/date-roma'

// Il cliente piu' grosso (7.000 movimenti in un mese) fa un PDF di qualche secondo.
export const maxDuration = 60

const cent = (x: number) => Math.round((Number(x) || 0) * 100) / 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// L'elenco delle proforme del master, le piu' recenti prima.
export async function GET(req: NextRequest) {
  const acc = await accessoProforma('admin.invoice.index')
  if (!acc.ok) return acc.risposta
  const admin = createAdminSupabase()
  const cliente = req.nextUrl.searchParams.get('cliente')
  let q = admin.from('fatture_proforma')
    .select('id,cliente_id,anno,numero,dal,al,intestazione,imponibile,aliquota,iva,totale,movimenti,created_at,inviata_a,inviata_il')
    .eq('master_id', acc.masterId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (cliente && UUID.test(cliente)) q = q.eq('cliente_id', cliente)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'Proforme non leggibili: ' + error.message }, { status: 500 })
  return NextResponse.json((data || []).map((r: any) => ({
    id: r.id, cliente_id: r.cliente_id, numero: `${r.numero}/${r.anno}`, dal: r.dal, al: r.al,
    cliente: r.intestazione?.ragione_sociale || '', email: r.intestazione?.email || '',
    imponibile: Number(r.imponibile), aliquota: Number(r.aliquota), iva: Number(r.iva), totale: Number(r.totale),
    movimenti: r.movimenti, created_at: r.created_at, inviata_a: r.inviata_a, inviata_il: r.inviata_il,
  })))
}

// { clienteId, dal, al, aMano, crea }: senza `crea` e' l'anteprima (si calcola e si mostra, non si salva
// niente e non si consuma un numero); con `crea` si numera, si fa il PDF e si salva. `aMano` sono gli id
// delle voci scritte a mano che il master ha spuntato: senza spunta non entrano (lib/fatture/voci.ts).
export async function POST(req: NextRequest) {
  const acc = await accessoProforma('admin.invoice.create')
  if (!acc.ok) return acc.risposta
  const body = await req.json().catch(() => ({}))
  const clienteId = String(body?.clienteId || '')
  const dal = String(body?.dal || '')
  const al = String(body?.al || '')
  if (!UUID.test(clienteId)) return NextResponse.json({ error: 'Scegli il cliente' }, { status: 400 })
  const aMano = Array.isArray(body?.aMano) ? body.aMano.map(String).filter((x: string) => UUID.test(x)).slice(0, 5000) : []
  const motivo = motivoPeriodo(dal, al)
  if (motivo) return NextResponse.json({ error: motivo }, { status: 400 })

  const admin = createAdminSupabase()
  // Il cliente deve essere di chi e' loggato: l'id arriva dal browser.
  const { data: c } = await admin.from('clienti').select(CAMPI_CLIENTE).eq('id', clienteId).eq('master_id', acc.masterId).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })

  // L'aliquota serve anche al calcolo: scorpora le spedizioni vendute IVA inclusa (lib/fatture/voci.ts).
  const aliquota = aliquotaDi(c)
  let calc
  try { calc = await calcolaProforma(admin, acc.masterId, clienteId, dal, al, aMano, aliquota) }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'Calcolo non riuscito' }, { status: 500 }) }
  // L'IVA solo sull'imponibile: le righe esenti (21/11/2026) ne stanno fuori e si sommano al totale.
  const iva = ivaDi(calc.imponibile, aliquota)
  const totale = cent(calc.imponibile + iva + calc.esente)
  const riepilogo = {
    righe: calc.righe, imponibile: calc.imponibile, aliquota, natura: (c as any).natura_iva || null, iva, totale,
    ricariche: calc.ricariche, contrassegni: calc.contrassegni, movimenti: calc.movimenti.length,
    ivaInclusa: calc.ivaInclusa, esente: calc.esente, gia: calc.gia,
  }
  if (!body?.crea) return NextResponse.json({ anteprima: true, ...riepilogo, aMano: calc.aMano })

  if (!calc.movimenti.length) {
    const dove = calc.gia.proforme.map(p => p.numero).join(', ')
    return NextResponse.json({ error: calc.gia.n
      ? `Le spese del periodo sono già nella proforma ${dove}: non c'è niente di nuovo da mettere in proforma`
      : 'Nel periodo il cliente non ha spese: non c\'è niente da mettere in proforma' }, { status: 422 })
  }

  const { data: m, error: eM } = await admin.from('masters').select(CAMPI_MASTER).eq('id', acc.masterId).single()
  if (eM || !m) return NextResponse.json({ error: 'Dati del master non leggibili' }, { status: 500 })
  const emittente = emittenteDa(m)
  const destinatario = destinatarioDa(c)

  const oggi = giornoRoma()
  const anno = Number(oggi.slice(0, 4))
  // Il numero si prende prima del PDF perche' ci va stampato sopra. Se poi il salvataggio non riesce,
  // quel numero resta senza proforma: per un documento senza valore fiscale un buco nella serie non
  // fa danni, una proforma doppia con lo stesso numero si'.
  const { data: numero, error: eN } = await admin.rpc('fatture_prossimo_numero', { p_master: acc.masterId, p_chiave: `proforma:${anno}` })
  if (eN || !Number.isInteger(numero)) return NextResponse.json({ error: 'Numerazione non disponibile: ' + (eN?.message || 'risposta vuota') }, { status: 500 })

  let pdf: Uint8Array
  try {
    pdf = await pdfProforma({
      numero: `${numero}/${anno}`, data: oggi, dal, al, emittente, destinatario,
      righe: calc.righe, imponibile: calc.imponibile, aliquota, natura: riepilogo.natura, iva, totale,
      ricariche: calc.ricariche, contrassegni: calc.contrassegni, movimenti: calc.movimenti, ivaInclusa: calc.ivaInclusa, esente: calc.esente,
    })
  } catch (e: any) { return NextResponse.json({ error: 'PDF non riuscito: ' + (e?.message || '') }, { status: 500 }) }

  const path = `${acc.masterId}/proforma/${anno}/proforma-${numero}-${anno}.pdf`
  const { error: eU } = await admin.storage.from(BUCKET_RISERVATI).upload(path, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false })
  if (eU) return NextResponse.json({ error: 'PDF non salvato: ' + eU.message }, { status: 500 })

  const { data: riga, error: eI } = await admin.from('fatture_proforma').insert({
    master_id: acc.masterId, cliente_id: clienteId, anno, numero, dal, al,
    emittente, intestazione: destinatario, righe: calc.righe,
    imponibile: calc.imponibile, aliquota, natura_iva: riepilogo.natura, iva, totale,
    // iva_inclusa: quanto di questa proforma era venduto IVA inclusa (gia' al netto nelle righe).
    // esente: quanto era venduto esente IVA (righe a parte, dentro il totale, fuori dall'imponibile).
    accrediti: { ricariche: calc.ricariche, contrassegni: calc.contrassegni, ...(calc.ivaInclusa.lordo ? { iva_inclusa: calc.ivaInclusa } : {}), ...(calc.esente ? { esente: calc.esente } : {}) },
    movimenti: calc.movimenti.length, file_path: path, creata_da: acc.userId,
    a_mano_incluse: calc.aMano.filter(v => v.inclusa).map(v => v.id),
  }).select('id').single()
  if (eI || !riga) {
    // Il PDF senza riga non lo ritroverebbe nessuno: si toglie.
    await admin.storage.from(BUCKET_RISERVATI).remove([path])
    return NextResponse.json({ error: 'Proforma non salvata: ' + (eI?.message || '') }, { status: 500 })
  }

  // I movimenti si legano alla proforma, tutti o nessuno: da qui in poi non entrano in un'altra. Il database
  // rifiuta un movimento gia' legato (scripts/fatture-proforma-movimenti.sql). Se non riesce, la proforma
  // appena nata si toglie con il suo PDF: una proforma i cui movimenti restano liberi verrebbe rifatta doppia.
  const { error: eL } = await admin.rpc('fatture_proforma_lega_v1', { p_proforma: riga.id, p_movimenti: calc.legami })
  if (eL) {
    await admin.from('fatture_proforma').delete().eq('id', riga.id).eq('master_id', acc.masterId)
    await admin.storage.from(BUCKET_RISERVATI).remove([path])
    const doppio = eL.code === '23505'
    return NextResponse.json({ error: doppio
      ? 'Nel frattempo una parte di queste spese è finita in un\'altra proforma: ricalcola e riprova'
      : 'Proforma non salvata: ' + eL.message }, { status: doppio ? 409 : 500 })
  }
  return NextResponse.json({ id: riga.id, numero: `${numero}/${anno}`, ...riepilogo })
}
