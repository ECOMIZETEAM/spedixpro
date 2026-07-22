import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { chiudiBorderoSpedisci } from '@/lib/spedisci'
import { chiudiBordereauSpediamopro } from '@/lib/spediamopro'

// Conferma (= trasmetti/ritenta la chiusura al provider) di UNA distinta del cliente loggato.
// Alla creazione la trasmissione parte gia' in automatico: questo serve per quelle rimaste
// "In attesa" per un errore lato provider.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const { distintaId } = await req.json()
  if (!distintaId) return NextResponse.json({ error: 'Distinta mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: d } = await admin.from('distinte')
    .select('id,numero,confermata_vettore,bordero_id')
    .eq('id', distintaId).eq('cliente_id', utente.cliente_id).maybeSingle()
  if (!d) return NextResponse.json({ error: 'Distinta non trovata' }, { status: 404 })
  if (d.confermata_vettore && d.bordero_id && !String(d.bordero_id).startsWith('ERRORE')) {
    return NextResponse.json({ success: true, giaConfermata: true })
  }
  const r1: any = await chiudiBorderoSpedisci(admin, d.id).catch((e: any) => ({ errore: String(e?.message || e) }))
  const r2: any = await chiudiBordereauSpediamopro(admin, d.id).catch((e: any) => ({ errore: String(e?.message || e) }))
  const { data: dopo } = await admin.from('distinte').select('confermata_vettore').eq('id', d.id).maybeSingle()
  if (dopo?.confermata_vettore) return NextResponse.json({ success: true })
  const err = r1?.errore || r2?.errore
  if (err) return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 502 })
  await admin.from('distinte').update({ confermata_vettore: true, data_conferma: new Date().toISOString() }).eq('id', d.id)
  return NextResponse.json({ success: true })
}
