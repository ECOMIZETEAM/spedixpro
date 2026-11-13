import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { MESSAGGIO_FERMATO, accessoFermato, azzeraAccessiFalliti, segnaAccessoFallito } from '@/lib/verifica-due-passaggi'
import { controllaPasswordAlLogin } from '@/lib/password-cambio'

// ACCESSO portale cliente.
// Come per l'area master: i cookie della sessione vanno scritti SULLA RESPONSE che torniamo,
// altrimenti la prima pagina caricata dopo l'accesso viene resa senza utente e il portale
// compare senza sidebar (il layout, non trovando il cliente, mostra solo il contenuto).
export async function POST(req: NextRequest) {
  const body = await req.json()
  // Stessa normalizzazione dell'accesso master: spazi e maiuscole non devono bloccare nessuno.
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')

  const ok = NextResponse.json({ ok: true, vai: '/cliente/dashboard' })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => ok.cookies.set(name, value, options))
        },
      },
    }
  )

  const admin = createAdminSupabase()
  if (await accessoFermato(admin, email)) {
    console.warn('[LOGIN][CLIENTE][FERMATO]', { email, motivo: 'troppi tentativi' })
    return NextResponse.json({ error: MESSAGGIO_FERMATO }, { status: 429 })
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.warn('[LOGIN][CLIENTE][FALLITO]', { email, motivo: error.message })
    await segnaAccessoFallito(admin, email, 'clienti')
    return NextResponse.json({ error: 'Email o password non corretti' }, { status: 401 })
  }
  await azzeraAccessiFalliti(admin, email, data.user.id, 'clienti')
  // Con la chiave di servizio, come nell'accesso master: con la sola password, chi ha attivato la
  // verifica in due passaggi non legge niente dal database finche' non mette il codice.
  const { data: utente } = await admin.from('utenti').select('ruolo,cliente_id,attivo,nome,cognome').eq('id', data.user.id).single()
  // "Account Attivo" della scheda cliente non veniva letto da nessuna parte: un cliente messo
  // su OFF dal master (moroso, cessato) entrava lo stesso e continuava a spedire a credito.
  const { data: cliente } = utente?.cliente_id
    ? await admin.from('clienti').select('attivo').eq('id', utente.cliente_id).maybeSingle()
    : { data: null }
  if (utente?.attivo === false || cliente?.attivo === false) {
    console.warn('[LOGIN][CLIENTE][BLOCCATO]', { email, motivo: 'account disattivato' })
    await supabase.auth.signOut({ scope: 'local' })
    return NextResponse.json({ error: 'Account non attivo. Contatta il tuo referente.' }, { status: 403 })
  }
  if (!utente) {
    // Autenticato ma senza riga in `utenti`: account monco, non si entra da nessuna parte.
    await supabase.auth.signOut({ scope: 'local' })
    return NextResponse.json({ error: 'Accesso non autorizzato' }, { status: 403 })
  }
  // Password scaduta (12 mesi) o vecchia e fuori regola: si segna qui, l'unico momento in cui la
  // password passa in chiaro; il cambio lo chiede il middleware alla prima pagina, dopo il codice.
  await controllaPasswordAlLogin(admin, { id: data.user.id, email, nome: utente.nome, cognome: utente.cognome }, password)
  if (!utente.cliente_id) {
    // NON e' un cliente ma STAFF (master, admin, operatore, agente): le credenziali sono valide,
    // ha solo sbagliato portale. Prima rispondevamo "Accesso non autorizzato" e chiudevamo la
    // sessione: chi ha due account (es. lo stesso titolare che e' agente E cliente) si convinceva
    // che le credenziali fossero sbagliate. Ora lo lasciamo entrare e lo mandiamo nella SUA area:
    // il middleware fa comunque rispettare i confini fra i due portali.
    console.warn('[LOGIN][CLIENTE][E-STAFF]', { email, ruolo: utente.ruolo })
    const staff = NextResponse.json({ ok: true, vai: '/dashboard' })
    ok.cookies.getAll().forEach((c) => staff.cookies.set(c))
    return staff
  }
  return ok
}
