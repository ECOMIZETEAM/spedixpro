import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { COLONNE_DATI_NEGOZIO, impostazioniDi, servonoDatiNegozio, validaDatiNegozio, versioneDatiNegozio } from '@/lib/dati-negozio'

// I DATI DEL NEGOZIO, SALVATI DALLA SCHERMATA DEL PRIMO ACCESSO (app/cliente/CompletaDatiNegozio).
//
// Una rotta sua, e non il PUT di /api/cliente/dati: la pagina Stampa e Notifiche manda a quel PUT
// l'intera riga del cliente letta all'apertura, quindi ogni campo che quella rotta accettasse verrebbe
// riscritto da una copia vecchia (succede gia' all'EORI). Qui arrivano solo i campi della schermata,
// controllati uno per uno (lib/dati-negozio).
//
// Si accetta SOLO dal conto nato dall'installazione dell'app Shopify e SOLO finche' i dati servono
// (mancano, o alla nascita sono stati segnati da confermare): decisione di Lorenzo del 21/10/2026. Dopo,
// sede, telefono e dati fiscali li cambia il master dalla scheda cliente: sono il mittente di ogni
// spedizione, entrano nel prezzo e intestano le fatture.
// E' una regola del portale, non un confine del database: il cliente puo' gia' scrivere la propria
// riga di clienti con la sua sessione. Si scrive comunque col client di servizio, cosi' la rotta regge
// anche quando quel permesso verra' tolto.

// La stessa risposta per le due corse (mentre si compilava, o nei millisecondi della scrittura): per
// il negoziante e' la stessa cosa, e la schermata la riconosce da `motivo`.
const DATI_CAMBIATI = {
  error: 'Mentre compilavi, i dati del tuo negozio sono stati modificati da un\'altra parte (per esempio dal tuo referente). Controlla i campi e salva di nuovo.',
  motivo: 'cambiati',
}

async function contesto() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('cliente_id,ruolo,attivo').eq('id', user.id).maybeSingle()
  if (!u?.cliente_id || (u.ruolo || '').toLowerCase() !== 'cliente' || u.attivo === false) return null
  return { clienteId: u.cliente_id as string, admin: createAdminSupabase() }
}

export async function POST(req: NextRequest) {
  const ctx = await contesto()
  if (!ctx) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { clienteId, admin } = ctx

  const { data: c, error: eLettura } = await admin.from('clienti')
    .select('id,attivo,updated_at,' + COLONNE_DATI_NEGOZIO).eq('id', clienteId).maybeSingle()
  if (eLettura) {
    console.error('[DATI-NEGOZIO] lettura cliente non riuscita', clienteId, eLettura.code, eLettura.message)
    return NextResponse.json({ error: 'Non sono riuscito a leggere i tuoi dati, riprova fra poco.' }, { status: 500 })
  }
  const cliente = c as Record<string, any> | null
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 404 })
  if (cliente.attivo === false) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  if (!servonoDatiNegozio(cliente)) {
    return NextResponse.json({
      error: 'I dati del negozio risultano già completi: per cambiarli scrivi al tuo referente.',
      motivo: 'completi',
    }, { status: 409 })
  }

  const corpo = await req.json().catch(() => null)
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  }

  // I DATI CHE IL NEGOZIANTE HA VISTO SONO ANCORA QUELLI DI ADESSO?
  // Il filtro della scrittura qui sotto copre solo i millisecondi di questa richiesta. Il master invece
  // puo' salvare la scheda mentre la schermata e' aperta: se l'email vera manca ancora la schermata
  // serve ancora, la rotta rileggeva la riga gia' cambiata e la riscriveva tutta, telefono, P.IVA e
  // sede del master compresi. La schermata rimanda l'impronta che il layout le ha dato all'apertura
  // (lib/dati-negozio, versioneDatiNegozio): se non e' piu' quella della riga, si ferma prima di
  // controllare i campi, che stanno per essere sostituiti da quelli nuovi. Una richiesta senza impronta
  // si ferma allo stesso modo: non si sa su quali dati e' stata compilata.
  const vista = (corpo as Record<string, unknown>).versione
  if (typeof vista !== 'string' || !vista || vista !== versioneDatiNegozio(cliente)) {
    return NextResponse.json(DATI_CAMBIATI, { status: 409 })
  }

  const esito = await validaDatiNegozio(corpo as Record<string, unknown>)
  if (!esito.ok) return NextResponse.json({ error: 'Controlla i campi evidenziati.', campi: esito.errori }, { status: 400 })
  const v = esito.valori

  // Le impostazioni si fondono qui, sulla riga appena riletta, senza toccare le altre chiavi (stampa,
  // notifiche, tutorial...): si aggiunge l'email vera e si toglie il segno "da confermare".
  const prima = impostazioniDi(cliente)
  const impostazioni: Record<string, any> = { ...prima, email_contatto: v.email }
  delete impostazioni.sede_da_completare

  // SI SCRIVE SOLO SE NESSUNO HA TOCCATO LA RIGA DOPO LA RILETTURA.
  // L'impronta qui sopra copre il tempo in cui il negoziante compilava; questo filtro copre i
  // millisecondi fra la rilettura e la scrittura. Il master puo' salvare la scheda proprio allora (la
  // sua rotta aggiorna updated_at), e un'altra scheda del portale puo' salvare le impostazioni (Stampa
  // e Notifiche, il tutorial): un aggiornamento cieco cancellerebbe il loro lavoro, e la fusione qui
  // sopra riscriverebbe le impostazioni con la copia letta prima. Se uno dei due e' cambiato non si
  // scrive niente: 409, e la schermata si ricarica. Non si confrontano i singoli campi: i valori vecchi
  // (indirizzo, telefono, codice fiscale) finirebbero nell'indirizzo della richiesta, e da li' nei log.
  // L'uguaglianza fra jsonb e' sul contenuto, non sull'ordine delle chiavi.
  let q = admin.from('clienti').update({
    ragione_sociale: v.ragione_sociale,
    piva: v.piva, cf: v.cf, cod_sdi: v.cod_sdi, pec: v.pec,
    sl_indirizzo: v.sl_indirizzo, sl_citta: v.sl_citta, sl_cap: v.sl_cap, sl_provincia: v.sl_provincia, sl_paese: 'Italia',
    so_indirizzo: v.so_indirizzo, so_citta: v.so_citta, so_cap: v.so_cap, so_provincia: v.so_provincia, so_paese: 'Italia',
    telefono: v.telefono,
    impostazioni,
    updated_at: new Date().toISOString(),
  }).eq('id', clienteId)
  q = cliente.updated_at == null ? q.is('updated_at', null) : q.eq('updated_at', cliente.updated_at)
  q = cliente.impostazioni == null ? q.is('impostazioni', null) : q.eq('impostazioni', JSON.stringify(cliente.impostazioni))

  // Senza .select() PostgREST risponde bene anche quando non ha aggiornato nessuna riga: e' il solo
  // modo di sapere se la scrittura e' avvenuta davvero.
  const { data: scritte, error: eScrittura } = await q.select('id')
  if (eScrittura) {
    // Solo codice e messaggio: il dettaglio di un errore di vincolo riporta la riga, cioe' i dati.
    console.error('[DATI-NEGOZIO] scrittura non riuscita', clienteId, eScrittura.code, eScrittura.message)
    return NextResponse.json({ error: 'Salvataggio non riuscito, riprova fra poco.' }, { status: 500 })
  }
  if (!scritte?.length) return NextResponse.json(DATI_CAMBIATI, { status: 409 })
  return NextResponse.json({ ok: true })
}
