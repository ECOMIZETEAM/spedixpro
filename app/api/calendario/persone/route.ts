import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { gestisceLaRete } from '@/lib/ruoli'

// CHI SI PUÒ INVITARE (fase 2, Lorenzo 25/11): staff, agenti e clienti DELLO STESSO MASTER di chi invita. La lista la
// chiede solo chi può invitare (lo staff: titolare, admin, operatore). Nome, ruolo e ragione sociale, niente email né
// telefoni: per scegliere bastano, e lo staff i suoi clienti li conosce già.
const RUOLI = ['master', 'admin', 'operatore', 'agente', 'cliente']

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!u?.master_id || !gestisceLaRete(u)) return NextResponse.json({ error: 'Gli inviti li manda lo staff del master' }, { status: 403 })
  // il testo cercato entra in un filtro «or» di PostgREST: via virgole, parentesi e asterischi
  const q = String(req.nextUrl.searchParams.get('q') || '').replace(/[,()*%\\"]/g, ' ').trim().slice(0, 60)
  const admin = createAdminSupabase()
  const base = () => admin.from('utenti').select('id,nome,cognome,ruolo,cliente_id,attivo,clienti(ragione_sociale)')
    .eq('master_id', u.master_id).neq('id', user.id).in('ruolo', RUOLI)
  let righe: any[] = []
  if (q) {
    const [perNome, perRagione] = await Promise.all([
      base().or(`nome.ilike.%${q}%,cognome.ilike.%${q}%`).limit(25),
      admin.from('clienti').select('id').eq('master_id', u.master_id).ilike('ragione_sociale', `%${q}%`).limit(25),
    ])
    if (perNome.error) return NextResponse.json({ error: 'Ricerca non riuscita: ' + perNome.error.message }, { status: 500 })
    righe = perNome.data || []
    const idsClienti = (perRagione.data || []).map((c: any) => c.id)
    if (idsClienti.length) {
      const r2 = await base().in('cliente_id', idsClienti).limit(25)
      if (r2.error) return NextResponse.json({ error: 'Ricerca non riuscita: ' + r2.error.message }, { status: 500 })
      righe.push(...(r2.data || []))
    }
  } else {
    // senza testo: lo staff e gli agenti (pochi); i clienti si cercano per nome
    const r = await base().in('ruolo', ['master', 'admin', 'operatore', 'agente']).limit(50)
    if (r.error) return NextResponse.json({ error: 'Lettura non riuscita: ' + r.error.message }, { status: 500 })
    righe = r.data || []
  }
  const visti = new Set<string>()
  const persone = righe.filter((x) => x.attivo !== false && !visti.has(x.id) && visti.add(x.id)).slice(0, 25).map((x) => ({
    id: x.id,
    nome: [x.nome, x.cognome].filter(Boolean).join(' ').trim() || x.clienti?.ragione_sociale || 'Utente',
    ruolo: String(x.ruolo || '').toLowerCase(),
    azienda: x.clienti?.ragione_sociale || null,
  }))
  const ordine: Record<string, number> = { master: 0, admin: 1, operatore: 2, agente: 3, cliente: 4 }
  persone.sort((a, b) => (ordine[a.ruolo] ?? 9) - (ordine[b.ruolo] ?? 9) || a.nome.localeCompare(b.nome))
  return NextResponse.json({ persone })
}
