import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { cartePerCampanella } from '@/lib/calendario-server'

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

  // IL CALENDARIO (25/11/2026): gli avvisi arrivati (ultimi 7 giorni, non fatti) delle voci di questa persona — anche
  // quelle che si ripetono e le riunioni a cui è invitata — e gli inviti ancora senza risposta (lib/calendario-server).
  // Stanno nella stessa risposta che la campanella chiede già ogni 60 secondi: nessun controllo in più dal browser.
  // Sono di chi le ha scritte o ricevute (utente_id), non del gruppo. Se la lettura non riesce, la campanella resta com'era.
  const hrefCalendario = utente.cliente_id ? '/cliente/calendario' : '/dashboard/calendario'
  const calP = cartePerCampanella(createAdminSupabase(), user.id, hrefCalendario, escHtml)
    .catch((e: any) => { console.error('[NOTIFICHE] calendario non letto:', e?.message || e); return [] as any[] })

  const [{ data: avvisi }, { data: eventi }, { data: rete }, promemoria] = await Promise.all([avvisiQ, eventiP, reteP, calP])
  // la categoria calcolata vale per le righe di «notifiche»; i promemoria hanno già la loro
  const tutte = [...[...(avvisi || []), ...(eventi || []), ...(rete || [])].map(n => ({ ...n, categoria: categoria(n) })), ...promemoria]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return NextResponse.json(tutte)
}
