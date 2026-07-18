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

  // Se sono il ROOT (M1): elenco degli abbonamenti da incassare dalla mia rete + KPI mensili
  let pagamenti: any[] = []
  let incassatoMese = 0, previstoProssimoMese = 0, abbonatiAttivi = 0
  if (isRoot) {
    const { data: pag } = await admin.from('abbonamenti_pagamenti')
      .select('id,master_id,piano,mese,importo,pagato,pagato_il,metodo,created_at')
      .eq('root_id', utente.master_id).order('created_at', { ascending: false }).limit(500)
    const ids = [...new Set((pag || []).map(p => p.master_id))]
    const { data: nomi } = ids.length
      ? await admin.from('masters').select('id,nome,email,abbonamento_esente').in('id', ids)
      : { data: [] as any[] }
    const infoById = new Map((nomi || []).map((n: any) => [n.id, n]))
    // Nome leggibile: nome → email → "Master #<id breve>" (così i record incompleti sono identificabili, non tutti "Master")
    const nomeDi = (mid: string) => {
      const i: any = infoById.get(mid)
      return (i?.nome && String(i.nome).trim()) || (i?.email && String(i.email).trim()) || ('Master #' + String(mid).slice(0, 6))
    }
    pagamenti = (pag || []).map(p => ({ ...p, master_nome: nomeDi(p.master_id), master_esente: !!infoById.get(p.master_id)?.abbonamento_esente }))

    // KPI: INCASSATO questo mese (pagamenti segnati pagato nel mese corrente)
    const mm = new Date().toISOString().slice(0, 7)
    for (const p of (pag || [])) if (p.pagato && String(p.pagato_il || '').slice(0, 7) === mm) incassatoMese += Number(p.importo || 0)
    // PREVISTO prossimo mese = canoni ricorrenti dei master della rete con piano attivo e NON esenti.
    const { data: attivi } = await admin.from('masters')
      .select('abbonamento_prezzo').in('id', reteIds)
      .not('abbonamento_piano', 'is', null).neq('abbonamento_esente', true).neq('id', utente.master_id)
    for (const a of (attivi || [])) { previstoProssimoMese += Number((a as any).abbonamento_prezzo || 0); abbonatiAttivi++ }
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
    pagamenti,
    incassatoMese: Math.round(incassatoMese * 100) / 100,
    previstoProssimoMese: Math.round(previstoProssimoMese * 100) / 100,
    abbonatiAttivi,
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
