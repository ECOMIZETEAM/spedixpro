import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { inviaAllarmiSicurezza } from '@/lib/email'
import { chiAllarme, nomiPerId } from '@/lib/allarmi-sicurezza'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ALLARMI DI SICUREZZA — ogni 15 minuti (DPP Amazon 2.6.2).
//
// Le regole stanno nel database (controllo_allarmi, scripts/allarmi-sicurezza.sql): qui si chiede, si
// danno i nomi a utenti e clienti e si manda l'email. A differenza della Sentinella scrive SOLO quando
// c'e' un allarme nuovo: novantasei email al giorno con scritto "tutto bene" non le legge nessuno. Che
// il giro sia vivo lo controlla la Sentinella del mattino (controllo_giornaliero_3).
//
// Solo dal lavoro pianificato: non c'e' niente da guardare a mano qui, e ogni chiamata manda email.
const DESTINATARIO_DI_RIPIEGO = 'info@moovexpress.com'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const admin = createAdminSupabase()

  const { data, error } = await admin.rpc('controllo_allarmi')
  if (error) {
    console.error('[ALLARMI] controllo non eseguito:', error.message)
    return NextResponse.json({ error: 'Controllo non eseguito' }, { status: 500 })
  }
  const nuovi = (data || []) as any[]
  if (!nuovi.length) return NextResponse.json({ ok: true, nuovi: 0 })

  // Nomi per chi legge l'email: nel registro degli allarmi restano solo gli id.
  const nomi = await nomiPerId(admin, nuovi.map(a => a.utente_id), nuovi.map(a => a.cliente_id))
  const quando = (t: string) => new Date(t).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  const { data: sess } = await admin.from('onetracking_sessione').select('email_alert').eq('id', 1).maybeSingle()
  const to = (sess as any)?.email_alert || DESTINATARIO_DI_RIPIEGO
  const inviata = await inviaAllarmiSicurezza(to, nuovi.map(a => ({
    tipo: String(a.tipo), descrizione: String(a.descrizione), chi: chiAllarme(a, nomi), quando: quando(a.creato_il),
  })))
  if (!inviata.ok) {
    // Restano "da spedire": il giro dopo ci riprova, e la Sentinella dice se restano indietro.
    return NextResponse.json({ error: 'Email non inviata', nuovi: nuovi.length }, { status: 500 })
  }
  const { error: errSegna } = await admin.from('allarmi_sicurezza')
    .update({ inviato_il: new Date().toISOString() }).in('id', nuovi.map(a => a.id))
  if (errSegna) console.error('[ALLARMI] spediti ma non segnati (al giro dopo si rispediscono):', errSegna.message)
  return NextResponse.json({ ok: true, nuovi: nuovi.length, destinatario: to })
}
