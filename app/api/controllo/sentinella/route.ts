import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { inviaControlloGiornaliero } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// LA SENTINELLA — una mail al giorno che dice se tutto ha lavorato.
//
// Perche' esiste: il 21/08/2026 la sessione OneTracking del server e' morta e il recupero delle
// ripesature si e' fermato il 31/08. Nessuno se n'e' accorto fino all'11/09, perche' non andava in
// errore NIENTE: semplicemente non succedeva piu' nulla, e il silenzio non suona.
//
// Quindi i controlli guardano la FRESCHEZZA ("in queste ore si e' mosso qualcosa?") oltre ai buchi
// gia' visti una volta. Le domande stanno nel database (`controllo_giornaliero`), qui si formatta e
// si manda. La mail parte ANCHE quando e' tutto verde, di proposito: una sentinella che scrive solo
// quando c'e' un problema non si distingue da una morta.
const DESTINATARIO_DI_RIPIEGO = 'info@moovexpress.com'

async function autorizzato(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET) return true
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: u } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!gestisceLaRete(u as any)) return false
  const { data: m } = await supabase.from('masters').select('is_super_master').eq('id', u!.master_id).maybeSingle()
  return !!(m as any)?.is_super_master
}

export async function GET(req: NextRequest) {
  if (!(await autorizzato(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const admin = createAdminSupabase()

  const { data: righe, error } = await admin.rpc('controllo_giornaliero')
  if (error || !righe) {
    // Se non riesco nemmeno a fare le domande, quello E' l'allarme: si dice, non si tace.
    console.error('[SENTINELLA] controllo non eseguito:', error?.message)
    return NextResponse.json({ error: 'Controllo non eseguito' }, { status: 500 })
  }

  const esiti = (righe as any[]).map(r => ({
    area: String(r.area), controllo: String(r.controllo),
    valore: Number(r.valore) || 0, atteso: String(r.atteso), allarme: !!r.allarme,
  }))
  const allarmi = esiti.filter(e => e.allarme)

  // Il destinatario e' quello configurato per gli avvisi (Statistiche › Rettifiche automatiche).
  const { data: sess } = await admin.from('onetracking_sessione').select('email_alert').eq('id', 1).maybeSingle()
  const to = (sess as any)?.email_alert || DESTINATARIO_DI_RIPIEGO
  // Solo dal lavoro pianificato: aprendo la pagina a mano si guarda, non si spamma.
  const mandaMail = req.nextUrl.searchParams.get('mail') !== 'no'
  const inviata = mandaMail ? await inviaControlloGiornaliero(to, esiti) : { ok: false }

  return NextResponse.json({
    ok: true,
    quando: new Date().toISOString(),
    allarmi: allarmi.length,
    mailInviata: inviata.ok, destinatario: mandaMail ? to : null,
    esiti,
  })
}
