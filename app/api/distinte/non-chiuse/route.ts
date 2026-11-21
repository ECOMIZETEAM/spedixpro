import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { distinteClientiNonChiuse } from '@/lib/distinte-non-chiuse'
import { nomeClientePulito } from '@/lib/numero-spedizione'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GIRO DI CONTROLLO: distinte dei clienti non confermate dal corriere con pacchi ancora fermi (le regole
// stanno in lib/distinte-non-chiuse). Ogni mezz'ora di giorno (vercel.json), cosi' una chiusura saltata
// al mattino si vede prima che passi il furgone, e quelle del giro delle 23 si vedono alle 7.
// NON chiude niente e non tocca distinte o spedizioni: scrive una riga nel registro per ognuna, a ogni
// giro finche' resta aperta, e manda UN avviso allo staff del master della distinta.
//
// L'avviso parte dalla piattaforma (master radice) verso il master della distinta, come gli avvisi di rete
// (target_master_ids, letti da /api/notifiche/mie solo dallo staff): cosi' non finisce fra i messaggi che il
// master ha mandato ai suoi clienti. Il testo NON riporta l'errore grezzo del corriere: puo' contenere il
// nome del fornitore tecnico, che a un master non si mostra mai. Quello resta nel registro.
const OGGETTO = 'Distinta non trasmessa al corriere'
const MAX_AVVISI_PER_GIRO = 50
const fmtGiorno = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' })
const fmtOra = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
const quando = (iso: string) => { const d = new Date(iso); return `${fmtGiorno.format(d)} alle ${fmtOra.format(d)}` }

export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()
  const aperte = await distinteClientiNonChiuse(admin)
  for (const d of aperte) {
    console.warn(`[DISTINTE][NON CHIUSA] ${d.numero} | cliente ${d.cliente} | master ${d.master} | contratto ${d.contratto} | creata ${quando(d.creata_il)} | ferme ${d.ferme}/${d.totale} | ${d.errore || 'chiusura non registrata'}`)
  }
  if (!aperte.length) return NextResponse.json({ ok: true, nonChiuse: 0, avvisiNuovi: 0 })

  // Mittente: la piattaforma. Se non si trova, l'avviso parte dal master stesso verso il suo staff.
  const { data: radice } = await admin.from('masters').select('id').eq('is_super_master', true).is('parent_master_id', null).limit(1).maybeSingle()
  const mittente = (radice as any)?.id || null

  // Un avviso per distinta: chi l'ha gia' avuto non lo riceve a ogni mezz'ora.
  const link = (d: { id: string }) => `/dashboard/distinte/${d.id}`
  const gia = new Set<string>()
  {
    const { data, error } = await admin.from('notifiche').select('link').eq('oggetto', OGGETTO).in('link', aperte.map(link))
    if (error) {
      console.error('[DISTINTE][NON CHIUSA] avvisi gia\' mandati non letti, niente avvisi in questo giro:', error.message)
      return NextResponse.json({ ok: false, nonChiuse: aperte.length, avvisiNuovi: 0 })
    }
    for (const n of data || []) gia.add(String(n.link))
  }
  const nuove = aperte.filter(d => !gia.has(link(d))).slice(0, MAX_AVVISI_PER_GIRO)
  let avvisiNuovi = 0
  for (const d of nuove) {
    const messaggio = `La distinta N. ${d.numero} di ${nomeClientePulito(d.cliente) || 'un cliente'} (${d.contratto}), creata il `
      + `${quando(d.creata_il)}, non risulta confermata dal corriere: ${d.ferme === 1 ? '1 spedizione è ancora ferma' : d.ferme + ' spedizioni sono ancora ferme'}. `
      + `Senza conferma il corriere potrebbe non passare a ritirare. Dall'Elenco distinte selezionala e premi "Conferma Selezionate"; se non passa, apri un ticket.`
    const riga: Record<string, unknown> = mittente
      ? { master_id: mittente, cliente_id: null, gruppi: [], target_master_ids: [d.master_id], oggetto: OGGETTO, messaggio, link: link(d) }
      : { master_id: d.master_id, cliente_id: null, gruppi: ['Amministratore', 'Operatore'], oggetto: OGGETTO, messaggio, link: link(d) }
    const { error } = await admin.from('notifiche').insert(riga)
    if (error) console.error('[DISTINTE][NON CHIUSA] avviso non scritto', d.numero, error.message)
    else avvisiNuovi++
  }
  return NextResponse.json({ ok: true, nonChiuse: aperte.length, avvisiNuovi })
}
