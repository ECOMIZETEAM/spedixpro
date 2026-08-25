import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Il target ACCETTA una rimessa contrassegni ricevuta dal padre. Accettare la mette SUBITO nell'area
// di sosta VERDE "Contrassegni da caricare" (consolidata per cliente) tramite caricaRimesseInSosta.
// NIENTE più casella "gialla" intermedia da caricare a mano: rimossa il 25/08 perché era un doppio
// percorso della stessa cosa (un eventuale straggler si auto-recupera nel verde da GET da-caricare).
// Qui NON si muove denaro — si consolida. Il master sceglie A CHI e QUANDO far scendere i soldi dal
// verde (POST /api/contrassegni/da-caricare).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  if (!utente?.master_id || utente.ruolo === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const mio = utente.master_id
  const body = await req.json()
  const distintaId = body.distintaId
  if (!distintaId) return NextResponse.json({ error: 'distintaId mancante' }, { status: 400 })

  const admin = createAdminSupabase()

  // La distinta ricevuta deve essere indirizzata al MIO master
  const { data: ricevuta } = await admin.from('distinte_contrassegni')
    .select('id,numero,target_master_id,accettata_target')
    .eq('id', distintaId).maybeSingle()
  if (!ricevuta || ricevuta.target_master_id !== mio) {
    return NextResponse.json({ error: 'Rimessa non trovata o non tua' }, { status: 404 })
  }
  if (ricevuta.accettata_target) {
    return NextResponse.json({ error: 'Rimessa già accettata' }, { status: 400 })
  }

  await admin.from('distinte_contrassegni')
    .update({ accettata_target: true, accettata_target_at: new Date().toISOString() })
    .eq('id', distintaId)

  // SUBITO nella sosta VERDE "Contrassegni da caricare" (consolidata per cliente), come per
  // MULTIEXPRESS ed Ecomize Solution: niente più passaggio intermedio giallo che lasciava le rimesse
  // spezzate per numero invece che unite per cliente (un sotto-master come Ecomize LL le vedeva così).
  // Il master sceglie A CHI e QUANDO far scendere i soldi DAL VERDE, uguale per tutti — qui non si
  // muove denaro, si consolida. Best-effort: se salta, la rimessa resta accettata e la si carica a mano.
  let inAttesa = 0
  try {
    const { caricaRimesseInSosta } = await import('@/lib/cod-rimesse')
    const res = await caricaRimesseInSosta(admin, mio, [distintaId])
    inAttesa = res.inAttesa
  } catch (e: any) { console.error('[COD][ACCETTA] auto-carico in sosta:', e?.message) }

  return NextResponse.json({ success: true, numero: ricevuta.numero, inAttesa })
}
