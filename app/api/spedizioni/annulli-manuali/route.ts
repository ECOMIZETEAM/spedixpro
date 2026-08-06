import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

// Coda annulli MANUALI (Spedisci): le vede SOLO il detentore del contratto
// (annullamento_owner_id = suo master). Le richiede via assistenza WhatsApp e poi conferma.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || (utente.ruolo || '').toLowerCase() === 'cliente') return NextResponse.json([])

  const admin = createAdminSupabase()
  const data = await fetchAll(() => admin.from('spedizioni')
    .select('id,numero,tracking_number,dest_nome,dest_citta,dest_provincia,created_at,annullamento_richiesto_at,corrieri(nome_contratto)')
    .eq('stato', 'annullamento_manuale')
    .eq('annullamento_owner_id', utente.master_id)
    .order('annullamento_richiesto_at', { ascending: true }))

  // SE IL FORNITORE L'HA RIPESATA, IL PACCO HA VIAGGIATO.
  // Una ripesatura e' una misura fatta dal corriere sul collo vero: se c'e', quella spedizione e'
  // partita, e chiedere l'annullo non ha piu' senso. Segnalarlo qui evita di andare a chiederlo
  // all'assistenza per un pacco gia' consegnato — e spiega perche' la sua rettifica resta in attesa.
  const ids = (data || []).map((s: any) => s.id)
  const ripesate = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: mv } = await admin.from('movimenti')
      .select('spedizione_id').eq('tipo', 'rettifica').like('riferimento', 'RIPFORN-%')
      .in('spedizione_id', ids.slice(i, i + 300))
    for (const m of (mv || [])) if ((m as any).spedizione_id) ripesate.add((m as any).spedizione_id)
  }
  return NextResponse.json((data || []).map((s: any) => ({ ...s, ripesata: ripesate.has(s.id) })))
}
