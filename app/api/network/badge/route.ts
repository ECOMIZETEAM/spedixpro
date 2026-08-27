import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'

// CONTEGGI PER I DUE BADGE DELLA RETE (pollati dalla sidebar come assistenza/logistica).
//  - daAccettare : cosa aspetta una DECISIONE nel "Dal mio network" (rettifiche/contrassegni/resi
//                  ricevuti dal livello di sopra e non ancora accettati). Finché nessuno lo vede,
//                  resta parcheggiato in silenzio: è il motivo per cui centinaia di rettifiche non
//                  arrivavano mai al cliente. Il badge lo rende visibile — la decisione resta al master.
//  - daConfermare: rettifiche MIE ancora in attesa nella "Rettifica Costi" (propagate/caricate ma mai
//                  confermate → il credito del destinatario NON è ancora stato scalato). È il secondo
//                  passo che si lasciava a metà.
// Solo conteggi (head:true) + due somme leggere sul solo insieme del master: nessun dato pesante,
// adatto a un poll ogni 30s. RLS: righe di altri (target=mio le possiede il padre) → si legge via
// admin, autorizzazione = il master della sessione, esattamente come /api/network/ricevuti.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  // Stessa guardia di ricevuti: il ruolo, non l'elenco di quelli da escludere (l'autista ha un master_id).
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.json({ daAccettare: 0, daConfermare: 0 })
  }
  const mio = utente.master_id
  const adminDb = createAdminSupabase()

  // ── DA ACCETTARE (Dal mio network) ──
  // Rettifiche ricevute, confermate dal livello sopra (mi è già stato scalato), ancora da decidere.
  // Escludo quelle che HANNO già una figlia (propagate a metà da un giro interrotto): non sono "da
  // decidere", darebbero "già propagata" — è la stessa esclusione del self-heal di ricevuti.
  const { data: rettPend } = await adminDb.from('rettifiche')
    .select('id,differenza,fuori_sagoma')
    .eq('target_master_id', mio).eq('confermata', true).is('propagazione', null)
  const idsPend = (rettPend || []).map((r: any) => r.id)
  const conFiglia = new Set<string>()
  for (let i = 0; i < idsPend.length; i += 400) {
    const { data } = await adminDb.from('rettifiche').select('origine_rettifica_id').in('origine_rettifica_id', idsPend.slice(i, i + 400))
    for (const f of (data || [])) if ((f as any).origine_rettifica_id) conFiglia.add((f as any).origine_rettifica_id)
  }
  const rettDaAccettare = (rettPend || []).filter((r: any) => !conFiglia.has(r.id))
  const rettAccettareImporto = rettDaAccettare.reduce((a: number, r: any) =>
    a + (Number(r.differenza) < 0 ? -Number(r.differenza) : 0) + (Number(r.fuori_sagoma) || 0), 0)

  // Contrassegni e resi ricevuti e non ancora accettati (stesso posto, stessa decisione).
  const [cod, resi] = await Promise.all([
    adminDb.from('distinte_contrassegni').select('id', { count: 'exact', head: true })
      .eq('target_master_id', mio).not('accettata_target', 'is', true),
    adminDb.from('distinte_resi').select('id', { count: 'exact', head: true })
      .eq('target_master_id', mio).not('accettata_target', 'is', true),
  ])

  // ── DA CONFERMARE (Rettifica Costi) ── rettifiche MIE ancora in attesa: il credito non è sceso.
  const { data: rettDaConf } = await adminDb.from('rettifiche')
    .select('differenza,fuori_sagoma')
    .eq('master_id', mio).eq('confermata', false)
  const confermaImporto = (rettDaConf || []).reduce((a: number, r: any) =>
    a + (Number(r.differenza) < 0 ? -Number(r.differenza) : 0) + (Number(r.fuori_sagoma) || 0), 0)

  const daAccettare = rettDaAccettare.length + (cod.count || 0) + (resi.count || 0)
  return NextResponse.json({
    daAccettare,
    daAccettareRettifiche: rettDaAccettare.length,
    daAccettareImporto: Math.round(rettAccettareImporto * 100) / 100,
    daConfermare: (rettDaConf || []).length,
    daConfermareImporto: Math.round(confermaImporto * 100) / 100,
  })
}
