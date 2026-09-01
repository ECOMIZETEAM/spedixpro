import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

export const dynamic = 'force-dynamic'

// DESTINAZIONI PRINCIPALI (widget home): province IT + paesi mondo, ultimi 30 giorni.
// Lo SCOPE lo decide il SERVER dall'utente, mai il client:
//  - CLIENTE  -> solo le proprie (cliente_id);
//  - AGENTE   -> solo i suoi clienti (clientiAgente, per nome);
//  - MASTER   -> tutta la sua rete (sottoAlberoMasterIds).
// L'aggregazione la fa la funzione DB fn_destinazioni (regge i volumi; EXECUTE revocata da
// anon/authenticated → chiamabile solo dal service_role qui lato server).
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti')
    .select('master_id,cliente_id,ruolo,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id && !utente?.cliente_id) return NextResponse.json({ province: [], paesi: [], totale: 0, nProvince: 0 })

  const admin = createAdminSupabase()
  let p_master_ids: string[] | null = null
  let p_cliente_ids: string[] | null = null
  if (utente?.cliente_id) {
    p_cliente_ids = [utente.cliente_id]
  } else if (isAgente(utente as any)) {
    p_cliente_ids = idClientiPerFiltro(await clientiAgente(admin, utente as any))   // mai vuoto (uuid fittizio)
  } else {
    p_master_ids = await sottoAlberoMasterIds(admin, utente.master_id!)
  }

  const { data, error } = await admin.rpc('fn_destinazioni', { p_master_ids, p_cliente_ids, p_giorni: 30 })
  if (error) return NextResponse.json({ error: 'Lettura destinazioni non riuscita' }, { status: 500 })

  const righe = (data || []) as { tipo: string; chiave: string; n: number }[]
  const prov = righe.filter(r => r.tipo === 'provincia').map(r => ({ sigla: r.chiave, n: Number(r.n) }))
  const paesi = righe.filter(r => r.tipo === 'paese').map(r => ({ code: r.chiave, n: Number(r.n) }))
  const totale = prov.reduce((t, r) => t + r.n, 0)
  const totalePaesi = paesi.reduce((t, r) => t + r.n, 0)
  const pct = (n: number, tot: number) => (tot > 0 ? Math.round((n / tot) * 1000) / 10 : 0)

  return NextResponse.json({
    province: prov.map(r => ({ ...r, perc: pct(r.n, totale) })).sort((a, b) => b.n - a.n),
    paesi: paesi.map(r => ({ ...r, perc: pct(r.n, totalePaesi) })).sort((a, b) => b.n - a.n),
    totale,
    totalePaesi,
    nProvince: prov.length,
    giorni: 30,
  })
}
