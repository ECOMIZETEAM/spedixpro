import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimentoMaster } from '@/lib/movimenti'
import { PIANI_ENTERPRISE, pianoById, meseCorrente } from '@/lib/piani'

// Stato abbonamento del master + piani disponibili
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters')
    .select('parent_master_id,abbonamento_piano,abbonamento_limite,abbonamento_prezzo,abbonamento_mese,abbonamento_attivato_il,credito')
    .eq('id', utente.master_id).single()

  const isRoot = !m?.parent_master_id  // il master principale: illimitato e gratis, mai bloccato

  const now = new Date()
  const inizioMese = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  // Il piano conta le spedizioni di TUTTA la rete sotto questo master (sé + discendenza):
  // ogni spedizione di un sotto-master consuma il contratto/piano dei master sopra.
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const reteIds = await sottoAlberoMasterIds(admin, utente.master_id)
  const { count } = await admin.from('spedizioni')
    .select('*', { count: 'exact', head: true })
    .in('master_id', reteIds).gte('created_at', inizioMese).neq('stato', 'annullata')

  // Se sono il ROOT (M1): LISTA DEI MASTER della rete (un master = una riga) + KPI mensili.
  // Ogni master paga il canone il 1° del mese (cron rinnovo-mensile); qui il root vede piano,
  // canone (0 se esente), e lo stato di incasso del pagamento più vecchio non ancora saldato.
  let abbonati: any[] = []
  let storicoIncassi: any[] = []
  let incassatoMese = 0, incassatoAnno = 0, previstoProssimoMese = 0, abbonatiAttivi = 0
  if (isRoot) {
    // Pagamenti della rete (per stato incasso). I record ORFANI (master cancellato) vengono scartati sotto.
    const { data: pag } = await admin.from('abbonamenti_pagamenti')
      .select('id,master_id,piano,mese,importo,pagato,pagato_il,metodo')
      .eq('root_id', utente.master_id).order('mese', { ascending: true }).limit(1000)
    // Master ATTIVI della rete (con piano OPPURE esenti), escluso il root. Solo questi esistono → niente orfani.
    const { data: mastersRete } = await admin.from('masters')
      .select('id,nome,email,abbonamento_piano,abbonamento_prezzo,abbonamento_esente')
      .in('id', reteIds).neq('id', utente.master_id)
    const attiviRete = (mastersRete || []).filter((x: any) => x.abbonamento_piano || x.abbonamento_esente)
    const attiviIds = new Set(attiviRete.map((x: any) => x.id))

    // Pagamenti non pagati raggruppati per master (solo di master ESISTENTI e attivi → esclude orfani)
    const nonPagatiByMaster = new Map<string, any[]>()
    for (const p of (pag || [])) {
      if (!attiviIds.has(p.master_id)) continue
      if (p.pagato) continue
      if (!nonPagatiByMaster.has(p.master_id)) nonPagatiByMaster.set(p.master_id, [])
      nonPagatiByMaster.get(p.master_id)!.push(p)
    }
    const nomeDi = (m: any) => (m?.nome && String(m.nome).trim()) || (m?.email && String(m.email).trim()) || ('Master #' + String(m?.id).slice(0, 6))
    abbonati = attiviRete.map((m: any) => {
      const nonPagati = (nonPagatiByMaster.get(m.id) || [])
      const daPagare = nonPagati[0] || null   // il più vecchio non saldato
      const prezzo = m.abbonamento_esente ? 0 : Number(m.abbonamento_prezzo || 0)
      return {
        master_id: m.id, master_nome: nomeDi(m), esente: !!m.abbonamento_esente,
        piano: m.abbonamento_piano, prezzo,
        pagamento_id: daPagare?.id || null,
        importo_da_incassare: daPagare ? Number(daPagare.importo || 0) : 0,
        mese_da_incassare: daPagare?.mese || null,
        n_da_incassare: nonPagati.length,
      }
    }).sort((a, b) => b.importo_da_incassare - a.importo_da_incassare)

    // KPI. NB: gli ESENTI non generano incasso reale (gratis): escludo anche loro vecchi record "pagato".
    const esentiIds = new Set(attiviRete.filter((m: any) => m.abbonamento_esente).map((m: any) => m.id))
    const mm = new Date().toISOString().slice(0, 7)
    const annoCorr = new Date().getFullYear().toString()
    // Storico incassi mese per mese (per data di incasso), escludendo gli esenti.
    const storicoMap = new Map<string, { incassato: number; n: number }>()
    for (const p of (pag || [])) {
      if (!attiviIds.has(p.master_id) || esentiIds.has(p.master_id) || !p.pagato) continue
      const k = String(p.pagato_il || '').slice(0, 7)
      if (!k) continue
      const cur = storicoMap.get(k) || { incassato: 0, n: 0 }
      cur.incassato += Number(p.importo || 0); cur.n++
      storicoMap.set(k, cur)
      if (k === mm) incassatoMese += Number(p.importo || 0)
      if (k.slice(0, 4) === annoCorr) incassatoAnno += Number(p.importo || 0)
    }
    storicoIncassi = Array.from(storicoMap.entries())
      .map(([mese, v]) => ({ mese, incassato: Math.round(v.incassato * 100) / 100, n: v.n }))
      .sort((a, b) => b.mese.localeCompare(a.mese))
    for (const m of attiviRete) if (m.abbonamento_piano && !m.abbonamento_esente) { previstoProssimoMese += Number(m.abbonamento_prezzo || 0); abbonatiAttivi++ }
  }

  return NextResponse.json({
    attivo: isRoot || !!m?.abbonamento_piano,
    illimitato: isRoot,
    esente: !!(m as any)?.abbonamento_esente,
    piano: isRoot ? 'illimitato' : (m?.abbonamento_piano || null),
    limite: m?.abbonamento_limite || 0,
    prezzo: Number(m?.abbonamento_prezzo || 0),
    spedizioni_mese: count || 0,
    credito: Number(m?.credito || 0),
    piani: PIANI_ENTERPRISE,
    isRoot,
    abbonati,
    totaleDaIncassare: Math.round(abbonati.reduce((s, a) => s + Number(a.importo_da_incassare || 0), 0) * 100) / 100,
    incassatoMese: Math.round(incassatoMese * 100) / 100,
    incassatoAnno: Math.round(incassatoAnno * 100) / 100,
    annoCorrente: new Date().getFullYear(),
    previstoProssimoMese: Math.round(previstoProssimoMese * 100) / 100,
    abbonatiAttivi,
    storicoIncassi,
  })
}

// Sceglie / cambia piano (upgrade paga la differenza, downgrade nessun addebito ora)
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { pianoId } = await req.json()
  const nuovo = pianoById(pianoId)
  if (!nuovo || !pianoId.startsWith('enterprise_')) return NextResponse.json({ error: 'Piano non valido' }, { status: 400 })

  const admin = createAdminSupabase()
  const payer = utente.master_id
  const { data: m } = await admin.from('masters')
    .select('nome,abbonamento_piano,abbonamento_prezzo,abbonamento_mese,abbonamento_esente').eq('id', payer).single()

  // Trova il SUPERROOT (M1): risalgo la catena fino al master senza padre.
  let rootId = payer
  { let cur: string | null = payer
    for (let i = 0; i < 20 && cur; i++) {
      const { data: mm } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
      if (!mm?.parent_master_id) { rootId = cur; break }
      cur = mm.parent_master_id
    }
  }
  const isRoot = rootId === payer  // il master principale è la piattaforma: esente

  const mese = meseCorrente()
  const prezzoAttuale = Number(m?.abbonamento_prezzo || 0)
  const haPianoQuestoMese = !!m?.abbonamento_piano && m?.abbonamento_mese === mese
  if (m?.abbonamento_piano === nuovo.id) return NextResponse.json({ error: 'Hai già questo piano' }, { status: 400 })

  // Importo da addebitare ORA:
  // - primo abbonamento / mese nuovo non ancora addebitato: canone pieno
  // - upgrade nello stesso mese: solo la differenza
  // - downgrade nello stesso mese: 0 (il canone più alto è già pagato)
  let importo = nuovo.prezzo
  if (haPianoQuestoMese) importo = nuovo.prezzo > prezzoAttuale ? (nuovo.prezzo - prezzoAttuale) : 0
  if (isRoot || (m as any)?.abbonamento_esente) importo = 0 // root e master ESENTI (gratis su tutti i piani)

  if (importo > 0) {
    try {
      // addebito al master che paga
      await registraMovimentoMaster(admin, {
        masterOwnerId: payer, masterTargetId: payer,
        tipo: 'abbonamento', descrizione: `Abbonamento ${nuovo.nome}`,
        importo: -Math.abs(importo), createdBy: user.id,
      })
      // ACCREDITO al superroot (M1) — NON a cascata sugli intermedi
      await registraMovimentoMaster(admin, {
        masterOwnerId: rootId, masterTargetId: rootId,
        tipo: 'abbonamento_incasso', descrizione: `Abbonamento ${nuovo.nome} da ${m?.nome || 'master'}`,
        importo: Math.abs(importo), createdBy: user.id,
      })
      // registro il pagamento da incassare (il root lo segnerà "pagato" quando arriva il bonifico)
      await admin.from('abbonamenti_pagamenti').insert({
        master_id: payer, root_id: rootId, piano: nuovo.id, mese, importo, pagato: false,
      })
    } catch (e) {
      console.error('Errore addebito/accredito abbonamento:', e)
      return NextResponse.json({ error: 'Errore nell\'addebito del piano' }, { status: 500 })
    }
  }

  await admin.from('masters').update({
    abbonamento_piano: nuovo.id, abbonamento_limite: nuovo.limite, abbonamento_prezzo: nuovo.prezzo,
    abbonamento_mese: mese,
    abbonamento_attivato_il: m?.abbonamento_piano ? undefined : new Date().toISOString(),
  }).eq('id', utente.master_id)

  return NextResponse.json({ success: true, piano: nuovo.id, addebitato: importo })
}
