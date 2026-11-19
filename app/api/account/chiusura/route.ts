import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraAudit } from '@/lib/audit'
import { inviaRichiestaChiusuraAccount } from '@/lib/email'

// CHIUSURA DELL'ACCOUNT, CHIESTA DA CHI CE L'HA.
//
// Perche' esiste: Apple (linea guida 5.1.1(v)) vuole che nelle app dove si creano account si possa
// AVVIARE la chiusura del proprio da dentro l'app, e Google chiede lo stesso. L'app iOS/Android e' il
// portale in un guscio, quindi la porta sta qui e vale per il web e per l'app insieme. Prima non
// c'era nessun modo: chi voleva andarsene doveva scrivere a qualcuno fuori dal portale.
//
// Non si cancella niente. Spedizioni, ritiri, distinte, movimenti e fatture restano (per legge, e per
// regola del progetto: lo storico non si cancella). La richiesta arriva a chi gestisce l'account,
// che decide e toglie l'accesso. Decisione di Lorenzo, 19/11/2026:
//  - CLIENTE → ticket al suo master. Anche con i ticket bloccati o finiti per oggi: quei freni
//    servono contro l'abuso dell'assistenza, non possono impedire di chiedere di andarsene (come la POD).
//  - TITOLARE del master (ruolo 'master') → ticket alla sua linea superiore, come ogni sua richiesta.
//  - COLLABORATORI (admin, operatore), AGENTI, AUTISTI → email al master: il loro accesso lo crea e lo
//    toglie il titolare dalla pagina Staff, e nei ticket non hanno un posto (l'agente e' fuori da tutte
//    le rotte di assistenza, vedi lib/ticket-accesso).
//  - MASTER DEMO: solo il registro, niente ticket ne' email. In demo nulla tocca il mondo reale
//    (lib/demo), e il root demo non ha nessuno sopra. La conferma a schermo e' la stessa: e' il
//    percorso che provano i revisori degli store con l'account «Demo Shop».
// Ogni richiesta va nel registro accessi (audit_accessi), che serve anche a non mandare la stessa
// email due volte.

const OGGETTO = "Richiesta di chiusura dell'account"
const AZIONE = 'richiesta_chiusura_account'
// Gli stati in cui una richiesta e' ancora "in corso" (come in /api/assistenza/apri).
const STATI_APERTI = ['aperto', 'in_lavorazione', 'rimborso']
const NOMI_RUOLO: Record<string, string> = {
  cliente: 'Cliente', master: 'Titolare', admin: 'Amministratore', operatore: 'Operatore', agente: 'Agente', autista: 'Autista',
}
const CONFERMA = 'Richiesta inviata: ti contatterà chi gestisce il tuo account. Spedizioni, fatture e movimenti restano conservati come prevede la legge.'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  const ruolo = String(utente?.ruolo || '').toLowerCase()
  const masterId = utente?.master_id
  if (!masterId || !NOMI_RUOLO[ruolo]) return NextResponse.json({ error: 'Account non riconosciuto: scrivi all\'assistenza.' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const motivo = String(body?.motivo || '').trim().slice(0, 1000)
  const persona = [utente?.nome, utente?.cognome].filter(Boolean).join(' ')
  const email = user.email || ''

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('nome,email,parent_master_id,demo').eq('id', masterId).maybeSingle()

  if (m?.demo === true) {
    await registraAudit({ utenteId: user.id, ruolo, azione: AZIONE, risorsa: masterId, dettaglio: 'master demo: registrata, nessun ticket ne\' email' })
    return NextResponse.json({ ok: true, messaggio: CONFERMA })
  }

  // Il testo che legge chi gestisce l'account: chi chiede, da dove, perche', e cosa NON e' successo.
  const testo = (aperto: string) => [
    `${persona || email} (${email}) chiede di chiudere il proprio account MoovExpress.`,
    `Ruolo: ${NOMI_RUOLO[ruolo]} · Account: ${aperto}`,
    motivo ? `Motivo: ${motivo}` : 'Motivo: non indicato',
    'Non è stato cancellato nulla: se sei d\'accordo, disattiva l\'accesso. Spedizioni, fatture e movimenti restano conservati.',
  ].join('\n')

  // ── CLIENTE e TITOLARE: un ticket, come le altre richieste all'assistenza ──
  if (ruolo === 'cliente' || ruolo === 'master') {
    const record: Record<string, string | boolean | null> = { oggetto: OGGETTO, stato: 'aperto', categoria: 'ticket', non_letto_owner: true }
    let gia: { codice: string | null } | null = null
    if (ruolo === 'cliente') {
      if (!utente?.cliente_id) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
      const { data: cli } = await admin.from('clienti').select('ragione_sociale').eq('id', utente.cliente_id).maybeSingle()
      ;({ data: gia } = await admin.from('tickets').select('codice').eq('cliente_id', utente.cliente_id)
        .eq('oggetto', OGGETTO).in('stato', STATI_APERTI).limit(1).maybeSingle())
      record.owner_master_id = masterId
      record.cliente_id = utente.cliente_id
      record.aperto_da = String(cli?.ragione_sociale || 'Cliente')
      record.tipo_apertura = 'cliente'
    } else {
      // L'unico master senza linea superiore (a parte i demo, gia' usciti) e' la radice MoovExpress.
      if (!m?.parent_master_id) {
        return NextResponse.json({ error: 'Sei il master principale: non c\'è una linea superiore a cui inviare la richiesta.' }, { status: 400 })
      }
      ;({ data: gia } = await admin.from('tickets').select('codice').eq('aperto_master_id', masterId)
        .eq('tipo_apertura', 'master').eq('oggetto', OGGETTO).in('stato', STATI_APERTI).limit(1).maybeSingle())
      record.owner_master_id = m.parent_master_id
      record.aperto_master_id = masterId
      record.aperto_da = String(m?.nome || 'Master')
      record.tipo_apertura = 'master'
    }
    if (gia) {
      return NextResponse.json({ ok: true, gia: true, messaggio: `Hai già inviato la richiesta (${gia.codice}): la trovi in Assistenza, e lì ti risponderanno.` })
    }
    record.messaggio = testo(String(record.aperto_da))
    const { data: t, error } = await admin.from('tickets').insert(record).select('id,codice').single()
    if (error || !t) {
      console.error('[CHIUSURA ACCOUNT] ticket non creato', user.id, error?.message)
      return NextResponse.json({ error: 'Non siamo riusciti a inviare la richiesta: riprova tra poco.' }, { status: 500 })
    }
    // Primo messaggio della chat, come in /api/assistenza/apri: chi apre e' il lato "richiedente".
    await admin.from('ticket_messaggi').insert({
      ticket_id: t.id, autore: 'cliente', autore_id: user.id, autore_nome: record.aperto_da, testo: record.messaggio,
    })
    await registraAudit({ utenteId: user.id, ruolo, azione: AZIONE, risorsa: t.codice || t.id, dettaglio: `ticket a ${record.owner_master_id}` })
    return NextResponse.json({ ok: true, codice: t.codice, messaggio: CONFERMA })
  }

  // ── COLLABORATORI, AGENTI, AUTISTI: email al master ──
  // Una a settimana basta: chi preme due volte non deve riempire la casella del titolare.
  const settimana = new Date(Date.now() - 7 * 86400000).toISOString()
  const { count } = await admin.from('audit_accessi').select('id', { count: 'exact', head: true })
    .eq('utente_id', user.id).eq('azione', AZIONE).gte('created_at', settimana)
  if ((count || 0) > 0) {
    return NextResponse.json({ ok: true, gia: true, messaggio: 'Hai già inviato la richiesta in questi giorni: il titolare del tuo account l\'ha ricevuta via email.' })
  }
  // L'indirizzo del master; se manca, quello dei suoi titolari.
  let destinatario = String(m?.email || '').trim()
  if (!destinatario) {
    const { data: titolari } = await admin.from('utenti').select('id').eq('master_id', masterId).eq('ruolo', 'master').limit(3)
    for (const tit of titolari || []) {
      const { data: au } = await admin.auth.admin.getUserById(String((tit as { id: string }).id))
      if (au?.user?.email) { destinatario = au.user.email; break }
    }
  }
  if (!destinatario) {
    console.error('[CHIUSURA ACCOUNT] nessun indirizzo per il master', masterId)
    return NextResponse.json({ error: 'Non troviamo un indirizzo del titolare del tuo account: chiedi a lui direttamente di togliere il tuo accesso.' }, { status: 409 })
  }
  const esito = await inviaRichiestaChiusuraAccount({ to: destinatario, masterNome: m?.nome || 'il tuo master', persona, email, ruolo: NOMI_RUOLO[ruolo], motivo })
  if (!esito.ok) return NextResponse.json({ error: 'Non siamo riusciti a inviare la richiesta: riprova tra poco.' }, { status: 502 })
  await registraAudit({ utenteId: user.id, ruolo, azione: AZIONE, risorsa: masterId, dettaglio: 'email al master' })
  return NextResponse.json({ ok: true, messaggio: CONFERMA })
}
