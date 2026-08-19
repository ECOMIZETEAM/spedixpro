import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { normalizzaMarkup, creaApplicaMarkup } from '@/lib/markup-fasce'

// DUPLICA il COSTO di un contratto (listini_corrieri_fasce/supplementi del master, per UN corriere)
// dentro un LISTINO CLIENTE (nuovo o esistente), applicando una maggiorazione. La maggiorazione può
// essere, PER OGNI FASCIA KG, una PERCENTUALE oppure un VALORE FISSO (flag per fascia); più un
// default globale per le fasce non specificate. Serve a costruire in fretta il prezzo di vendita al
// cliente partendo dal proprio costo. Costo e listino cliente dello STESSO master condividono le zone
// (zone per corriere+master), quindi i zona_id si copiano tali e quali.
//
// La maggiorazione tocca SOLO i prezzi peso/zona (fasce), non i supplementi (contrassegno/assic/…),
// coerente con la duplica corriere dei listini clienti.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const masterId = utente.master_id

  const { corriereId, targetListinoId, nuovoNome, markup, sovrascrivi } = await req.json()
  if (!corriereId) return NextResponse.json({ error: 'corriereId mancante' }, { status: 400 })
  if (!targetListinoId && !(nuovoNome && String(nuovoNome).trim())) {
    return NextResponse.json({ error: 'Scegli un listino cliente esistente o un nome per il nuovo listino' }, { status: 400 })
  }

  // Maggiorazione per fascia (% o valore fisso) + default globale — vedi lib/markup-fasce.
  const applicaMarkup = creaApplicaMarkup(normalizzaMarkup(markup))

  const admin = createAdminSupabase()

  // Il corriere dev'essere del master
  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto')
    .eq('id', corriereId).eq('master_id', masterId).maybeSingle()
  if (!corr) return NextResponse.json({ error: 'Corriere non trovato' }, { status: 404 })

  // SORGENTE = COSTO del master per questo corriere (listini_corrieri del master → sue fasce).
  const { data: listiniCosto } = await admin.from('listini_corrieri').select('id,corriere_id,fattore_volume,solo_peso_reale')
    .eq('master_id', masterId)
  const costoIds = (listiniCosto || []).map((l: any) => l.id)
  if (!costoIds.length) return NextResponse.json({ error: 'Nessun listino costo del master' }, { status: 404 })
  const { data: fasceCosto } = await admin.from('listini_corrieri_fasce')
    .select('zona_id,peso_min,peso_max,prezzo,tipo,fuel').in('listino_id', costoIds).eq('corriere_id', corriereId)
  if (!fasceCosto?.length) return NextResponse.json({ error: `Nessun prezzo di costo per "${corr.nome_contratto}"` }, { status: 400 })
  const { data: suppCosto } = await admin.from('listini_corrieri_supplementi')
    .select('tipo,descrizione,valore,tipo_calcolo,nome').in('listino_id', costoIds).eq('corriere_id', corriereId)
  // fattore/solo_peso_reale del corriere: dalla riga costo di QUEL corriere (1 corriere = 1 riga
  // listini_corrieri); fallback alla prima riga se non trovata.
  const rigaCosto = ((listiniCosto || []).find((l: any) => l.corriere_id === corriereId) || (listiniCosto || [])[0]) as any
  const fattoreCosto = rigaCosto?.fattore_volume ?? null

  // DESTINAZIONE = listino CLIENTE (nuovo o esistente) del master.
  let targetId = targetListinoId as string | undefined
  let creato = false
  let corrierePresente = false
  if (nuovoNome && String(nuovoNome).trim()) {
    const { data: nuovo, error: e1 } = await admin.from('listini_clienti').insert({
      master_id: masterId, nome: String(nuovoNome).trim(), attivo: true,
      fattore_volume: fattoreCosto, solo_peso_reale: rigaCosto?.solo_peso_reale ?? false,
    }).select('id').single()
    if (e1 || !nuovo) return NextResponse.json({ error: e1?.message || 'Errore creazione listino' }, { status: 400 })
    targetId = nuovo.id; creato = true
  } else {
    const { data: tgt } = await admin.from('listini_clienti').select('id')
      .eq('id', targetId).eq('master_id', masterId).maybeSingle()
    if (!tgt) return NextResponse.json({ error: 'Listino cliente di destinazione non trovato' }, { status: 404 })
    const { data: gia } = await admin.from('listini_clienti_corrieri').select('id')
      .eq('listino_id', targetId).eq('corriere_id', corriereId).maybeSingle()
    // sovrascrivi: il corriere e' gia' nel listino e si vogliono RIEMPIRE/riprezzare le celle dal
    // costo con la maggiorazione — non e' un errore, si sovrascrivono fasce e supplementi.
    if (gia) { if (!sovrascrivi) return NextResponse.json({ error: `Il contratto "${corr.nome_contratto}" è già presente in questo listino cliente` }, { status: 409 }); corrierePresente = true }
  }

  // Aggancio corriere al listino cliente (salta se gia' presente in sovrascrittura).
  if (!corrierePresente) await admin.from('listini_clienti_corrieri').insert({
    listino_id: targetId, corriere_id: corriereId, fattore_volume: fattoreCosto, abilitato: true,
  })

  // Fasce con maggiorazione (IDEMPOTENTE: pulisco prima il target per quel corriere).
  await admin.from('listini_clienti_fasce').delete().eq('listino_id', targetId).eq('corriere_id', corriereId)
  await admin.from('listini_clienti_fasce').insert(fasceCosto.map((f: any) => ({
    listino_id: targetId, corriere_id: corriereId, zona_id: f.zona_id,
    peso_min: f.peso_min, peso_max: f.peso_max, tipo: f.tipo, fuel: f.fuel,
    prezzo: applicaMarkup(f.prezzo, f.tipo, f.peso_max),
  })))

  // Supplementi copiati tali e quali (la maggiorazione è solo su peso/zona).
  await admin.from('listini_clienti_supplementi').delete().eq('listino_id', targetId).eq('corriere_id', corriereId)
  if (suppCosto?.length) await admin.from('listini_clienti_supplementi').insert(suppCosto.map((s: any) => ({
    listino_id: targetId, corriere_id: corriereId, tipo: s.tipo, descrizione: s.descrizione, valore: s.valore, tipo_calcolo: s.tipo_calcolo, nome: s.nome,
  })))

  return NextResponse.json({ id: targetId, creato, nome_corriere: corr.nome_contratto })
}
