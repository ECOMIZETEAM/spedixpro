import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { nonStaffMaster } from '@/lib/permessi'
import { ledgerGambeInterne } from '@/lib/gambe-visibilita'

// «La giornata» della Plancia nuova (v11): le spedizioni CREATE OGGI ora per ora, e di quelle quante sono ancora fuori
// distinta. Stessa rete e stesso filtro dei contratti di /api/dashboard (sé + sotto-albero, solo i contratti posseduti),
// così il totale torna con «da chiudere in distinta» e con le ultime spedizioni. Legge SOLO le righe di oggi (il
// giorno di Roma), due colonne: dopo il blocco del database del 26/10 niente conteggi su tutta la tabella.
const LIMITE = 20000

function inizioOggiRoma(): Date {
  const ora = new Date()
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(ora).map(x => [x.type, x.value]))
  // quanti minuti Roma è avanti rispetto a UTC adesso (60 d'inverno, 120 d'estate)
  const comeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  const scarto = Math.round((comeUtc - ora.getTime()) / 60000)
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - scarto * 60000)
}
const oraRoma = (iso: string) => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,cliente_id,ruolo').eq('id', user.id).single()
  // come /api/dashboard: la rete del master la legge solo lo staff (l'agente ha la sua plancia, il cliente la sua)
  if (nonStaffMaster(utente) || (utente as any)?.ruolo === 'agente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const masterId = (utente as any)?.master_id
  if (!masterId) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { sottoAlberoMasterIds, contrattiPossedutiNomi } = await import('@/lib/rete-masters')
  const admin = createAdminSupabase()
  const reteIds = await sottoAlberoMasterIds(admin, masterId)
  const ownNomi = await contrattiPossedutiNomi(admin, masterId)
  // UN PACCO CONTA UNA VOLTA: le gambe interne alla rete tolte con la regola unica del database, come la home dal
  // 19/11 (lib/gambe-visibilita.ts). Senza, per MULTIEXPRESS lo stesso pacco contava fino a tre volte.
  const gambe = await ledgerGambeInterne(admin, masterId)
  const da = inizioOggiRoma().toISOString()

  const ore = Array.from({ length: 24 }, (_, h) => ({ ora: h, create: 0, fuoriDistinta: 0 }))
  let lette = 0
  for (let from = 0; from < LIMITE; from += 1000) {
    const q = ownNomi.length
      ? admin.from('spedizioni').select('created_at,distinta_id,stato,corrieri!inner(nome_contratto)').in('corrieri.nome_contratto', ownNomi)
      : admin.from('spedizioni').select('created_at,distinta_id,stato')
    const qq = q.in('master_id', reteIds.length ? reteIds : [masterId]).gte('created_at', da)
    const { data, error } = await (gambe.length ? qq.or(`cliente_id.is.null,cliente_id.not.in.(${gambe.join(',')})`) : qq)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + 999)
    if (error) return NextResponse.json({ error: 'Lettura non riuscita' }, { status: 500 })
    for (const s of (data || []) as any[]) {
      if (s.stato === 'annullata') continue
      const o = ore[oraRoma(s.created_at)]
      o.create++
      if (!s.distinta_id) o.fuoriDistinta++
    }
    lette += data?.length || 0
    if (!data || data.length < 1000) break
  }
  return NextResponse.json({
    da, ore, create: ore.reduce((a, o) => a + o.create, 0), fuoriDistinta: ore.reduce((a, o) => a + o.fuoriDistinta, 0),
    troncata: lette >= LIMITE,
  })
}
