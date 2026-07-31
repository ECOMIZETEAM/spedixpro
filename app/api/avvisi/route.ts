import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente } from '@/lib/agente'

// AVVISI CHE IL MASTER DEVE PER FORZA LEGGERE.
//
// Restituisce l'avviso ancora da leggere per il master di chi sta guardando, e permette di segnarlo
// come letto. La schermata lo mostra come finestra che si chiude solo premendo "Ho capito": e' il
// solo modo per essere ragionevolmente sicuri che sia arrivato, dopo che l'email puo' finire nello
// spam o essere letta da chi non decide.

// L'avviso in corso. Vale solo per chi paga: al master principale e agli esenti non serve.
const AVVISO_CARTA = 'pagamento-carta-2026-08'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ avviso: null })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) return NextResponse.json({ avviso: null })

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters')
    .select('id,parent_master_id,abbonamento_piano,abbonamento_prezzo,abbonamento_esente,stripe_subscription_id,stripe_stato')
    .eq('id', utente.master_id).maybeSingle()
  if (!m) return NextResponse.json({ avviso: null })

  // Chi non paga il canone non deve vedere niente: il principale e' la piattaforma, gli esenti
  // hanno il piano gratis. E chi ha gia' messo la carta ha gia' fatto quello che chiedevamo.
  const deveVederlo = !!m.parent_master_id && !!m.abbonamento_piano && !m.abbonamento_esente
    && !(m.stripe_subscription_id && m.stripe_stato !== 'canceled')
  if (!deveVederlo) return NextResponse.json({ avviso: null })

  const { data: visto } = await admin.from('avvisi_visti')
    .select('master_id').eq('master_id', m.id).eq('avviso', AVVISO_CARTA).maybeSingle()
  if (visto) return NextResponse.json({ avviso: null })

  return NextResponse.json({ avviso: AVVISO_CARTA, prezzo: Number(m.abbonamento_prezzo || 0), piano: m.abbonamento_piano })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).maybeSingle()
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const { avviso } = await req.json().catch(() => ({} as any))
  if (avviso !== AVVISO_CARTA) return NextResponse.json({ error: 'Avviso sconosciuto' }, { status: 400 })

  await createAdminSupabase().from('avvisi_visti')
    .upsert({ master_id: utente.master_id, avviso: AVVISO_CARTA, visto_da: user.id }, { onConflict: 'master_id,avviso' })
  return NextResponse.json({ success: true })
}
