import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'

export const dynamic = 'force-dynamic'

// Spedizioni di UN destinatario nella sosta "da caricare", PAGINATE (10/pagina): serve alla tendina
// che si apre cliccando un cliente, per selezionare le singole spedizioni da caricare (le altre
// restano in pending). Solo la sosta del MIO master (admin + scope master_id).
//
// ORDINE PER DATA SPEDIZIONE (recenti prima), non per data di sosta: cosi' la UI puo' raggruppare per
// giorno e si vede a colpo d'occhio cosa e' recente e cosa e' vecchio. La sosta di un singolo
// destinatario e' piccola (poche centinaia di righe): la si prende tutta, si ordina per data della
// SPEDIZIONE e si pagina in memoria — piu' semplice e ugualmente veloce di un ordinamento su una
// colonna che la sosta non ha.
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

  const filtra = (qq: any) => {
    qq = qq.eq('master_id', mio)
    if (chiave.startsWith('c:')) return qq.eq('cliente_id', chiave.slice(2))
    if (chiave.startsWith('m:')) return qq.eq('target_master_id', chiave.slice(2))
    if (chiave === 'proprio') return qq.is('cliente_id', null).is('target_master_id', null)  // COD del master stesso
    return null
  }
  if (!filtra(admin.from('cod_da_caricare').select('spedizione_id'))) {
    return NextResponse.json({ totale: 0, righe: [] })
  }

  const tutte = await fetchAll(() => filtra(admin.from('cod_da_caricare').select('spedizione_id,importo')))
  const ids = tutte.map((r: any) => r.spedizione_id).filter(Boolean)
  const info = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data: sp } = await admin.from('spedizioni').select('id,numero,dest_nome,dest_citta,created_at').in('id', ids.slice(i, i + 300))
    for (const s of (sp || [])) info.set((s as any).id, s)
  }

  // Ordino per DATA SPEDIZIONE (recenti prima); a parita' di data, per numero.
  const ordinate = tutte.map((r: any) => {
    const s = info.get(r.spedizione_id) || {}
    return {
      spedizione_id: r.spedizione_id,
      importo: Number(r.importo) || 0,
      numero: s.numero || '—',
      dest_nome: s.dest_nome || '',
      dest_citta: s.dest_citta || '',
      created_at: s.created_at || null,
    }
  }).sort((a: any, b: any) => {
    const d = String(b.created_at || '').localeCompare(String(a.created_at || ''))
    return d !== 0 ? d : String(a.numero).localeCompare(String(b.numero))
  })

  // Id per GIORNO (chiave ISO YYYY-MM-DD) su TUTTO il gruppo: serve alla UI per "seleziona tutte le
  // spedizioni di quel giorno" anche quando il blocco-data sfora piu' pagine.
  const perGiorno: Record<string, string[]> = {}
  for (const r of ordinate) {
    const g = r.created_at ? String(r.created_at).slice(0, 10) : 'senza-data'
    ;(perGiorno[g] ||= []).push(r.spedizione_id)
  }

  const from = (page - 1) * PAGE
  return NextResponse.json({
    totale: ordinate.length,
    page,
    perPage: PAGE,
    righe: ordinate.slice(from, from + PAGE),
    perGiorno,
  })
}
