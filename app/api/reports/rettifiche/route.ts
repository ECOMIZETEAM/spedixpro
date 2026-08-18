import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { calcolaPrezzoListino } from '@/lib/pricing'
import { isAgente, clientiAgente } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const masterId = utente?.master_id
  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')
  const dal = p.get('dal'); const al = p.get('al')
  const vettore = p.get('vettore')
  // "m:<masterId>" = sotto-master agganciato (trattato come cliente)
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  if (!clienteId && !masterSel) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  // Agente: niente rete (sotto-master) e solo un suo cliente.
  if (isAgente(utente)) {
    if (masterSel) return NextResponse.json({ righe: [], master: {}, cliente: {} })
    const miei = await clientiAgente(supabase, utente)
    if (!clienteId || !miei.includes(clienteId)) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  }

  const { data: master } = await supabase.from('masters')
    .select('nome,logo_url,indirizzo,cap,citta,provincia,email,email_sede,piva,partita_iva')
    .eq('id', masterId).single()

  // Sorgente rettifiche + listino da usare per il ricalcolo:
  // - cliente vero: rettifiche.cliente_id, listino del cliente
  // - sotto-master: rettifiche.target_master_id, listino ereditato (masters.parent_listino_id)
  let db: any = supabase
  let listinoId: string | null = null
  let intestazioneCliente = ''
  let rett: any[] = []

  // La rete e' roba da master: l'agente era gia' fermato piu' sopra, il CLIENTE no — e da qui in
  // giu' si passa al client amministrativo, che scavalca la RLS.
  if (masterSel && !vedeLaRete(utente)) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  if (masterSel) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { masterIdsVisibili } = await import('@/lib/rete-masters')
    const adminDb = createAdminSupabase()
    const mieiDiscendenti = masterId ? await masterIdsVisibili(adminDb, masterId) : []
    if (!mieiDiscendenti.includes(masterSel)) {
      return NextResponse.json({ righe: [], master: master || {}, cliente: {} })
    }
    db = adminDb
    const { data: tm } = await adminDb.from('masters').select('nome,parent_listino_id').eq('id', masterSel).single()
    listinoId = tm?.parent_listino_id || null
    intestazioneCliente = tm?.nome || ''
    const { data } = await adminDb.from('rettifiche')
      .select('spedizione_id,numero_spedizione,peso_iniziale,peso_volume_iniziale,peso_reale,peso_volume_reale,costo_iniziale,costo_finale,differenza,created_at')
      .eq('master_id', masterId).eq('target_master_id', masterSel)
      .order('created_at', { ascending: true })
    rett = data || []
  } else {
    const { data: cliente } = await supabase.from('clienti')
      .select('ragione_sociale,listino_cliente_id').eq('id', clienteId).single()
    listinoId = cliente?.listino_cliente_id || null
    intestazioneCliente = cliente?.ragione_sociale || ''
    const { data } = await supabase.from('rettifiche')
      .select('spedizione_id,numero_spedizione,peso_iniziale,peso_volume_iniziale,peso_reale,peso_volume_reale,costo_iniziale,costo_finale,differenza,created_at')
      .eq('master_id', masterId).eq('cliente_id', clienteId)
      .order('created_at', { ascending: true })
    rett = data || []
  }

  const spedIds = Array.from(new Set(rett.map((r: any) => r.spedizione_id).filter(Boolean)))
  if (!spedIds.length) return NextResponse.json({ righe: [], master: master || {}, cliente: { ragione_sociale: intestazioneCliente } })

  // Dati originali delle spedizioni (peso cliente, misure, destinazione, corriere)
  let sq = db.from('spedizioni')
    .select('id,numero,peso_reale,peso_volume,lunghezza,larghezza,altezza,dest_provincia,dest_cap,dest_paese,dest_citta,corriere_id,created_at,corrieri(nome_contratto)')
    .in('id', spedIds)
  if (dal) sq = sq.gte('created_at', dal)
  if (al) sq = sq.lte('created_at', al + 'T23:59:59')
  const { data: speds } = await sq
  let spedList = speds || []
  if (vettore) spedList = spedList.filter((s: any) => String((s.corrieri as any)?.nome_contratto || '').split(' ')[0] === vettore)
  const spedById = new Map<string, any>()
  spedList.forEach((s: any) => spedById.set(s.id, s))

  const righe: any[] = []
  for (const r of rett) {
    const s = spedById.get(r.spedizione_id)
    if (!s) continue   // fuori dal filtro data/vettore

    // I pesi e i costi si prendono DALLA RETTIFICA, non si ricalcolano dalle misure ORIGINALI della
    // spedizione: la rettifica li ha già calcolati sul VOLUME RIPESATO (peso_volume_reale). Prima il
    // report mostrava il peso reale ripesato ma, come "peso/volume reale", il volume ORIGINARIO della
    // spedizione — così un pacco leggero ma ingombrante (2 kg reali, 30 kg volumetrici) usciva coi kg
    // sbagliati, e il conguaglio ricalcolato non combaciava con quello davvero addebitato.
    const pesoReale = Number(r.peso_reale || 0)
    const pesoVolReale = Number(r.peso_volume_reale || 0)
    const costoIniziale = Number(r.costo_iniziale || 0)
    const costoFinale = Number(r.costo_finale || 0)

    righe.push({
      numero: s.numero || r.numero_spedizione || '',
      pesoDichiarato: Number(r.peso_iniziale || 0),
      pesoVolDichiarato: Number(r.peso_volume_iniziale || 0),
      pesoReale,
      pesoVolReale,
      // Il peso su cui si rettifica è il MAGGIORE fra reale e volumetrico ripesato (il volume vince
      // quando il pacco è leggero ma voluminoso): è questo il kg che "conta" nella rettifica.
      pesoFatturato: Math.max(pesoReale, pesoVolReale),
      volumeVince: pesoVolReale > pesoReale,
      costoIniziale, costoFinale,
      differenza: costoIniziale - costoFinale,
    })
  }

  return NextResponse.json({ righe, master: master || {}, cliente: { ragione_sociale: intestazioneCliente } })
}
