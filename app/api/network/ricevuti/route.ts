import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { datiRicevuti } from '@/lib/network-ricevuti'

// Cosa il MIO master ha ricevuto dai livelli superiori della catena.
// RLS: le righe appartengono al master PADRE -> lettura via admin, autorizzazione = target_master_id mio.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  // Il ruolo, non l'elenco di quelli da tenere fuori: escludendo il solo 'cliente' passava
  // l'AUTISTA, che un master_id ce l'ha (3 in produzione) — e qui sotto si legge e si scrive con la
  // chiave di servizio, che scavalca le regole per riga.
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const mio = utente.master_id
  const adminDb = createAdminSupabase()

  // SELF-HEAL: una FIGLIA può esistere mentre il padre è rimasto propagazione=null (giro di
  // propagazione interrotto a metà, o concorrente). Quel padre riappare come "da decidere" e al
  // re-tentativo dà "già propagata" — la confusione segnalata da Lorenzo. Prima di leggere, marco
  // 'propagata' i padri (miei, confermati, ancora null) che hanno GIA' una figlia, così escono dalle
  // "da decidere". Best-effort, idempotente, non muove denaro (solo il flag propagazione).
  try {
    const { data: candid } = await adminDb.from('rettifiche')
      .select('id').eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true).is('propagazione', null)
    const ids = (candid || []).map((r: any) => r.id)
    if (ids.length) {
      const { data: figlie } = await adminDb.from('rettifiche').select('origine_rettifica_id').in('origine_rettifica_id', ids)
      const conFiglia = Array.from(new Set((figlie || []).map((f: any) => f.origine_rettifica_id).filter(Boolean)))
      if (conFiglia.length) await adminDb.from('rettifiche').update({ propagazione: 'propagata' }).in('id', conFiglia as string[])
    }
  } catch { /* best-effort: non deve mai bloccare la lista */ }

  return NextResponse.json(await datiRicevuti(adminDb, mio))
}
