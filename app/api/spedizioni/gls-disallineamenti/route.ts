import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'

// SPEDIZIONI CHE IL PORTALE E GLS RACCONTANO IN MODO DIVERSO, per il master che detiene il contratto
// (le trova il controllo notturno, lib/gls-riconciliazione). Le vede solo lui: Lorenzo 17/11.
// La tabella non e' leggibile dagli utenti: si passa dal client di servizio, filtrando sul SUO master.

async function utenteMaster() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  // Solo chi lavora nel portale del master: non il cliente, non l'agente, non l'autista.
  if (!utente?.master_id || !gestisceLaRete(utente)) return { errore: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  return { user, utente, admin: createAdminSupabase() }
}

export async function GET() {
  const u = await utenteMaster()
  if (u.errore) return u.errore.status === 403 ? NextResponse.json([]) : u.errore
  const { admin, utente } = u
  const { data: righe, error } = await admin.from('gls_disallineamenti')
    .select('spedizione_id,tipo,stato_gls,colli_portale,colli_gls,rilevata_il').eq('master_id', utente.master_id).is('risolta_il', null)
    .order('rilevata_il', { ascending: false }).limit(500)
  if (error) { console.error('[GLS][DISALLINEAMENTI] lettura:', error.message); return NextResponse.json([]) }
  if (!righe?.length) return NextResponse.json([])
  const { data: sped } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,dest_nome,dest_citta,created_at,stato,contrassegno,costo_totale,clienti(ragione_sociale),corrieri(nome_contratto)')
    .in('id', righe.map((r: any) => r.spedizione_id))
  const perId = new Map((sped || []).map((s: any) => [s.id, s]))
  return NextResponse.json(righe.map((r: any) => ({ ...r, spedizione: perId.get(r.spedizione_id) || null })))
}

// "Verificata": il master l'ha guardata e ha deciso lui (rimborso, riaddebito o niente). Sparisce dalla
// sua lista e il controllo notturno non la ripropone.
export async function POST(req: NextRequest) {
  const u = await utenteMaster()
  if (u.errore) return u.errore
  const { admin, utente, user } = u
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })
  const { data, error } = await admin.from('gls_disallineamenti')
    .update({ risolta_il: new Date().toISOString(), risolta_come: 'verificata', risolta_da: user.id })
    .eq('spedizione_id', id).eq('master_id', utente.master_id).is('risolta_il', null)
    .select('spedizione_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data?.length) return NextResponse.json({ error: 'Segnalazione non trovata o già verificata' }, { status: 404 })
  return NextResponse.json({ success: true })
}
