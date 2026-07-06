import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { calcolaPrezzoListino } from '@/lib/pricing'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const masterId = utente?.master_id
  const p = req.nextUrl.searchParams
  const clienteId = p.get('clienteId')
  const dal = p.get('dal'); const al = p.get('al')
  const vettore = p.get('vettore')
  if (!clienteId) return NextResponse.json({ righe: [], master: {}, cliente: {} })

  const { data: cliente } = await supabase.from('clienti')
    .select('ragione_sociale,listino_cliente_id').eq('id', clienteId).single()
  const { data: master } = await supabase.from('masters')
    .select('nome,logo_url,indirizzo,cap,citta,provincia,email,email_sede,piva,partita_iva')
    .eq('id', masterId).single()
  const listinoId = cliente?.listino_cliente_id || null

  // Le rettifiche di questo cliente (contengono il peso dichiarato dal corriere)
  const { data: rett } = await supabase.from('rettifiche')
    .select('spedizione_id,numero_spedizione,peso_reale,created_at')
    .eq('master_id', masterId)
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: true })

  const spedIds = Array.from(new Set((rett || []).map((r: any) => r.spedizione_id).filter(Boolean)))
  if (!spedIds.length) return NextResponse.json({ righe: [], master: master || {}, cliente: { ragione_sociale: cliente?.ragione_sociale || '' } })

  // Dati originali delle spedizioni (peso cliente, misure, destinazione, corriere)
  let sq = supabase.from('spedizioni')
    .select('id,numero,peso_reale,peso_volume,lunghezza,larghezza,altezza,dest_provincia,dest_cap,dest_paese,corriere_id,created_at,corrieri(nome_contratto)')
    .in('id', spedIds)
  if (dal) sq = sq.gte('created_at', dal)
  if (al) sq = sq.lte('created_at', al + 'T23:59:59')
  const { data: speds } = await sq
  let spedList = speds || []
  // Filtro vettore: primo termine di nome_contratto (come nella lista spedizioni)
  if (vettore) spedList = spedList.filter((s: any) => String((s.corrieri as any)?.nome_contratto || '').split(' ')[0] === vettore)
  const spedById = new Map<string, any>()
  spedList.forEach((s: any) => spedById.set(s.id, s))

  const righe: any[] = []
  for (const r of (rett || [])) {
    const s = spedById.get(r.spedizione_id)
    if (!s) continue  // fuori periodo / filtro vettore

    const pesoCliente = Number(s.peso_reale || 0)        // peso reale che il cliente ha messo
    const pesoVolume = Number(s.peso_volume || 0)        // volumetrico dichiarato
    const pesoCorriere = Number(r.peso_reale || 0)       // peso dal file del corriere
    const pkgBase = { length: Number(s.lunghezza) || 0, width: Number(s.larghezza) || 0, height: Number(s.altezza) || 0 }

    // Costo iniziale: nolo cliente per il peso originale (SENZA contrassegno/assicurazione)
    // Costo finale: nolo cliente ricalcolato col peso dichiarato dal corriere
    let costoIniziale = 0, costoFinale = 0
    if (listinoId) {
      const base = { listinoId, provincia: s.dest_provincia || '', cap: s.dest_cap || '', paese: s.dest_paese || 'IT', corriereId: s.corriere_id }
      const pIni = await calcolaPrezzoListino(supabase, { ...base, packages: [{ weight: pesoCliente || 1, ...pkgBase }] })
      const pFin = await calcolaPrezzoListino(supabase, { ...base, packages: [{ weight: pesoCorriere || pesoCliente || 1, ...pkgBase }] })
      costoIniziale = pIni?.prezzo || 0
      costoFinale = pFin?.prezzo || 0
    }
    const differenza = costoIniziale - costoFinale

    righe.push({
      numero: s.numero || r.numero_spedizione || '',
      pesoDichiarato: pesoCliente,
      pesoVolDichiarato: pesoVolume,
      pesoReale: pesoCorriere,
      pesoVolReale: pesoVolume,
      costoIniziale, costoFinale, differenza,
    })
  }

  return NextResponse.json({ righe, master: master || {}, cliente: { ragione_sociale: cliente?.ragione_sociale || '' } })
}
