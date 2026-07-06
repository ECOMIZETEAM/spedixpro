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
    .select('abbonamento_piano,abbonamento_limite,abbonamento_prezzo,abbonamento_mese,abbonamento_attivato_il,credito')
    .eq('id', utente.master_id).single()

  const now = new Date()
  const inizioMese = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const { count } = await admin.from('spedizioni')
    .select('*', { count: 'exact', head: true })
    .eq('master_id', utente.master_id).gte('created_at', inizioMese).neq('stato', 'annullata')

  return NextResponse.json({
    attivo: !!m?.abbonamento_piano,
    piano: m?.abbonamento_piano || null,
    limite: m?.abbonamento_limite || 0,
    prezzo: Number(m?.abbonamento_prezzo || 0),
    spedizioni_mese: count || 0,
    credito: Number(m?.credito || 0),
    piani: PIANI_ENTERPRISE,
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
    .select('nome,abbonamento_piano,abbonamento_prezzo,abbonamento_mese').eq('id', payer).single()

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
  if (isRoot) importo = 0 // il master principale non paga a sé stesso

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
