import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { annotaPuntoPoste, contrattiConFasceATaglia, eTariffaAUnPunto } from '@/lib/tariffe-offerte'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id').eq('id', user.id).single()
  if (utente?.ruolo !== 'cliente' || !utente?.cliente_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const { data: cliente } = await supabase
    .from('clienti').select('listino_cliente_id').eq('id', utente.cliente_id).single()
  if (!cliente?.listino_cliente_id) return NextResponse.json({ corrieri: [] })

  // Niente campo `tipo`: e' il provider tecnico e non deve arrivare al cliente (nessuno lo usava).
  const { data: fasce } = await supabase
    .from('listini_clienti_fasce')
    .select('corrieri(id,nome_contratto,attivo,master_id)')
    .eq('listino_id', cliente.listino_cliente_id)

  // Contratti in pausa: qui non si controllava affatto, quindi un contratto sospeso restava
  // selezionabile dal cliente e la spedizione veniva poi rifiutata alla creazione. Vale anche la
  // pausa messa da un master SOPRA: la sospensione scende per tutta la catena.
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const masterDelContratto = (fasce || []).map((f: any) => f.corrieri?.master_id).find(Boolean) || null
  const sospesiSopra = await contrattiSospesiSopra(masterDelContratto)

  // Corrieri disattivati dal master per questo cliente (default = attivo)
  const { data: abil } = await supabase.from('clienti_corrieri_abilitati')
    .select('corriere_id, abilitato').eq('cliente_id', utente.cliente_id)
  const disattivati = new Set((abil || []).filter((a: any) => a.abilitato === false).map((a: any) => a.corriere_id))

  // Corrieri distinti presenti nel listino, esclusi i disattivati
  const map = new Map<string, { id: string; nome: string; punto: boolean }>()
  for (const f of fasce || []) {
    const c = (f as any).corrieri
    if (!c?.id || map.has(c.id) || disattivati.has(c.id)) continue
    if (c.attivo === false) continue                                    // in pausa dal proprio master
    if (sospesoDallaCatena(c.nome_contratto, sospesiSopra)) continue    // in pausa da un livello sopra
    map.set(c.id, { id: c.id, nome: c.nome_contratto || 'Corriere', punto: false })
  }

  // Flag "punto" (consegna a PuntoPoste/Ufficio Postale/Fermopoint/Locker): questi contratti richiedono
  // di scegliere il punto e NON vanno nell'import di massa. Lo si capisce solo dalle credenziali e
  // dalle impostazioni del contratto, che stanno fuori dal grant del cliente → le legge la
  // service-role e di qui esce SOLO il booleano, mai il provider (vedi CLAUDE.md: i nomi dei
  // fornitori non escono).
  //
  // IL CRITERIO E' QUELLO DELL'ANTEPRIMA DEI PREZZI, le stesse funzioni (lib/tariffe-offerte.ts):
  // annotaPuntoPoste + eTariffaAUnPunto, piu' i contratti con fasce a taglia (i locker che si
  // riconoscono solo dal listino: sulle copie dei sotto-master l'impostazione "locker" e' vuota).
  // Qui c'era un'espressione sua, scritta in linea (vettore e service_id dalle credenziali), che
  // non conosceva i locker: l'InPost Locker restava in tendina. Per tutto il resto le due strade
  // danno lo stesso esito (misurato il 13/10/2026 su tutti i 798 contratti, con l'espressione in
  // linea piu' il locker dichiarato: 147 a un punto per entrambe, zero differenze) — ma erano due
  // copie, e una tendina che propone un contratto che l'anteprima non offre vuol dire "non
  // disponibile con il contratto scelto" su ogni riga e, al clic, un lotto intero segnato in errore.
  const ids = Array.from(map.keys())
  if (ids.length) {
    const admin = createAdminSupabase()
    // Le due letture sono indipendenti: se una fallisce, i flag dell'altra restano.
    try {
      const aTaglia = await contrattiConFasceATaglia(admin, cliente.listino_cliente_id)
      for (const id of aTaglia) { const v = map.get(id); if (v) v.punto = true }
    } catch { /* se il flag non si calcola, meglio mostrarli che nasconderli per errore */ }
    try {
      const lista = ids.map(id => ({ _corriere_id: id }))
      await annotaPuntoPoste(admin, lista)
      for (const x of lista) if (eTariffaAUnPunto(x)) { const v = map.get(x._corriere_id); if (v) v.punto = true }
    } catch { /* se il flag non si calcola, meglio mostrarli che nasconderli per errore */ }
  }

  return NextResponse.json({ corrieri: Array.from(map.values()) })
}
