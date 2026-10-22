import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { eTitolareOAdmin } from '@/lib/ruoli'

export const dynamic = 'force-dynamic'

// VOCI DEL CONTO CON IL CORRIERE sui contratti PROPRI (scripts/voci-conto-corriere.sql). Il conto di un
// contratto proprio registra quanto costa il corriere e poteva solo scendere: GTS su BRT EXPRESS ITA era a
// −23.929,91 € il 22/10, e le fatture pagate a BRT non c'erano. Qui il master segna quello che regola col
// corriere: pagamento fattura, contrassegni compensati, nota di credito, costo extra in fattura.
//
// Le scrive SOLO il titolare del master o un suo admin (Lorenzo, 22/10): sono i suoi conti col suo
// corriere, e il master sopra il conto proprio non lo vede nemmeno. Il contratto si ricava qui dalla
// sezione, fra i contratti PROPRI del master loggato: dal browser arriva solo la chiave della sezione.
// Una voce sbagliata si annulla con la riga opposta: niente si cancella.
const VOCI = ['pagamento_fattura', 'cod_compensati', 'nota_credito', 'costo_extra'] as const

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const bloccoAg = bloccaAgente(utente as any); if (bloccoAg) return bloccoAg
  if (!utente?.master_id || !eTitolareOAdmin(utente as any)) {
    return NextResponse.json({ error: 'Solo il titolare del conto può registrare voci con il corriere.' }, { status: 403 })
  }
  const io: string = utente.master_id
  const body = await req.json().catch(() => ({} as any))
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  if (body?.azione === 'annulla') {
    const movimentoId = String(body?.movimentoId || '')
    if (!/^[0-9a-f-]{36}$/i.test(movimentoId)) return NextResponse.json({ error: 'Voce non valida' }, { status: 400 })
    const { error } = await admin.rpc('storna_voce_conto_corriere', { p_master: io, p_movimento: movimentoId, p_created_by: user.id })
    if (error) return NextResponse.json({ error: messaggio(error.message) }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  const voce = String(body?.voce || '')
  if (!(VOCI as readonly string[]).includes(voce)) return NextResponse.json({ error: 'Voce non valida' }, { status: 400 })
  const importo = Math.round(Number(body?.importo) * 100) / 100
  if (!isFinite(importo) || importo <= 0 || importo > 1000000) return NextResponse.json({ error: 'Importo non valido' }, { status: 400 })
  const sezione = String(body?.sezione || '')
  if (!sezione.startsWith('p:')) return NextResponse.json({ error: 'Le voci si registrano solo sui contratti tuoi' }, { status: 400 })
  const chiave = sezione.slice(2)
  const norm = (s: any) => String(s || '').trim().toLowerCase()
  const { data: propri } = await admin.from('corrieri').select('id,nome_contratto').eq('master_id', io).eq('proprio', true)
  const corriere = ((propri || []) as any[]).find(c => norm(c.nome_contratto) === chiave)
  if (!corriere) return NextResponse.json({ error: 'Contratto non trovato fra i tuoi' }, { status: 400 })

  const nota = String(body?.nota || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  const { error } = await admin.rpc('registra_voce_conto_corriere', {
    p_master: io, p_corriere_id: corriere.id, p_voce: voce, p_importo: importo, p_nota: nota || null, p_created_by: user.id,
  })
  if (error) return NextResponse.json({ error: messaggio(error.message) }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// Gli errori della funzione sono gia' frasi per chi legge; il resto si dice in generale.
function messaggio(m: string): string {
  const noti = ['Voce non valida', 'Importo non valido', "Il contratto non e' tuo", 'Questo master non ha il conto dei contratti propri', 'Voce non trovata', "Voce gia' annullata"]
  const trovato = noti.find(n => m.includes(n))
  if (trovato) return trovato.replace("e' ", 'è ').replace("gia' ", 'già ')
  console.error('[voce-corriere]', m)
  return 'Operazione non riuscita, riprova.'
}
