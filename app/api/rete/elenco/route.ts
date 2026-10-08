import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'
import { sottoAlberoMasterIds, masterVedeReteCompleta } from '@/lib/rete-masters'
import { gestisceLaRete } from '@/lib/ruoli'

// ELENCO PIATTO DI RETE per chi vede l'INTERA rete (root / vede_rete_completa): tutti i master e
// tutti i clienti del proprio sotto-albero, per accedervi (impersona) DIRETTAMENTE senza scalare
// l'albero nodo per nodo — che si inceppa su un livello senza gestione_rete. La navigazione ad
// albero (/dashboard/clienti/master) resta; questa e' la scorciatoia del vertice.
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  // Gate: SOLO chi vede la rete completa (super master / vede_rete_completa / root). Un master a
  // rete privata non deve avere l'elenco piatto dei master e clienti altrui.
  if (!(await masterVedeReteCompleta(admin, utente.master_id)))
    return NextResponse.json({ error: 'Rete completa non abilitata' }, { status: 403 })

  // Perimetro = il PROPRIO sotto-albero (se stesso + discendenti), mai i livelli superiori.
  const ids = await sottoAlberoMasterIds(admin, utente.master_id)

  // Master della rete (pochi): nome, contatti, padre, stato. La mappa nomi copre anche il root,
  // cosi' ogni cliente mostra a quale master appartiene.
  const { data: mastersAll } = await admin
    .from('masters').select('id,nome,email,telefono,parent_master_id,attivo')
    .in('id', ids).order('nome')
  const masterNomi: Record<string, string> = {}
  for (const m of (mastersAll || [])) masterNomi[(m as any).id] = (m as any).nome

  // Clienti della rete: possono superare i 1000 → fetchAll a blocchi (ordine stabile). Esclusi i
  // ledger "(ingrosso)" (non sono clienti veri da impersonare) e i promossi a master (stanno gia'
  // nell'elenco master).
  const clienti = await fetchAll<any>(() => admin
    .from('clienti')
    .select('id,ragione_sociale,email,telefono,codice_cliente,master_id,attivo')
    .in('master_id', ids).eq('ledger', false).is('promosso_a_master_id', null)
    .order('ragione_sociale', { ascending: true }).order('id', { ascending: true }))

  // I master mostrati: tutta la rete TRANNE me stesso (impersonare se stessi non ha senso).
  const masters = (mastersAll || []).filter((m: any) => m.id !== utente.master_id)

  return NextResponse.json({ rootId: utente.master_id, masterNomi, masters, clienti })
}
