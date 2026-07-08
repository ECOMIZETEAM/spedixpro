import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ listino: null, corrieri: [], fasce: [], supplementi: [] })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()

  // Ogni corriere ha la SUA riga listini_corrieri (col suo fattore_volume, solo_peso_reale, fasce).
  const { data: listiniMaster } = await supabase.from('listini_corrieri')
    .select('*').eq('master_id', utente?.master_id)
    .order('created_at', { ascending: true, nullsFirst: true }).order('id', { ascending: true })
  const masterListinoIds = [...new Set((listiniMaster || []).map((l: any) => l.id).filter(Boolean))]
  const _inIds = masterListinoIds.length ? masterListinoIds : ['00000000-0000-0000-0000-000000000000']

  const { searchParams } = new URL(req.url)
  const corriereId = searchParams.get('corriere')

  // Elenco corrieri del listino = UNIONE tra le righe listini_corrieri (fonte primaria, una per
  // corriere) e la vecchia tabella di aggancio (storica/incompleta): così nessun contratto resta nascosto.
  const _mappaCorr = new Map<string, any>()
  for (const l of (listiniMaster || [])) { if (l.corriere_id) _mappaCorr.set(l.corriere_id, null) }
  const { data: corrieriAssegnati } = await supabase.from('listini_corrieri_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto,tipo)')
    .in('listino_id', _inIds)
  for (const r of (corrieriAssegnati || [])) { const c = (r as any).corrieri; if (c) _mappaCorr.set(c.id, c) }
  // completa i nomi dei corrieri presenti solo come riga listino (non nell'aggancio)
  const idsSenzaNome = [..._mappaCorr.entries()].filter(([, v]) => !v).map(([k]) => k)
  if (idsSenzaNome.length) {
    const { data: cc } = await supabase.from('corrieri').select('id,nome_contratto,tipo').in('id', idsSenzaNome)
    for (const c of (cc || [])) _mappaCorr.set(c.id, c)
  }
  const corrieri = [..._mappaCorr.values()].filter(Boolean)

  const { data: tuttiICorrieri } = await supabase.from('corrieri').select('id,nome_contratto').eq('master_id', utente?.master_id)
  const corrieriDisponibili = (tuttiICorrieri||[]).filter(c => !corrieri.some((x:any) => x.id === c.id))

  const corriereSelezionato = corrieri.find((c:any) => c.id === corriereId) || corrieri[0]

  // La riga del corriere selezionato è la fonte del SUO fattore/solo_peso_reale. Se manca, la creo
  // (ereditando il fattore dalla riga più vecchia come default): da qui in poi è per-corriere.
  let listino = (listiniMaster || []).find((l:any) => l.corriere_id === corriereSelezionato?.id) || null
  if (!listino && corriereSelezionato) {
    const base: any = (listiniMaster || [])[0]
    const { data: nuovo } = await supabase.from('listini_corrieri').insert({
      master_id: utente?.master_id, corriere_id: corriereSelezionato.id,
      nome: base?.nome || 'Listino Corrieri',
      fattore_volume: base?.fattore_volume ?? 5000, solo_peso_reale: false, attivo: true,
    }).select().single()
    listino = nuovo
    if (listino?.id && !masterListinoIds.includes(listino.id)) masterListinoIds.push(listino.id)
  }
  if (!listino) {
    // nessun corriere ancora nel listino: placeholder per non rompere il salvataggio
    const { data: nuovo } = await supabase.from('listini_corrieri').insert({
      master_id: utente?.master_id, nome: 'Listino Corrieri',
    }).select().single()
    listino = nuovo
  }

  let fasce: any[] = []
  let supplementi: any[] = []
  if (corriereSelezionato) {
    const { data: f } = await supabase.from('listini_corrieri_fasce')
      .select('*').in('listino_id', masterListinoIds).eq('corriere_id', corriereSelezionato.id).order('peso_max')
    fasce = f || []
    const { data: s } = await supabase.from('listini_corrieri_supplementi')
      .select('*').in('listino_id', masterListinoIds).eq('corriere_id', corriereSelezionato.id)
    supplementi = s || []
  }

  return NextResponse.json({
    listino, corrieri, corrieriDisponibili,
    corriereSelezionatoId: corriereSelezionato?.id || '',
    fasce, supplementi,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const body = await req.json()
  const { listinoId, corriereId, fasce, supplementi, fattore_volume, solo_peso_reale } = body
  if (!listinoId || !corriereId) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })

  await supabase.from('listini_corrieri').update({ fattore_volume, solo_peso_reale: !!solo_peso_reale }).eq('id', listinoId)

  // Cancella le fasce/supplementi di questo corriere in TUTTI i listini del master
  // (potevano essere sparse sotto listino_id diversi): evita duplicati/orfani e le riconsolida.
  const { data: listiniMaster } = await supabase.from('listini_corrieri').select('id').eq('master_id', utente?.master_id)
  const masterListinoIds = [...new Set([...(listiniMaster || []).map((l: any) => l.id), listinoId].filter(Boolean))]
  await supabase.from('listini_corrieri_fasce').delete().in('listino_id', masterListinoIds).eq('corriere_id', corriereId)
  await supabase.from('listini_corrieri_supplementi').delete().in('listino_id', masterListinoIds).eq('corriere_id', corriereId)

  // Reinserisci fasce
  if (fasce?.length) {
    const { error } = await supabase.from('listini_corrieri_fasce').insert(
      fasce.map((f:any) => ({ ...f, listino_id: listinoId, corriere_id: corriereId }))
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Reinserisci supplementi
  const righeSupplementi: any[] = []
  if (supplementi) {
    if (Array.isArray(supplementi.assicurazione)) {
      for (const r of supplementi.assicurazione) {
        if (Number(r.prezzo_fisso) > 0 || Number(r.perc) > 0) {
          righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'assicurazione', valore: Number(r.prezzo_fisso)||0, tipo_calcolo: r.calcolo_su||'totale', descrizione: JSON.stringify(r) })
        }
      }
    }
    if (Array.isArray(supplementi.contrassegno)) {
      for (const r of supplementi.contrassegno) {
        if (Number(r.prezzo_fisso) > 0 || Number(r.perc) > 0) {
          righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'contrassegno', valore: Number(r.prezzo_fisso)||0, tipo_calcolo: r.calcolo_su||'totale', descrizione: JSON.stringify(r) })
        }
      }
    }
    if (Array.isArray(supplementi.servizi)) {
      for (const s of supplementi.servizi) {
        if (Number(s.prezzo) > 0 || Number(s.perc) > 0) {
          righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'accessorio', nome: s.nome, valore: Number(s.prezzo)||0, tipo_calcolo: 'fisso', descrizione: JSON.stringify(s) })
        }
      }
    }
    if (supplementi.giacenze) {
      const { servizi: giacenzeServizi, apertura } = supplementi.giacenze
      if (Array.isArray(giacenzeServizi)) {
        for (const s of giacenzeServizi) {
          if (Number(s.prezzo) > 0 || Number(s.perc) > 0) {
            righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'giacenza', nome: s.nome, valore: Number(s.prezzo)||0, tipo_calcolo: 'fisso', descrizione: JSON.stringify(s) })
          }
        }
      }
      if (Number(apertura) > 0) {
        righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'giacenza_apertura', nome: 'Apertura dossier giacenza', valore: Number(apertura), tipo_calcolo: 'fisso' })
      }
    }
    if (supplementi.ritiro) {
      const { prezzo, perc_nolo } = supplementi.ritiro
      if (Number(prezzo) > 0 || Number(perc_nolo) > 0) {
        righeSupplementi.push({ listino_id: listinoId, corriere_id: corriereId, tipo: 'ritiro', nome: 'Ritiro', valore: Number(prezzo)||0, tipo_calcolo: 'fisso', descrizione: JSON.stringify({perc_nolo}) })
      }
    }
  }
  if (righeSupplementi.length) {
    const { error } = await supabase.from('listini_corrieri_supplementi').insert(righeSupplementi)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}