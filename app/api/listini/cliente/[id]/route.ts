import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const { nome, corriere_id, fattore_volume, fasce, supplementi, solo_peso_reale } = body

  // Aggiorna nome + flag "solo peso reale" + fattore volume (usato anche per la copia ai sotto-master)
  await supabase.from('listini_clienti').update({ nome, solo_peso_reale: !!solo_peso_reale, ...(fattore_volume !== undefined ? { fattore_volume } : {}) }).eq('id', id)
  // Fattore volume per-corriere: salvato sulla riga di aggancio listino+corriere
  if (corriere_id) {
    await supabase.from('listini_clienti_corrieri').update({ fattore_volume }).eq('listino_id', id).eq('corriere_id', corriere_id)
  }

  // Cancella SOLO le fasce di questo contratto (non tocca gli altri corrieri già configurati)
  await supabase.from('listini_clienti_fasce').delete().eq('listino_id', id).eq('corriere_id', corriere_id)
  await supabase.from('listini_clienti_supplementi').delete().eq('listino_id', id).eq('corriere_id', corriere_id)

  // Reinserisci fasce peso/zona
  const nuoveFasce: any[] = []
  for (const fascia of fasce) {
    for (const [zona_id, prezzo] of Object.entries(fascia.prezzi)) {
      if (prezzo && Number(prezzo) > 0) {
        nuoveFasce.push({
          listino_id: id,
          corriere_id,
          zona_id,
          peso_min: 0,
          peso_max: fascia.peso,
          prezzo: Number(prezzo),
          tipo: fascia.tipo,
        })
      }
    }
  }
  if (nuoveFasce.length) {
    const { error } = await supabase.from('listini_clienti_fasce').insert(nuoveFasce)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Salva supplementi (assicurazione, contrassegno, giacenze, ritiro, servizi accessori, extra)
  if (supplementi) {
    const righeSupplementi: any[] = []

    if (Array.isArray(supplementi.assicurazione)) {
      for (const r of supplementi.assicurazione) {
        if (Number(r.prezzo_fisso) > 0 || Number(r.perc) > 0) {
          righeSupplementi.push({
            listino_id: id, corriere_id, tipo: 'assicurazione',
            valore: Number(r.prezzo_fisso) || 0,
            tipo_calcolo: r.calcolo_su || 'totale',
            descrizione: JSON.stringify(r),
          })
        }
      }
    }
    if (Array.isArray(supplementi.contrassegno)) {
      for (const r of supplementi.contrassegno) {
        if (Number(r.prezzo_fisso) > 0 || Number(r.perc) > 0) {
          righeSupplementi.push({
            listino_id: id, corriere_id, tipo: 'contrassegno',
            valore: Number(r.prezzo_fisso) || 0,
            tipo_calcolo: r.calcolo_su || 'totale',
            descrizione: JSON.stringify(r),
          })
        }
      }
    }
    if (Array.isArray(supplementi.servizi)) {
      for (const s of supplementi.servizi) {
        if (Number(s.prezzo) > 0 || Number(s.perc) > 0) {
          righeSupplementi.push({
            listino_id: id, corriere_id, tipo: 'accessorio',
            nome: s.nome, valore: Number(s.prezzo) || 0,
            tipo_calcolo: 'fisso', descrizione: JSON.stringify(s),
          })
        }
      }
    }
    if (supplementi.giacenze) {
      const { servizi: giacenzeServizi, apertura } = supplementi.giacenze
      if (Array.isArray(giacenzeServizi)) {
        for (const s of giacenzeServizi) {
          if (Number(s.prezzo) > 0 || Number(s.perc) > 0) {
            righeSupplementi.push({
              listino_id: id, corriere_id, tipo: 'giacenza',
              nome: s.nome, valore: Number(s.prezzo) || 0,
              tipo_calcolo: 'fisso', descrizione: JSON.stringify(s),
            })
          }
        }
      }
      if (Number(apertura) > 0) {
        righeSupplementi.push({
          listino_id: id, corriere_id, tipo: 'giacenza_apertura',
          nome: 'Apertura dossier giacenza', valore: Number(apertura),
          tipo_calcolo: 'fisso',
        })
      }
    }
    if (supplementi.ritiro) {
      const { prezzo, perc_nolo } = supplementi.ritiro
      if (Number(prezzo) > 0 || Number(perc_nolo) > 0) {
        righeSupplementi.push({
          listino_id: id, corriere_id, tipo: 'ritiro',
          nome: 'Ritiro', valore: Number(prezzo) || 0,
          tipo_calcolo: 'fisso', descrizione: JSON.stringify({perc_nolo}),
        })
      }
    }
    // Sponda: sopra "soglia_kg" si aggiunge "prezzo_kg" € per ogni kg oltre la soglia (peso fatturato).
    if (supplementi.sponda) {
      const soglia_kg = Number(supplementi.sponda.soglia_kg) || 0
      const prezzo_kg = Number(supplementi.sponda.prezzo_kg) || 0
      if (prezzo_kg > 0 && soglia_kg > 0) {
        righeSupplementi.push({
          listino_id: id, corriere_id, tipo: 'sponda',
          nome: 'Sponda', valore: prezzo_kg,
          tipo_calcolo: 'per_kg', descrizione: JSON.stringify({ soglia_kg }),
        })
      }
    }

    if (righeSupplementi.length) {
      const { error } = await supabase.from('listini_clienti_supplementi').insert(righeSupplementi)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }
  }

  // PROPAGAZIONE A CASCATA: appena salvo, aggiorno il Listino Corrieri dei sotto-master che
  // hanno ereditato questo listino (parent_listino_id) — prezzi, supplementi, peso/volume — e
  // così via lungo tutta la rete sottostante.
  let propagati = 0
  try {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { propagaListinoACascata } = await import('@/lib/copia-listino-submaster')
    const admin = createAdminSupabase()
    propagati = await propagaListinoACascata(admin, id)
  } catch (e) { console.error('Propagazione listino ai sotto-master:', e) }

  return NextResponse.json({ ok: true, propagati })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const corriereId = searchParams.get('corriere')

  const { data: listino } = await supabase.from('listini_clienti').select('*').eq('id', id).single()
  let fasceQuery = supabase.from('listini_clienti_fasce').select('*').eq('listino_id', id)
  let supplQuery = supabase.from('listini_clienti_supplementi').select('*').eq('listino_id', id)
  if (corriereId) {
    fasceQuery = fasceQuery.eq('corriere_id', corriereId)
    supplQuery = supplQuery.eq('corriere_id', corriereId)
  }
  const { data: fasce } = await fasceQuery.order('peso_max')
  const { data: supplementi } = await supplQuery

  // Fattore volume del corriere selezionato (dalla riga di aggancio)
  let fattoreCorriere = listino?.fattore_volume ?? 5000
  if (corriereId) {
    const { data: agg } = await supabase.from('listini_clienti_corrieri').select('fattore_volume').eq('listino_id', id).eq('corriere_id', corriereId).maybeSingle()
    if (agg?.fattore_volume != null) fattoreCorriere = agg.fattore_volume
  }

  return NextResponse.json({ listino, fattoreCorriere, fasce: fasce||[], supplementi: supplementi||[] })
}

// Elimina un listino cliente (con i suoi figli). Bloccato se un cliente lo usa.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{id:string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { id } = await params

  const { count } = await supabase.from('clienti')
    .select('*', { count: 'exact', head: true }).eq('listino_cliente_id', id)
  if ((count || 0) > 0) {
    return NextResponse.json({ error: `Listino usato da ${count} cliente/i: riassegnali a un altro listino prima di eliminarlo.` }, { status: 400 })
  }

  await supabase.from('listini_clienti_fasce').delete().eq('listino_id', id)
  await supabase.from('listini_clienti_supplementi').delete().eq('listino_id', id)
  await supabase.from('listini_clienti_corrieri').delete().eq('listino_id', id)
  const { error } = await supabase.from('listini_clienti').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}