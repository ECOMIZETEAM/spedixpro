import { createClient } from '@supabase/supabase-js'

// UN SOLO CLIENT DI SERVIZIO PER ISTANZA, non uno per chiamata.
//
// Ogni client nuovo apre le PROPRIE connessioni: la prima richiesta che lo usa paga l'handshake.
// Misurato in produzione sull'elenco spedizioni: il blocco che legge il tipo dei corrieri — a
// database 0,010 ms per riga — costava 240-299 ms su client appena creati e 28-59 ms dove la
// connessione era gia' calda. E una sola rotta creava fino a OTTO client per richiesta.
//
// Riusarlo e' sicuro: e' senza sessione (persistSession/autoRefreshToken spenti), non tiene stato
// per utente e non cambia perimetro — la chiave di servizio scavalca le regole per riga esattamente
// come prima, quindi i controlli a mano nelle rotte restano indispensabili come sempre.
// NB sul TIPO: il client va creato da una funzione e memorizzato come `ReturnType<typeof nuovo>`.
// Annotarlo come `ReturnType<typeof createClient>` sembra equivalente ma NON lo e': createClient e'
// generica, e cosi' annotata perde l'istanza dei tipi delle tabelle — ogni `.from(...)` torna `never`
// e il controllo tipi dell'intera applicazione passa da 52 errori a 1.633. E' successo davvero, qui:
// la modifica era gia' scritta e l'ha fermata il controllo tipi prima del commit.
function nuovo() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

let condiviso: ReturnType<typeof nuovo> | null = null

export function createAdminSupabase() {
  if (!condiviso) condiviso = nuovo()
  return condiviso
}

// ── CLIENT DI SERVIZIO CON MEMORIA, per i ricalcoli di massa (rettifiche da file) ──
//
// Il motore delle rettifiche fa 65 domande al database per ogni spedizione, e 50 di queste sono
// sempre le stesse: zone, listini, contratti, master, clienti. Misurato il 14/10/2026 sul file SDA
// EXPRESS L di LOGIXIA (6.790 spedizioni): lo stesso listino riletto 6.790 volte, un'ora e passa di
// caricamento. Con questo client la stessa domanda, nella stessa richiesta, si fa una volta sola.
//
// SOLO LETTURE (GET) e SOLO tabelle di configurazione: spedizioni e movimenti — cio' che e' stato
// addebitato — si leggono sempre freschi. Un client NUOVO per ogni richiesta, e la memoria muore con
// lui: un listino corretto tra un caricamento e l'altro si vede subito. Si tengono le risposte
// riuscite e i 406 di .single() (stessa domanda, stessa risposta); un errore si richiede ogni volta.
// Ogni lettore riceve una risposta sua, ricostruita dal testo: nessuno puo' modificare i dati di un altro.
const TABELLE_DI_CONFIGURAZIONE = new Set([
  'zone', 'zone_cap', 'corrieri', 'masters', 'clienti',
  'listini_corrieri', 'listini_corrieri_corrieri', 'listini_corrieri_fasce', 'listini_corrieri_supplementi',
  'listini_clienti', 'listini_clienti_corrieri', 'listini_clienti_fasce', 'listini_clienti_supplementi',
])

function nuovoConMemoria() {
  type Risposta = { status: number; statusText: string; headers: [string, string][]; body: string }
  const memoria = new Map<string, Promise<Risposta>>()
  const fetchConMemoria: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const metodo = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const tabella = url.match(/\/rest\/v1\/([^?/]+)/)?.[1]
    if (metodo !== 'GET' || !tabella || !TABELLE_DI_CONFIGURAZIONE.has(tabella)) return fetch(input, init)
    const h = new Headers(init?.headers)
    const chiave = [url, h.get('accept'), h.get('prefer'), h.get('range')].join('|')
    let attesa = memoria.get(chiave)
    if (!attesa) {
      attesa = fetch(input, init).then(async r => ({
        status: r.status, statusText: r.statusText, body: await r.text(),
        // il testo e' gia' decompresso: compressione e lunghezza dell'originale non valgono piu'
        headers: [...r.headers.entries()].filter(([k]) => !/^(content-encoding|content-length|transfer-encoding)$/i.test(k)),
      }))
      memoria.set(chiave, attesa)
      attesa.then(r => { if (!(r.status >= 200 && r.status < 300) && r.status !== 406) memoria.delete(chiave) },
        () => memoria.delete(chiave))
    }
    const r = await attesa
    const senzaCorpo = r.status === 204 || r.status === 205 || r.status === 304
    return new Response(senzaCorpo ? null : r.body, { status: r.status, statusText: r.statusText, headers: r.headers })
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: fetchConMemoria } }
  )
}

export function createAdminSupabaseConMemoria() {
  return nuovoConMemoria()
}
