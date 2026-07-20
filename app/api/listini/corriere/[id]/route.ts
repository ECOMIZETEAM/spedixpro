import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'

export async function POST(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utenteAg } = await supabase.from('utenti').select('ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utenteAg); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  const { id } = await params
  const body = await req.json()
  const { nome, corriere_id, fattore_volume, fasce, supplementi } = body

  await supabase.from('listini_corrieri').update({ nome }).eq('id', id)
  if (corriere_id && fattore_volume !== undefined) {
    const { data: upd } = await supabase.from('listini_corrieri_corrieri')
      .update({ fattore_volume }).eq('listino_id', id).eq('corriere_id', corriere_id).select('listino_id')
    if (!upd?.length) {
      await supabase.from('listini_corrieri_corrieri').insert({ listino_id: id, corriere_id, fattore_volume })
    }
    // COERENZA fattore volume: lo stesso corriere può essere agganciato a PIÙ listini del master
    // (+ la riga "proprio" listini_corrieri) e il motore prezzi legge il link. Se restano disallineati,
    // il peso volumetrico — e quindi il margine — cambia da un livello all'altro della rete. Allineo
    // qui il "proprio" e TUTTI i link del master a questo corriere, così il fattore resta unico.
    const { data: lcRow } = await supabase.from('listini_corrieri').select('master_id').eq('id', id).maybeSingle()
    const masterId = (lcRow as any)?.master_id
    if (masterId) {
      await supabase.from('listini_corrieri').update({ fattore_volume }).eq('master_id', masterId).eq('corriere_id', corriere_id)
      const { data: listiniMaster } = await supabase.from('listini_corrieri').select('id').eq('master_id', masterId)
      const ids = (listiniMaster || []).map((l: any) => l.id)
      if (ids.length) await supabase.from('listini_corrieri_corrieri').update({ fattore_volume }).in('listino_id', ids).eq('corriere_id', corriere_id)
    }
  }

  await supabase.from('listini_corrieri_fasce').delete().eq('listino_id', id).eq('corriere_id', corriere_id)
  await supabase.from('listini_corrieri_supplementi').delete().eq('listino_id', id).eq('corriere_id', corriere_id)

  const nuoveFasce: any[] = []
  for (const fascia of fasce) {
    for (const [zona_id, prezzo] of Object.entries(fascia.prezzi)) {
      if (prezzo && Number(prezzo) > 0) {
        nuoveFasce.push({
          listino_id: id, corriere_id, zona_id,
          peso_min: 0, peso_max: fascia.peso,
          prezzo: Number(prezzo), tipo: fascia.tipo,
        })
      }
    }
  }
  if (nuoveFasce.length) {
    const { error } = await supabase.from('listini_corrieri_fasce').insert(nuoveFasce)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (supplementi) {
    const righeSupplementi: any[] = []
    if (Array.isArray(supplementi.assicurazione)) {
      for (const r of supplementi.assicurazione) {
        if (Number(r.prezzo_fisso) > 0 || Number(r.perc) > 0) {
          righeSupplementi.push({ listino_id: id, corriere_id, tipo: 'assicurazione', valore: Number(r.prezzo_fisso) || 0, tipo_calcolo: r.calcolo_su || 'totale', descrizione: JSON.stringify(r) })
        }
      }
    }
    if (Array.isArray(supplementi.contrassegno)) {
      for (const r of supplementi.contrassegno) {
        if (Number(r.prezzo_fisso) > 0 || Number(r.perc) > 0) {
          righeSupplementi.push({ listino_id: id, corriere_id, tipo: 'contrassegno', valore: Number(r.prezzo_fisso) || 0, tipo_calcolo: r.calcolo_su || 'totale', descrizione: JSON.stringify(r) })
        }
      }
    }
    if (Array.isArray(supplementi.servizi)) {
      for (const s of supplementi.servizi) {
        if (Number(s.prezzo) > 0 || Number(s.perc) > 0) {
          righeSupplementi.push({ listino_id: id, corriere_id, tipo: 'accessorio', nome: s.nome, valore: Number(s.prezzo) || 0, tipo_calcolo: 'fisso', descrizione: JSON.stringify(s) })
        }
      }
    }
    if (supplementi.giacenze) {
      const { servizi: giacenzeServizi, apertura } = supplementi.giacenze
      if (Array.isArray(giacenzeServizi)) {
        for (const s of giacenzeServizi) {
          if (Number(s.prezzo) > 0 || Number(s.perc) > 0) {
            righeSupplementi.push({ listino_id: id, corriere_id, tipo: 'giacenza', nome: s.nome, valore: Number(s.prezzo) || 0, tipo_calcolo: 'fisso', descrizione: JSON.stringify(s) })
          }
        }
      }
      if (Number(apertura) > 0) {
        righeSupplementi.push({ listino_id: id, corriere_id, tipo: 'giacenza_apertura', nome: 'Apertura dossier giacenza', valore: Number(apertura), tipo_calcolo: 'fisso' })
      }
    }
    if (supplementi.ritiro) {
      const { prezzo, perc_nolo } = supplementi.ritiro
      if (Number(prezzo) > 0 || Number(perc_nolo) > 0) {
        righeSupplementi.push({ listino_id: id, corriere_id, tipo: 'ritiro', nome: 'Ritiro', valore: Number(prezzo) || 0, tipo_calcolo: 'fisso', descrizione: JSON.stringify({perc_nolo}) })
      }
    }
    if (righeSupplementi.length) {
      const { error } = await supabase.from('listini_corrieri_supplementi').insert(righeSupplementi)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const corriereId = searchParams.get('corriere')

  const { data: listino } = await supabase.from('listini_corrieri').select('*').eq('id', id).single()
  let fasceQuery = supabase.from('listini_corrieri_fasce').select('*').eq('listino_id', id)
  let supplQuery = supabase.from('listini_corrieri_supplementi').select('*').eq('listino_id', id)
  if (corriereId) {
    fasceQuery = fasceQuery.eq('corriere_id', corriereId)
    supplQuery = supplQuery.eq('corriere_id', corriereId)
  }
  const { data: fasce } = await fasceQuery.order('peso_max')
  const { data: supplementi } = await supplQuery

  let fattoreCorriere = listino?.fattore_volume ?? 5000
  if (corriereId) {
    const { data: agg } = await supabase.from('listini_corrieri_corrieri').select('fattore_volume').eq('listino_id', id).eq('corriere_id', corriereId).maybeSingle()
    if (agg?.fattore_volume != null) fattoreCorriere = agg.fattore_volume
  }

  return NextResponse.json({ listino, fattoreCorriere, fasce: fasce||[], supplementi: supplementi||[] })
}