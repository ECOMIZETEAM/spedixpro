import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { momentoAvviso } from '@/lib/calendario-avviso'

// Notifiche destinate all'utente, con una CATEGORIA calcolata così le schermate possono dividerle in
// tab (gli avvisi importanti non devono più sparire sotto la valanga di "Spedizione consegnata").
//   - avviso       = broadcast del master al gruppo (cliente_id null) → gli AVVISI importanti
//   - contrassegno = evento contrassegno accreditato
//   - giacenza     = pacco in giacenza (serve un'azione)
//   - consegna     = spedizione consegnata / altri eventi di stato (informativi, ad alto volume)
function categoria(n: any): string {
  if (!n.cliente_id) return 'avviso'
  const o = String(n.oggetto || '').toLowerCase()
  if (o.includes('contrassegno')) return 'contrassegno'
  if (o.includes('giacenza')) return 'giacenza'
  return 'consegna'
}

const escHtml = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json([])

  const mappa: Record<string,string> = { cliente: 'Cliente', admin: 'Amministratore', master: 'Amministratore', operatore: 'Operatore', agente: 'Agente' }
  const gruppo = mappa[(utente?.ruolo || '').toLowerCase()] || 'Cliente'

  // AVVISI (broadcast del gruppo) presi a PARTE: così restano sempre visibili anche quando ci sono
  // migliaia di eventi per-spedizione. Prima una sola query con limit li seppelliva sotto i "consegnata".
  const avvisiQ = supabase.from('notifiche').select('*')
    .eq('master_id', utente.master_id)
    .is('cliente_id', null).contains('gruppi', [gruppo])
    .order('created_at', { ascending: false }).limit(30)

  // EVENTI per-spedizione (solo per i clienti): consegne, giacenze, contrassegni.
  const eventiP = utente.cliente_id
    ? supabase.from('notifiche').select('*')
        .eq('master_id', utente.master_id).eq('cliente_id', utente.cliente_id)
        .order('created_at', { ascending: false }).limit(60)
    : Promise.resolve({ data: [] as any[] })

  // NOTIFICHE DI RETE da un ANTENATO: un master superiore ha mandato un broadcast ai sotto-master, e
  // la nostra master_id è nei destinatari (target_master_ids). Le legge solo lo STAFF (master/admin/
  // operatore): sono messaggi da master a master, non per i clienti del sotto-master. Via admin perché
  // l'RLS di notifiche mostra a ciascuno solo la propria rete a valle, non le notifiche degli antenati.
  const ruolo = (utente.ruolo || '').toLowerCase()
  const staffMaster = ['master', 'admin', 'operatore'].includes(ruolo)
  const reteP = staffMaster
    ? createAdminSupabase().from('notifiche').select('*')
        .contains('target_master_ids', [utente.master_id])
        .is('cliente_id', null)
        .order('created_at', { ascending: false }).limit(30)
    : Promise.resolve({ data: [] as any[] })

  // I PROMEMORIA DEL CALENDARIO (25/11/2026): le voci di questa persona arrivate all'ora dell'avviso e non ancora
  // fatte, degli ultimi 7 giorni. Stanno nella stessa risposta che la campanella chiede già ogni 60 secondi: nessun
  // controllo in più dal browser. Sono di chi le ha scritte (utente_id), non del gruppo: le notifiche di oggi sono
  // per master o per cliente, non per persona. Se la lettura non riesce, la campanella resta com'era.
  const ora = Date.now()
  const calP = createAdminSupabase().from('calendario_eventi')
    .select('id,tipo,titolo,inizio,tutto_il_giorno,luogo,avviso_minuti,collegamento')
    .eq('utente_id', user.id).is('eliminato_il', null).eq('fatto', false).not('avviso_minuti', 'is', null)
    .gte('inizio', new Date(ora - 7 * 86400000).toISOString()).lte('inizio', new Date(ora + 7 * 86400000).toISOString())
    .order('inizio', { ascending: false }).limit(100)

  const [{ data: avvisi }, { data: eventi }, { data: rete }, cal] = await Promise.all([avvisiQ, eventiP, reteP, calP])
  if (cal.error) console.error('[NOTIFICHE] promemoria del calendario non letti:', cal.error.message)
  const hrefCalendario = utente.cliente_id ? '/cliente/calendario' : '/dashboard/calendario'
  const promemoria = (cal.data || []).flatMap((e: any) => {
    const quando = momentoAvviso(e)
    if (!quando || quando.getTime() > ora) return []
    const inizio = new Date(e.inizio)
    const giorno = inizio.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' })
    const orario = e.tutto_il_giorno ? 'tutto il giorno' : 'alle ' + inizio.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
    // il messaggio della campanella è HTML: i testi scritti dall'utente si scappano
    const parti = [`${giorno}, ${orario}`, e.luogo, e.collegamento?.etichetta].filter(Boolean).map(escHtml)
    return [{
      id: 'cal-' + e.id, oggetto: e.titolo, messaggio: parti.join(' · '), created_at: quando.toISOString(),
      link: hrefCalendario, categoria: 'promemoria',
    }]
  })
  // la categoria calcolata vale per le righe di «notifiche»; i promemoria hanno già la loro
  const tutte = [...[...(avvisi || []), ...(eventi || []), ...(rete || [])].map(n => ({ ...n, categoria: categoria(n) })), ...promemoria]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return NextResponse.json(tutte)
}
