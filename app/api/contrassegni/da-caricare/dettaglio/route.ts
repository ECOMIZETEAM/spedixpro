import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Spedizioni di UN destinatario nella sosta "da caricare", PAGINATE (10/pagina): serve alla tendina
// che si apre cliccando un cliente, per selezionare le singole spedizioni da caricare (le altre
// restano in pending). Solo la sosta del MIO master (admin + scope master_id).
const PAGE = 10

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ totale: 0, righe: [] })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente' || isAgente(utente)) return NextResponse.json({ totale: 0, righe: [] })
  const mio = utente.master_id

  const chiave = (req.nextUrl.searchParams.get('chiave') || '').trim()
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1)
  const admin = createAdminSupabase()

  let q = admin.from('cod_da_caricare').select('spedizione_id,importo', { count: 'exact' }).eq('master_id', mio)
  if (chiave.startsWith('c:')) q = q.eq('cliente_id', chiave.slice(2))
  else if (chiave.startsWith('m:')) q = q.eq('target_master_id', chiave.slice(2))
  else return NextResponse.json({ totale: 0, righe: [] })

  const from = (page - 1) * PAGE
  const { data: righe, count } = await q.order('created_at', { ascending: true }).range(from, from + PAGE - 1)

  const ids = (righe || []).map((r: any) => r.spedizione_id).filter(Boolean)
  const info = new Map<string, any>()
  if (ids.length) {
    const { data: sp } = await admin.from('spedizioni').select('id,numero,dest_nome,dest_citta,created_at').in('id', ids)
    for (const s of (sp || [])) info.set((s as any).id, s)
  }

  return NextResponse.json({
    totale: count || 0,
    page,
    perPage: PAGE,
    righe: (righe || []).map((r: any) => ({
      spedizione_id: r.spedizione_id,
      importo: Number(r.importo) || 0,
      numero: info.get(r.spedizione_id)?.numero || '—',
      dest_nome: info.get(r.spedizione_id)?.dest_nome || '',
      dest_citta: info.get(r.spedizione_id)?.dest_citta || '',
      created_at: info.get(r.spedizione_id)?.created_at || null,
    })),
  })
}
