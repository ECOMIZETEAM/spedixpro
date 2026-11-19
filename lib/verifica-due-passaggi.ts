// VERIFICA IN DUE PASSAGGI: le regole che servono a piu' porte (middleware, accessi, "entra come").
// La regola vera sta nel database (scripts/verifica-due-passaggi.sql): sessione_verificata() dice se
// una sessione puo' lavorare, e un controllo prima di ogni richiesta ferma chi non puo'. Qui niente
// import lato server: lo usa anche il middleware. I client Supabase arrivano come parametro.

export const CODICE_VERIFICA = 'verifica_due_passaggi'
export const PAGINA_VERIFICA = '/accesso/verifica'

// Le rotte che servono PROPRIO a chi deve ancora mettere il codice: entrare, uscire, sapere a che
// punto e'. Tutte le altre, con una sessione non verificata, rispondono 403.
export const API_SENZA_VERIFICA = ['/api/auth/', '/api/accesso/']

// L'errore che il database alza (SQLSTATE PT403) quando la sessione non ha messo il codice.
export function bloccataDallaVerifica(err: any): boolean {
  return !!err && (err.code === 'PT403' || err.message === CODICE_VERIFICA)
}

// PASSWORD DA CAMBIARE (scaduta dopo 12 mesi, o vecchia e fuori regola: scripts/password-regole.sql).
export const CODICE_CAMBIO_PASSWORD = 'cambio_password'
export const PAGINA_CAMBIO_PASSWORD = '/imposta-password'

// La sessione puo' lavorare? Una domanda sola al database per la verifica e per la password:
// 'codice' (manca il codice), 'password_scaduta' / 'password_regole', 'ok'; null se non si sa
// (token scaduto, database giu': decide la rotta). Se stato_sessione non c'e' ancora (script non
// applicato) si torna alla domanda di prima, solo sulla verifica.
export async function statoSessione(sb: any): Promise<{ stato: string | null; errore: any }> {
  const r = await sb.rpc('stato_sessione')
  if (r.error?.code === 'PGRST202') {
    const v = await sb.rpc('sessione_verificata')
    return { stato: v.error ? null : v.data === false ? 'codice' : 'ok', errore: v.error }
  }
  return { stato: r.error ? null : (r.data as string | null), errore: r.error }
}

// BLOCCO DOPO 10 PASSWORD SBAGLIATE IN 15 MINUTI (DPP Amazon 1.2.2). Per indirizzo: e' l'account che
// si protegge, non la rete da cui arriva il tentativo. Un accesso riuscito azzera il conto, quindi
// contano i tentativi CONSECUTIVI. Le righe hanno solo indirizzo e ora.
const TENTATIVI_MAX = 10
const FINESTRA_MIN = 15

export async function accessoFermato(admin: any, email: string): Promise<boolean> {
  const dal = new Date(Date.now() - FINESTRA_MIN * 60_000).toISOString()
  const { count, error } = await admin.from('accessi_falliti')
    .select('id', { count: 'exact', head: true }).eq('email', email).gte('quando', dal)
  // Se il conto non si legge non si chiude fuori nessuno: la protezione vera e' il codice.
  if (error) { console.error('[ACCESSO] tentativi non letti:', error.message); return false }
  return (count || 0) >= TENTATIVI_MAX
}

// Ogni accesso, riuscito o no, va anche nel registro accessi (13 mesi, DPP Amazon 2.6.1): le righe di
// accessi_falliti servono al blocco e si cancellano al primo accesso riuscito, quindi da sole non
// raccontano chi ha provato cosa. `porta` dice da dove: 'portale', 'clienti', 'shopify'.
// Nel registro niente indirizzo in chiaro: quello di un tentativo fallito si maschera (lo***@gmail.com).
export async function segnaAccessoFallito(admin: any, email: string, porta: string): Promise<void> {
  const [a, b] = await Promise.all([
    admin.from('accessi_falliti').insert({ email }),
    admin.from('audit_accessi').insert({ azione: 'accesso_fallito', risorsa: porta, dettaglio: emailMascherata(email) }),
  ])
  if (a.error) console.error('[ACCESSO] tentativo non registrato:', a.error.message)
  if (b.error) console.error('[ACCESSO] tentativo non scritto nel registro accessi:', b.error.message)
}

export async function azzeraAccessiFalliti(admin: any, email: string, utenteId: string, porta: string): Promise<void> {
  const [a, b] = await Promise.all([
    admin.from('accessi_falliti').delete().eq('email', email),
    admin.from('audit_accessi').insert({ utente_id: utenteId, azione: 'accesso', risorsa: porta }),
  ])
  if (a.error) console.error('[ACCESSO] tentativi non azzerati:', a.error.message)
  if (b.error) console.error('[ACCESSO] accesso non scritto nel registro accessi:', b.error.message)
}

// Stessa regola di public.email_mascherata (scripts/allarmi-sicurezza.sql).
export function emailMascherata(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, Math.min(2, at)) + '***' + email.slice(at) : '***'
}

export const MESSAGGIO_FERMATO = `Troppi tentativi sbagliati: per sicurezza l'accesso e' sospeso per ${FINESTRA_MIN} minuti.`

// "ENTRA COME": la sessione aperta a nome di un altro (cliente, agente, master) non puo' avere il
// codice di quella persona. La rotta che la apre si raggiunge solo con una sessione verificata, e la
// registra qui: il database la lascia lavorare per otto ore.
export async function registraEntraCome(admin: any, accessToken: string | undefined, daUtenteId: string): Promise<void> {
  const claims = leggiToken(accessToken)
  if (!claims?.session_id || !claims?.sub) {
    console.error('[ENTRA-COME] sessione senza session_id: non registrata')
    return
  }
  const { error } = await admin.from('sessioni_entra_come').insert({
    session_id: claims.session_id, utente_id: claims.sub, da_utente_id: daUtenteId,
    scade_il: new Date(Date.now() + 8 * 3600_000).toISOString(),
  })
  if (error) console.error('[ENTRA-COME] sessione non registrata:', error.message)
}

// Solo per leggere session_id e sub del token APPENA ricevuto da Supabase: non e' una verifica.
function leggiToken(token: string | undefined): any {
  try {
    const parte = String(token || '').split('.')[1]
    // atob e non Buffer: questo file lo carica anche il middleware, che gira dove Buffer non c'e'.
    return JSON.parse(atob(parte.replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}
