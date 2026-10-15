import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json([])
  const dal = req.nextUrl.searchParams.get('dal')
  const al = req.nextUrl.searchParams.get('al')
  let query = supabase.from('distinte_resi')
    .select('*, clienti(ragione_sociale)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al)
  const { data } = await query
  // Numero e destinatario dalla spedizione: le distinte nate dal cron delle 23 nelle voci hanno solo l'id,
  // e nel PDF e nell'Excel le righe uscivano vuote. Si leggono solo spedizioni di questo cliente.
  const lista = data || []
  const ids = [...new Set(lista.flatMap((d: any) => (Array.isArray(d.voci) ? d.voci : []).map((v: any) => v?.id)).filter(Boolean))]
  const spedDi = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: ss } = await supabase.from('spedizioni').select('id,numero,dest_nome')
      .eq('cliente_id', clienteId).in('id', ids.slice(i, i + 300))
    for (const s of (ss || [])) spedDi.set((s as any).id, s)
  }
  for (const d of lista as any[]) {
    if (!Array.isArray(d.voci)) continue
    d.voci = d.voci.map((v: any) => {
      const s = spedDi.get(v?.id)
      return s ? { ...v, numero: v?.numero || s.numero, dest_nome: v?.dest_nome || s.dest_nome } : v
    })
  }
  return NextResponse.json(lista)
}