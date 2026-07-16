import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Duplica UN corriere (fasce + supplementi + config) da un listino a:
//  - un listino ESISTENTE (targetListinoId), oppure
//  - un NUOVO listino (nuovoNome).
// Se il corriere è già presente nel listino target -> errore "corriere già attivo".
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })

  const { sourceListinoId, corriereId, targetListinoId, nuovoNome, maggiorazione } = await req.json()
  if (!sourceListinoId || !corriereId) return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })
  // Maggiorazione % SOLO sui prezzi peso/zona (fasce), non su supplementi/contrassegno/assicurazione/giacenze
  const magg = Number(maggiorazione) || 0
  const applicaMagg = (p: any) => magg ? Math.round((Number(p || 0) * (1 + magg / 100)) * 100) / 100 : p
  if (!targetListinoId && !(nuovoNome && String(nuovoNome).trim())) {
    return NextResponse.json({ error: 'Scegli un listino esistente o un nome per il nuovo listino' }, { status: 400 })
  }

  const admin = createAdminSupabase()
  // Listino sorgente e corriere devono appartenere al master
  const { data: src } = await admin.from('listini_clienti').select('id,fattore_volume,solo_peso_reale')
    .eq('id', sourceListinoId).eq('master_id', utente.master_id).maybeSingle()
  if (!src) return NextResponse.json({ error: 'Listino di origine non trovato' }, { status: 404 })
  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto')
    .eq('id', corriereId).eq('master_id', utente.master_id).maybeSingle()
  if (!corr) return NextResponse.json({ error: 'Corriere non trovato' }, { status: 404 })

  let targetId = targetListinoId as string | undefined
  let creato = false
  if (nuovoNome && String(nuovoNome).trim()) {
    const { data: nuovo, error: e1 } = await admin.from('listini_clienti').insert({
      master_id: utente.master_id, nome: String(nuovoNome).trim(), attivo: true,
      fattore_volume: src.fattore_volume, solo_peso_reale: src.solo_peso_reale,
    }).select('id').single()
    if (e1 || !nuovo) return NextResponse.json({ error: e1?.message || 'Errore creazione listino' }, { status: 400 })
    targetId = nuovo.id; creato = true
  } else {
    const { data: tgt } = await admin.from('listini_clienti').select('id')
      .eq('id', targetId).eq('master_id', utente.master_id).maybeSingle()
    if (!tgt) return NextResponse.json({ error: 'Listino di destinazione non trovato' }, { status: 404 })
    // Corriere già presente nel listino target?
    const { data: gia } = await admin.from('listini_clienti_corrieri').select('id')
      .eq('listino_id', targetId).eq('corriere_id', corriereId).maybeSingle()
    if (gia) return NextResponse.json({ error: `Corriere "${corr.nome_contratto}" già attivo in questo listino` }, { status: 409 })
  }

  // Config corriere
  const { data: cr } = await admin.from('listini_clienti_corrieri').select('fattore_volume,abilitato')
    .eq('listino_id', sourceListinoId).eq('corriere_id', corriereId).maybeSingle()
  await admin.from('listini_clienti_corrieri').insert({
    listino_id: targetId, corriere_id: corriereId,
    fattore_volume: cr?.fattore_volume ?? null, abilitato: cr?.abilitato ?? true,
  })
  // Fasce del corriere (IDEMPOTENTE: pulisco il target prima, così non si duplica su ri-copia)
  const { data: fasce } = await admin.from('listini_clienti_fasce')
    .select('zona_id,peso_min,peso_max,prezzo,tipo,fuel').eq('listino_id', sourceListinoId).eq('corriere_id', corriereId)
  await admin.from('listini_clienti_fasce').delete().eq('listino_id', targetId).eq('corriere_id', corriereId)
  if (fasce?.length) await admin.from('listini_clienti_fasce').insert(fasce.map((f: any) => ({ ...f, listino_id: targetId, corriere_id: corriereId, prezzo: applicaMagg(f.prezzo) })))
  // Supplementi del corriere (idem)
  const { data: sup } = await admin.from('listini_clienti_supplementi')
    .select('tipo,descrizione,valore,tipo_calcolo,nome').eq('listino_id', sourceListinoId).eq('corriere_id', corriereId)
  await admin.from('listini_clienti_supplementi').delete().eq('listino_id', targetId).eq('corriere_id', corriereId)
  if (sup?.length) await admin.from('listini_clienti_supplementi').insert(sup.map((s: any) => ({ ...s, listino_id: targetId, corriere_id: corriereId })))

  return NextResponse.json({ id: targetId, creato, nome_corriere: corr.nome_contratto })
}
