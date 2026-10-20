import { recapitoEmail } from '@/lib/indirizzi-interni'

// L'ACCESSO DI UN CLIENTE: la sua riga in `utenti` e l'utente di autenticazione che le corrisponde.
//
// Per entrare al posto di un cliente (impersona del master, accesso automatico da Shopify) si usa
// l'email EFFETTIVA del login, letta da auth.users, non clienti.email: e' robusta anche se
// clienti.email e' disallineata o non valida, e non crea utenti fantasma. Il magic link chiesto per
// un'email che non ha un utente non fallisce: generateLink 'magiclink' crea l'utente (lo dice la
// libreria: "handles the creation of the user for signup, invite and magiclink"), senza riga in
// `utenti` — un portale senza menu. Il 19/10 26 clienti attivi su 1.894 non avevano un utente con la
// stessa email del cliente (NMC-14).
//
// Si legge la riga col ruolo 'cliente' (il 20/10 tutte le 1.878 righe con cliente_id lo erano, e
// nessun cliente ne aveva due) e, se mai ce ne fossero due, la piu' recente: e' quella che una
// riparazione dell'accesso ha appena creato, mentre una piu' vecchia puo' puntare a un utente di
// autenticazione che non c'e' piu'.
//
// I tre esiti restano distinti perche' chi DECIDE qualcosa sull'accesso (l'installazione Shopify, che
// lo crea oppure rifiuta il conto: lib/shopifyProvision.ts) non puo' prendere una lettura fallita per
// «nessun accesso». Chi deve solo entrare usa accessoDelCliente, qui sotto.
export type LetturaAccesso =
  | { esito: 'presente'; utenteId: string; email: string }
  | { esito: 'assente'; anomalia?: string }
  | { esito: 'illeggibile'; motivo: string }

export async function leggiAccessoDelCliente(admin: any, clienteId: string): Promise<LetturaAccesso> {
  const { data: u, error } = await admin.from('utenti').select('id')
    .eq('cliente_id', clienteId).eq('ruolo', 'cliente')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return { esito: 'illeggibile', motivo: `lettura utenti: ${error.message}` }
  if (!u?.id) return { esito: 'assente' }
  const { data: au, error: aErr } = await admin.auth.admin.getUserById(u.id)
  // La riga c'e' ma il suo utente di autenticazione e' stato cancellato: con quella riga non entra
  // nessuno, quindi l'accesso non c'e' (e chi lo ripara ne crea uno nuovo). Ogni altro errore resta un
  // «non so».
  if (aErr?.code === 'user_not_found' || aErr?.status === 404) {
    return { esito: 'assente', anomalia: 'riga utenti senza utente di autenticazione' }
  }
  const email = String(au?.user?.email || '').trim().toLowerCase()
  if (aErr || !email) return { esito: 'illeggibile', motivo: `utente di autenticazione: ${aErr?.message || 'email vuota'}` }
  return { esito: 'presente', utenteId: u.id, email }
}

export async function accessoDelCliente(admin: any, clienteId: string): Promise<{ utenteId: string; email: string } | null> {
  const a = await leggiAccessoDelCliente(admin, clienteId)
  if (a.esito === 'presente') return { utenteId: a.utenteId, email: a.email }
  const nota = a.esito === 'illeggibile' ? a.motivo : a.anomalia
  if (nota) console.error('[ACCESSO CLIENTE]', clienteId, nota)
  return null
}

// UN ACCESSO NUOVO NASCE SOLO SU UN INDIRIZZO VERO.
//
// Un utente di login su un indirizzo inventato da noi (lib/indirizzi-interni.ts) e' un accesso che non
// controlla nessuno: il recupero nativo di Supabase (/auth/v1/recover con la chiave pubblica) non passa
// dal nostro codice e spedisce il link a quell'indirizzo, quindi entra chi ne riceve la posta. Su
// moovexpress.app, che non e' nostro, e' chiunque lo registri: il 20/10 DL-TEST di LOGIXIA (a fattura,
// senza accesso, email sul dominio vecchio) aveva il pulsante «Accedi», che glielo avrebbe creato con
// un clic. Restituisce l'indirizzo su cui creare l'accesso, oppure null se non se ne crea nessuno.
// L'unica eccezione e' il conto nato dall'installazione Shopify (assicuraAccesso in
// lib/shopifyProvision.ts): il suo accesso sta per forza sull'indirizzo del negozio, sul sottodominio
// nostro senza posta, e il negoziante entra solo con l'accesso automatico.
export function emailPerNuovoAccesso(email: string | null | undefined): string | null {
  return recapitoEmail(email) || null
}
