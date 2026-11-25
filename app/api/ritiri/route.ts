import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
import { perimetroRitiri, applicaPerimetro, corrieriDelPerimetro } from '@/lib/perimetro-ritiri-giacenze'
import { etichettaRitiriSenzaCodice } from '@/lib/ritiro-codice'


// STATO E CODICE DEI RITIRI SPEDIAMOPRO: non si rileggono piu' qui a ogni apertura dell'elenco (40 righe alla
// volta, e col campo sbagliato per BRT). Li rilegge da solo il giro ogni 2 minuti, lib/ritiro-codice.

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  // L'autista lavora solo da /api/autista: qui finiva nel ramo del master e leggeva i ritiri di
  // tutta la rete. Il middleware ferma le sue scritture, non le letture.
  if ((utente?.ruolo || '').toLowerCase() === 'autista') return NextResponse.json([])
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  // "m:<masterId>" = sotto-master agganciato (trattato come cliente): i suoi ritiri
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const codRitiro = p.get('codRitiro')
  const dal = p.get('dal')
  const al = p.get('al')

  // CHI VEDE QUALI RITIRI: la regola sta in lib/perimetro-ritiri-giacenze (la stessa del calendario). Cliente: i
  // propri; agente: quelli dei suoi clienti; staff: la rete visibile, e dei sotto-master solo i ritiri sui contratti
  // che possiedo o rivendo. Il client di servizio solo quando si guarda dentro la rete.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const per = await perimetroRitiri(supabase, admin, utente, masterSel)
  if (per.nessuno) return NextResponse.json([])
  const db: any = per.rete ? admin : supabase

  const build = () => {
    let q = applicaPerimetro(
      db.from('ritiri').select(`*, clienti(ragione_sociale), ${corrieriDelPerimetro(per, 'nome_contratto')}`),
      per,
    )
      // Secondo ordine sull'id: fetchAll legge a pagine, e con lo stesso created_at le righe
      // cambiavano posto fra una pagina e l'altra (doppie o perse).
      .order('created_at', { ascending: false }).order('id', { ascending: false })
    // il cliente guarda solo i suoi: il filtro per cliente dell'elenco vale per agente e staff
    if (clienteId && !per.cliente) q = q.eq('cliente_id', clienteId)
    if (codRitiro) q = q.ilike('cod_ritiro', '%' + codRitiro + '%')
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al + 'T23:59:59')
    return q
  }
  const data = await fetchAll(build)
  await etichettaRitiriSenzaCodice(admin, data)

  // Etichetta col nome del sotto-master per i ritiri della rete (null per i miei).
  let out = data || []
  if (per.rete) {
    const { data: ms } = await admin.from('masters').select('id,nome').in('id', per.masterIds)
    const nomeById = new Map((ms || []).map((m: any) => [m.id, m.nome]))
    out = (data || []).map((r: any) => ({ ...r, master_rete: r.master_id !== utente?.master_id ? (nomeById.get(r.master_id) || null) : null }))
  }
  return NextResponse.json(out)
}

