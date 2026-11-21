import { createBrowserClient, createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { cache } from "react"

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )
}

// LOGIN E PROFILO UNA VOLTA SOLA PER PAGINA, non una per ogni pezzo che la compone.
//
// Aprire una pagina del portale master verificava la sessione TRE volte, ognuna con la sua chiamata
// al server di autenticazione e la sua lettura di `utenti`: il layout, poi getPermessiUtente per il
// menu, poi i layout annidati di Clienti (gerarchia, master, accessi) ancora tramite puoGestireRete.
// Stessa richiesta, stessi cookie, stessa risposta, tre viaggi in fila prima di disegnare la pagina.
//
// `cache` di React tiene il risultato per la durata di UNA richiesta di rendering e lo butta alla
// fine: due utenti non lo condividono mai, e la pagina dopo verifica tutto da capo. Fuori dal
// rendering — nelle rotte API — non tiene niente (React lo memorizza solo dentro una richiesta di
// rendering in corso): li' ogni chiamata rifa' la verifica come prima. Il client che torna e' quello
// della sessione, cosi' anche le letture che seguono lo condividono.
export const sessioneDellaRichiesta = cache(async () => {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
})

// Il profilo della sessione, con le colonne che servono al layout del portale e ai permessi.
// `errore` distingue il guasto momentaneo (chi chiama decide: il layout si ferma, i permessi no)
// dalla riga che non c'e' (utente null, nessun errore).
export const profiloDellaRichiesta = cache(async () => {
  const { supabase, user } = await sessioneDellaRichiesta()
  if (!user) return { supabase, user: null, utente: null, errore: null }
  const { data, error } = await supabase.from('utenti')
    .select('nome,cognome,ruolo,master_id,attivo').eq('id', user.id).maybeSingle()
  return { supabase, user, utente: data, errore: error }
})
