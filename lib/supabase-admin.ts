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
