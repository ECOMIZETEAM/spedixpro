import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data } = await supabase.from('clienti')
    .select('id,ragione_sociale,so_indirizzo,so_citta,so_provincia,so_cap,sl_citta,email,telefono,piva,codice_cliente,attivo,listino_cliente_id,tipo_contratto,credito,listini_clienti(nome)')
    .eq('master_id', utente?.master_id)
    .order('ragione_sociale')
  const clienti = data || []
  const listinoIds = Array.from(new Set(clienti.map((c:any)=>c.listino_cliente_id).filter(Boolean)))
  const clienteIds = clienti.map((c:any)=>c.id)
  let agganci: any[] = []
  let stati: any[] = []
  if (listinoIds.length) {
    const r1 = await supabase.from('listini_clienti_corrieri').select('listino_id, corriere_id, corrieri(id,nome_contratto,tipo)').in('listino_id', listinoIds)
    agganci = r1.data || []
  }
  if (clienteIds.length) {
    const r2 = await supabase.from('clienti_corrieri_abilitati').select('cliente_id, corriere_id, abilitato').in('cliente_id', clienteIds)
    stati = r2.data || []
  }
  const abilMap = new Map(stati.map((s:any)=>[s.cliente_id + '|' + s.corriere_id, s.abilitato]))
  const perListino: any = {}
  for (const a of agganci) {
    if (!a.corrieri) continue
    if (!perListino[a.listino_id]) perListino[a.listino_id] = []
    perListino[a.listino_id].push(a.corrieri)
  }
  const clientiOut = clienti.map((c:any)=>{
    const corr = perListino[c.listino_cliente_id] || []
    const attivi = corr.filter((co:any)=>{
      const k = c.id + '|' + co.id
      return abilMap.has(k) ? abilMap.get(k) : true
    }).map((co:any)=>({ nome_contratto: co.nome_contratto, tipo: co.tipo }))
    return { ...c, contratti_attivi: attivi }
  })
  return NextResponse.json(clientiOut)
}
