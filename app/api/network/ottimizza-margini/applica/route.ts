import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { pavimentoContratto, pavimentoPerPeso } from '@/lib/pavimenti'

// APPLICA i consigli di "Ottimizza margini": aggiunge/allinea nel listino del CLIENTE il corriere
// indicato al prezzo P (competitivo), così il cliente lo sceglie e il master guadagna di più.
// Money-safe: verifica SEMPRE lato server (mai fidarsi del payload) proprietà del listino/corriere,
// che il prezzo NON sia sotto costo e NON sotto il pavimento; salva il valore precedente in
// ottimizza_margini_log per l'ANNULLA. Solo master col flag ottimizza_margini.
async function ctx() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _b = bloccaAgente(u as any); if (_b) return { err: _b }
  if (!u?.master_id || !gestisceLaRete(u)) return { err: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('ottimizza_margini').eq('id', u.master_id).maybeSingle()
  if ((m as any)?.ottimizza_margini !== true) return { err: NextResponse.json({ error: 'Funzione non attiva' }, { status: 403 }) }
  return { admin, mio: u.master_id, userId: user.id }
}

export async function POST(req: NextRequest) {
  const c = await ctx(); if ('err' in c) return c.err
  const { admin, mio, userId } = c as any
  const body = await req.json().catch(() => ({}))
  if (body?.undo) return undo(admin, mio, String(body.undo))
  const listinoId = String(body?.listino_id || '')
  const rotte: any[] = Array.isArray(body?.rotte) ? body.rotte : []
  if (!listinoId || !rotte.length) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })

  // Il listino è del master?
  const { data: lc } = await admin.from('listini_clienti').select('id,master_id').eq('id', listinoId).maybeSingle()
  if (!lc || (lc as any).master_id !== mio) return NextResponse.json({ error: 'Listino non tuo' }, { status: 403 })

  // Corrieri del master (nome) per pavimento + verifica proprietà.
  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto').eq('master_id', mio)
  const nomeCorr = new Map<string, string>((corr || []).map((x: any) => [x.id, x.nome_contratto]))
  const { data: zone } = await admin.from('zone').select('id,nome').eq('master_id', mio)
  const nomeZona = new Map<string, string>((zone || []).map((z: any) => [z.id, z.nome]))
  const { data: lcorr } = await admin.from('listini_corrieri').select('id').eq('master_id', mio)
  const costIds = (lcorr || []).map((l: any) => l.id)

  const gruppo = (globalThis as any).crypto?.randomUUID?.() || `${listinoId}-${Date.now()}`
  let applicate = 0
  const errori: string[] = []

  for (const r of rotte) {
    const corriereId = String(r?.corriere_id || ''); const zonaId = r?.zona_id || null
    const pesoMax = Number(r?.peso_max); const prezzo = Number(r?.prezzo)
    const nome = nomeCorr.get(corriereId)
    if (!nome || !corriereId || !zonaId || !(pesoMax > 0) || !(prezzo > 0)) { errori.push('rotta non valida'); continue }

    // COSTO del master per (corriere, zona, banda): il prezzo non può andarci sotto.
    let costo: number | null = null
    if (costIds.length) {
      const { data: kf } = await admin.from('listini_corrieri_fasce').select('prezzo,fuel').in('listino_id', costIds).eq('corriere_id', corriereId).eq('zona_id', zonaId).eq('peso_max', pesoMax).eq('tipo', 'fino_a')
      for (const f of (kf || [])) { const a = Number((f as any).prezzo) * (1 + (Number((f as any).fuel) || 0) / 100); if (costo == null || a < costo) costo = a }
    }
    if (costo != null && prezzo < costo - 0.0001) { errori.push(`${nome}: prezzo sotto costo`); continue }

    // PAVIMENTO: il prezzo non può andare sotto il minimo del contratto (per zona, coi contratti zonati).
    const bande = await pavimentoContratto(admin, nome, nomeZona.get(zonaId) || null)
    const min = pavimentoPerPeso(bande, pesoMax)
    if (min != null && prezzo < min - 0.0001) { errori.push(`${nome}: prezzo sotto pavimento`); continue }

    // Fascia già presente?
    const { data: ex } = await admin.from('listini_clienti_fasce').select('id,prezzo').eq('listino_id', listinoId).eq('corriere_id', corriereId).eq('zona_id', zonaId).eq('peso_max', pesoMax).eq('tipo', 'fino_a').maybeSingle()
    if (ex) {
      if (Number((ex as any).prezzo) <= prezzo + 0.0001) { continue }   // già competitivo o più basso: non tocco
      await admin.from('ottimizza_margini_log').insert({ master_id: mio, listino_id: listinoId, corriere_id: corriereId, zona_id: zonaId, peso_max: pesoMax, prezzo_vecchio: Number((ex as any).prezzo), prezzo_nuovo: prezzo, azione: 'update', gruppo, applicato_da: userId })
      await admin.from('listini_clienti_fasce').update({ prezzo, fuel: 0 }).eq('id', (ex as any).id)
      applicate++
    } else {
      await admin.from('ottimizza_margini_log').insert({ master_id: mio, listino_id: listinoId, corriere_id: corriereId, zona_id: zonaId, peso_max: pesoMax, prezzo_vecchio: null, prezzo_nuovo: prezzo, azione: 'insert', gruppo, applicato_da: userId })
      await admin.from('listini_clienti_fasce').insert({ listino_id: listinoId, corriere_id: corriereId, zona_id: zonaId, peso_max: pesoMax, prezzo, fuel: 0, tipo: 'fino_a' })
      applicate++
    }
  }
  return NextResponse.json({ success: true, applicate, gruppo, errori })
}

async function undo(admin: any, mio: string, gruppo: string) {
  const { data: righe } = await admin.from('ottimizza_margini_log').select('*').eq('gruppo', gruppo).eq('master_id', mio).eq('annullato', false)
  let annullate = 0
  for (const r of (righe || [])) {
    if (r.azione === 'insert') await admin.from('listini_clienti_fasce').delete().eq('listino_id', r.listino_id).eq('corriere_id', r.corriere_id).eq('zona_id', r.zona_id).eq('peso_max', r.peso_max).eq('tipo', 'fino_a')
    else await admin.from('listini_clienti_fasce').update({ prezzo: r.prezzo_vecchio }).eq('listino_id', r.listino_id).eq('corriere_id', r.corriere_id).eq('zona_id', r.zona_id).eq('peso_max', r.peso_max).eq('tipo', 'fino_a')
    await admin.from('ottimizza_margini_log').update({ annullato: true }).eq('id', r.id)
    annullate++
  }
  return NextResponse.json({ success: true, annullate })
}
