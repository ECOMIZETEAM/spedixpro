import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// LE FASCE DI PESO DELL'USCITA, cliente per cliente.
//
// "Fino a N kg costa X", come i listini corrieri. Compilare le fasce a un cliente e' il gesto che
// ACCENDE il servizio per lui: senza fasce non paga niente, e il giro degli addebiti non lo guarda
// nemmeno. Svuotarle lo spegne.

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id } : null
}

async function clienteDellaRete(admin: any, masterId: string, clienteId: string) {
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const rete = await sottoAlberoMasterIds(admin, masterId)
  const { data: c } = await admin.from('clienti').select('id,master_id').eq('id', clienteId).maybeSingle()
  return c && rete.includes(c.master_id) ? c : null
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const clienteId = req.nextUrl.searchParams.get('cliente_id') || ''
  if (!clienteId) return NextResponse.json([])
  const admin = createAdminSupabase()
  if (!await clienteDellaRete(admin, s.master_id, clienteId)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { data } = await admin.from('logistica_fasce').select('*').eq('cliente_id', clienteId).order('peso_max')
  return NextResponse.json(data || [])
}

// Si salva l'INTERO listino del cliente in un colpo: e' un elenco corto e cosi' non restano righe
// orfane di una modifica a meta'.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const clienteId = String(b.cliente_id || '')
  const admin = createAdminSupabase()
  const cliente = await clienteDellaRete(admin, s.master_id, clienteId)
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato nella tua rete' }, { status: 403 })

  const righe = (Array.isArray(b.fasce) ? b.fasce : [])
    .map((f: any) => ({ peso: Number(f.peso_max), prezzo: Number(f.prezzo) }))
    .filter((f: any) => isFinite(f.peso) && f.peso > 0 && isFinite(f.prezzo) && f.prezzo >= 0)

  // Due fasce con lo stesso peso non hanno senso e renderebbero il prezzo ambiguo.
  const pesi = new Set(righe.map((f: any) => f.peso))
  if (pesi.size !== righe.length) return NextResponse.json({ error: 'Ci sono due fasce con lo stesso peso' }, { status: 400 })

  await admin.from('logistica_fasce').delete().eq('cliente_id', clienteId)
  if (righe.length) {
    const { error } = await admin.from('logistica_fasce').insert(
      righe.map((f: any) => ({ master_id: cliente.master_id, cliente_id: clienteId, peso_max: f.peso, prezzo: f.prezzo }))
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true, fasce: righe.length, attivo: righe.length > 0 })
}
