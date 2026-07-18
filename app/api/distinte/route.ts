import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const p = req.nextUrl.searchParams
  const dal = p.get('dal')
  const al = p.get('al')
  const ruolo = (utente?.ruolo || '').toLowerCase()

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  // ── Rete: un master vede anche le distinte dei sotto-master (tutta la discendenza),
  //    etichettate con la PROPRIA PRIMA LINEA (il figlio diretto sotto cui discendono). ──
  const mine = utente?.master_id
  let masterIds: string[] = mine ? [mine] : []
  const primaLineaId = new Map<string, string>()   // master discendente -> figlio diretto (prima linea)
  const nomeMaster = new Map<string, string>()      // master id -> nome
  const isMasterRete = ruolo !== 'cliente' && ruolo !== 'agente' && !!mine
  if (isMasterRete) {
    let frontier = [mine as string]
    for (let i = 0; i < 12 && frontier.length; i++) {
      const { data: figli } = await admin.from('masters').select('id,nome,parent_master_id').in('parent_master_id', frontier)
      const nuovi: string[] = []
      for (const c of (figli || [])) {
        if (masterIds.includes((c as any).id)) continue
        nomeMaster.set((c as any).id, (c as any).nome)
        primaLineaId.set((c as any).id, (c as any).parent_master_id === mine ? (c as any).id : (primaLineaId.get((c as any).parent_master_id) || (c as any).id))
        masterIds.push((c as any).id); nuovi.push((c as any).id)
      }
      frontier = nuovi
    }
  }

  // Cross-master richiede admin (RLS). Agente resta confinato al proprio master + suoi clienti.
  const db: any = (isMasterRete && masterIds.length > 1) ? admin : supabase
  let query = db.from('distinte')
    .select('*, clienti(ragione_sociale), corrieri(nome_contratto)')
    .in('master_id', masterIds.length ? masterIds : ['00000000-0000-0000-0000-000000000000'])
    .order('created_at', { ascending: false })
  // Agente: solo le distinte dei suoi clienti.
  if (isAgente(utente)) query = query.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  if (dal) query = query.gte('created_at', dal)
  if (al) query = query.lte('created_at', al + 'T23:59:59')
  const { data } = await query
  const distinte = data || []

  // Etichetta "Cliente" leggibile anche quando cliente_id è NULL:
  //  - distinta di un SOTTO-MASTER (master_rete_id) -> nome del sotto-master;
  //  - distinta multi-cliente / spedizione propria -> ricavo dalle spedizioni (Più clienti / Spedizione propria).
  const reteIds = Array.from(new Set(distinte.filter((d: any) => d.master_rete_id).map((d: any) => d.master_rete_id)))
  const nomeRete = new Map<string, string>()
  if (reteIds.length) {
    const { data: ms } = await admin.from('masters').select('id,nome').in('id', reteIds)
    for (const m of (ms || [])) nomeRete.set((m as any).id, (m as any).nome)
  }
  // Distinte senza cliente e senza rete -> deriva dalle spedizioni
  const daDerivare = distinte.filter((d: any) => !d.cliente_id && !d.master_rete_id).map((d: any) => d.id)
  const clientiPerDistinta = new Map<string, Set<string>>()
  if (daDerivare.length) {
    const { data: sp } = await admin.from('spedizioni').select('distinta_id, clienti(ragione_sociale)').in('distinta_id', daDerivare)
    for (const s of (sp || [])) {
      const did = (s as any).distinta_id
      if (!clientiPerDistinta.has(did)) clientiPerDistinta.set(did, new Set())
      const nome = (s as any).clienti?.ragione_sociale
      if (nome) clientiPerDistinta.get(did)!.add(nome)
    }
  }
  const out = distinte.map((d: any) => {
    let cliente_label = d.clienti?.ragione_sociale || null
    if (!cliente_label && d.master_rete_id) cliente_label = 'Rete: ' + (nomeRete.get(d.master_rete_id) || 'sotto-master')
    if (!cliente_label) {
      const set = clientiPerDistinta.get(d.id)
      if (!set || set.size === 0) cliente_label = 'Spedizione propria'
      else if (set.size === 1) cliente_label = Array.from(set)[0]
      else cliente_label = `Più clienti (${set.size})`
    }
    // Distinta creata da un SOTTO-MASTER della rete: etichetta con la mia prima linea.
    let master_rete: string | null = null
    if (d.master_id && d.master_id !== mine) {
      const flId = primaLineaId.get(d.master_id)
      master_rete = flId ? (nomeMaster.get(flId) || nomeMaster.get(d.master_id) || null) : (nomeMaster.get(d.master_id) || null)
    }
    return { ...d, cliente_label, master_rete }
  })
  return NextResponse.json(out)
}