import { NextRequest, NextResponse } from 'next/server'
import { utenteDetentore, contrattiDelDetentore } from '@/lib/controllo-fattura-accesso'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { leggiCompensazioneBrt } from '@/lib/compensazione-brt'
import type { SpedizioneMoove } from '@/lib/contrassegni-gestionali'

// LA COMPENSAZIONE CONTRASSEGNI DI BRT (il PDF): se ne leggono le righe e si cercano, per riferimento mittente,
// le spedizioni Moove dei contratti BRT del detentore e delle loro copie (chi gli compra il contratto spedisce
// sullo stesso conto). Solo lettura: il PDF non si salva, e i contrassegni Moove li manda il detentore in
// Distinte contrassegni dalla pagina, con la stessa rotta dei file del corriere.
export async function POST(req: NextRequest) {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const corpo = await req.json().catch(() => ({})) as { pdfBase64?: string }
  const raw = String(corpo.pdfBase64 || '')
  const dati = raw.includes(',') ? raw.split(',').pop()! : raw
  if (!dati) return NextResponse.json({ error: 'Nessun PDF ricevuto.' }, { status: 400 })
  const bytes = Buffer.from(dati, 'base64')
  if (bytes.length > 15 * 1024 * 1024) return NextResponse.json({ error: 'PDF troppo grande.' }, { status: 400 })

  let lettura
  try { lettura = await leggiCompensazioneBrt(new Uint8Array(bytes)) }
  catch (e: any) { return NextResponse.json({ error: 'Non riesco a leggere il PDF: ' + String(e?.message || e) }, { status: 400 }) }
  if (!lettura.righe.length) return NextResponse.json({ error: 'In questo PDF non trovo contrassegni: serve la "Compensazione contrassegni cliente" di BRT.' + (lettura.righeNonLette.length ? ` (${lettura.righeNonLette.length} righe non lette)` : '') }, { status: 400 })

  const admin = createAdminSupabase()
  const contratti = await contrattiDelDetentore(admin, u.masterId)
  const moove: Record<string, SpedizioneMoove> = {}
  if (contratti.length) {
    const { data: copie, error: eCopie } = await admin.from('corrieri').select('id').in('contratto_id', contratti.map((c: any) => c.id))
    if (eCopie) return NextResponse.json({ error: 'Lettura dei contratti non riuscita: ' + eCopie.message }, { status: 500 })
    const corrieriIds = Array.from(new Set([...contratti.map((c: any) => c.id), ...(copie || []).map((c: any) => c.id)]))
    const rif = Array.from(new Set(lettura.righe.map(r => r.rifNumerico).filter(x => /^\d+$/.test(x))))
    // La data stampata è quella della spedizione BRT (il ritiro): in Moove la spedizione è nata quel giorno o
    // prima. Il mese prima basta a non leggere tutto lo storico del contratto.
    const date = lettura.righe.map(r => r.data).sort()
    const dal = new Date(Date.parse(date[0] + 'T00:00:00Z') - 31 * 864e5).toISOString()
    const al = new Date(Date.parse(date[date.length - 1] + 'T00:00:00Z') + 2 * 864e5).toISOString()
    for (let i = 0; i < rif.length; i += 200) {
      const { data, error } = await admin.from('spedizioni')
        .select('numero,contrassegno,stato,stato_contrassegno,rif:raw_response->>numericRef')
        .in('corriere_id', corrieriIds).gte('created_at', dal).lt('created_at', al)
        .in('raw_response->>numericRef', rif.slice(i, i + 200))
      if (error) return NextResponse.json({ error: 'Lettura delle spedizioni non riuscita: ' + error.message }, { status: 500 })
      for (const s of (data || []) as any[]) moove[String(s.rif)] = {
        numero: s.numero, contrassegno: Number(s.contrassegno || 0), stato: s.stato ?? null, statoContrassegno: s.stato_contrassegno ?? null,
      }
    }
  }
  return NextResponse.json({ ...lettura, moove, contrattiBrt: contratti.length })
}
