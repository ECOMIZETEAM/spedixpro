import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ listino: null, corrieri: [], fasce: [], supplementi: [] })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()

  // Trova o crea il listino unico per questo master
  let { data: listino } = await supabase.from('listini_corrieri')
    .select('*').eq('master_id', utente?.master_id).order('created_at').limit(1).single()

  if (!listino) {
    const { data: nuovoListino } = await supabase.from('listini_corrieri').insert({
      master_id: utente?.master_id, nome: 'Listino Corrieri',
    }).select().single()
    listino = nuovoListino
  }

  const { searchParams } = new URL(req.url)
  const corriereId = searchParams.get('corriere')

  const { data: corrieriAssegnati } = await supabase.from('listini_corrieri_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto,tipo)')
    .eq('listino_id', listino?.id)
  const corrieri = (corrieriAssegnati||[]).map((r:any) => r.corrieri).filter(Boolean)

  const { data: tuttiICorrieri } = await supabase.from('corrieri').select('id,nome_contratto').eq('master_id', utente?.master_id)
  const corrieriDisponibili = (tuttiICorrieri||[]).filter(c => !corrieri.some((x:any) => x.id === c.id))

  const corriereSelezionato = corrieri.find((c:any) => c.id === corriereId) || corrieri[0]

  let fasce: any[] = []
  let supplementi: any[] = []
  if (corriereSelezionato) {
    const { data: f } = await supabase.from('listini_corrieri_fasce')
      .select('*').eq('listino_id', listino?.id).eq('corriere_id', corriereSelezionato.id).order('peso_max')
    fasce = f || []
    const { data: s } = await supabase.from('listini_corrieri_supplementi')
      .select('*').eq('listino_id', listino?.id).eq('corriere_id', corriereSelezionato.id)
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
  const body = await req.json()
  const { listinoId, corriereId, fasce, supplementi, fattore_volume } = body
  if (!listinoId || !corriereId) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })

  await supabase.from('listini_corrieri').update({ fattore_volume }).eq('id', listinoId)

  // Cancella SOLO le fasce/supplementi di questo contratto
  await supabase.from('listini_corrieri_fasce').delete().eq('listino_id', listinoId).eq('corriere_id', corriereId)
  await supabase.from('listini_corrieri_supplementi').delete().eq('listino_id', listinoId).eq('corriere_id', corriereId)

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