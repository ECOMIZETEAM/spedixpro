import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// ACCESSO area master/staff.
// I cookie della nuova sessione vengono scritti DIRETTAMENTE sulla response di redirect.
// Prima si usava il client basato su cookies() di next/headers: i cookie non finivano sulla
// response costruita a mano, quindi la PRIMA pagina dopo l'accesso veniva resa SENZA utente e
// la sidebar non compariva (ricaricando sì, perché a quel punto il cookie c'era). Stesso
// accorgimento già adottato nelle rotte di impersonazione.
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  // Email normalizzata: dal telefono arriva spesso con la maiuscola iniziale o uno spazio in
  // coda (correttore automatico) e l'accesso falliva senza che l'utente potesse capire perché.
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')

  // 303 = "See Other": il browser prosegue in GET. Col default (307) ripeteva il POST
  // sulla homepage statica -> 405 "La pagina non funziona" a ogni login sbagliato.
  const ok = NextResponse.redirect(new URL('/dashboard', req.url), 303)
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
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Tracciato: prima successo ed errore rispondevano entrambi 303 e dai log non si
    // distingueva un accesso riuscito da uno fallito. Nel log solo l'indirizzo, mai la password.
    console.warn('[LOGIN][FALLITO]', { email, motivo: error.message })
    return NextResponse.redirect(new URL('/?error=credenziali_errate', req.url), 303)
  }

  // "Account attivo" e' un interruttore che il master usa davvero (staff che se ne va, cliente
  // moroso) ma che nessuno leggeva: chi veniva disattivato continuava a entrare con tutti i suoi
  // permessi. Qui vale anche per gli account autenticati senza riga in `utenti`, che altrimenti
  // arrivavano alla dashboard con i ripieghi permissivi del layout.
  const { data: utente } = await supabase.from('utenti').select('attivo,cliente_id').eq('id', data.user.id).single()
  // Anche la scheda cliente deve essere attiva: altrimenti un cliente disattivato entrava lo stesso
  // passando da questo modulo, e il middleware lo portava tranquillamente al suo portale.
  const { data: cliente } = utente?.cliente_id
    ? await supabase.from('clienti').select('attivo').eq('id', utente.cliente_id).maybeSingle()
    : { data: null }
  if (!utente || utente.attivo === false || cliente?.attivo === false) {
    console.warn('[LOGIN][BLOCCATO]', { email, motivo: !utente ? 'nessuna riga in utenti' : 'account disattivato' })
    await supabase.auth.signOut({ scope: 'local' })
    return NextResponse.redirect(new URL('/?error=account_non_attivo', req.url), 303)
  }

  return ok
}
