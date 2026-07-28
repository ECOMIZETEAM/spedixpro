import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { inviaRecuperoPassword } from '@/lib/email'

// RECUPERO PASSWORD. Le credenziali dei clienti le crea il master a mano e nessuna email parte
// da sola: chi non le ha mai ricevute o le ha perse non aveva alcun modo di rientrare.
// Il link lo generiamo noi (admin) e lo spediamo con Resend dal dominio verificato, invece di
// affidarci al mailer di Supabase: stesso mittente delle altre email e nessun limite d'invio.
//
// La risposta è SEMPRE identica e SEMPRE immediata, esista o no l'indirizzo: il lavoro vero
// prosegue in background. Rispondere dopo l'elaborazione rendeva gli indirizzi registrati
// riconoscibili dal tempo di risposta, cioè esattamente ciò che il messaggio unico voleva evitare.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const email = String(body?.email || '').trim().toLowerCase()
  const origin = req.nextUrl.origin
  const valida = !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  if (valida) {
    after(async () => {
      try {
        const admin = createAdminSupabase()

        // Freno anti-abuso (rotta pubblica: senza limite si potrebbe far piovere email su un
        // indirizzo altrui). Contatore NOSTRO: la data di Supabase è condivisa con i magic link
        // di "Impersona" e dell'accesso da Shopify, e un recupero legittimo veniva scartato.
        const { data: consentito } = await admin.rpc('puo_inviare_recupero', { p_email: email, p_secondi: 120 })
        if (consentito === false) {
          console.warn('[RECUPERO] richiesta ravvicinata ignorata', { email })
          return
        }

        const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
        // Indirizzo sconosciuto: non è un errore da mostrare, si esce in silenzio.
        if (error || !data?.properties?.hashed_token) {
          console.warn('[RECUPERO] nessun link generato', { email, motivo: error?.message })
          return
        }
        // Link verso una NOSTRA pagina, che verifica il token da sé (come già fanno impersona e
        // l'accesso da Shopify). Usare l'action_link di Supabase lo farebbe passare dalla lista
        // degli indirizzi autorizzati del pannello: se quella non contiene /imposta-password, il
        // token viene consumato e l'utente atterra altrove senza poter cambiare la password.
        const link = `${origin}/imposta-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`
        const esito = await inviaRecuperoPassword({ email, link })
        if (!esito.ok) console.error('[RECUPERO] invio email fallito', { email })
      } catch (e: any) {
        console.error('[RECUPERO] errore', e?.message)
      }
    })
  }

  return NextResponse.json({ ok: true })
}
