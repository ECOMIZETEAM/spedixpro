import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { ricaricheDaStornare } from '@/lib/ricarica-stornata'

export const dynamic = 'force-dynamic'

// LE ULTIME RICARICHE DI UN CLIENTE O DI UN SOTTO-MASTER, per scegliere quale corregge uno storno (finestra del
// movimento a mano, voce «Storno o correzione» col meno). Solo letture, solo i movimenti scritti dal master di chi
// chiede: e' quel filtro a tenere fuori gli altri, qualunque destinatario arrivi. Gli stessi permessi di
// /api/movimenti/crea: chi muove il credito della rete.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('ruolo, master_id').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const grezzo = String(req.nextUrl.searchParams.get('clienteId') || '')
  const sotto = grezzo.startsWith('m:')
  const id = sotto ? grezzo.slice(2) : grezzo
  if (!UUID.test(id)) return NextResponse.json({ error: 'Destinatario non valido' }, { status: 400 })

  try {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    // Un sotto-master puo' arrivare anche senza il prefisso m: (vedi /api/movimenti/crea): se non e' un cliente
    // di questo master, si prova come sotto-master. Il filtro sul master di chi chiede resta in tutti e due i casi.
    let sottoMasterId: string | undefined = sotto ? id : undefined
    if (!sotto) {
      const { data: cli } = await admin.from('clienti').select('id').eq('id', id).eq('master_id', utente.master_id).maybeSingle()
      if (!cli) sottoMasterId = id
    }
    const ricariche = await ricaricheDaStornare(admin, sottoMasterId ? { masterId: utente.master_id, sottoMasterId } : { masterId: utente.master_id, clienteId: id })
    return NextResponse.json({ ricariche })
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || 'Errore' }, { status: 500 })
  }
}
