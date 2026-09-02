import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { gestisceLaRete } from '@/lib/ruoli'

// Impersona un AGENTE proprio: il master "entra" nel portale del suo agente per vedere ESATTAMENTE
// cosa vede lui (sola lettura, solo i suoi clienti) — come gia' fa con i clienti e i sotto-master.
//
// Confini: puo' farlo solo chi GESTISCE la rete (master/admin/operatore), e SOLO sui propri agenti
// (stesso master_id). L'agente e' gia' un utente reale (riga utenti + account auth), quindi qui non
// si crea nulla: si fa soltanto il login come lui. Si entra sempre e solo nel proprio staff, mai altrui.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // La response di redirect porta i cookie della nuova sessione (dashboard agente al primo render).
  const okRedirect = NextResponse.redirect(new URL('/dashboard', req.url))
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => okRedirect.cookies.set(name, value, options))
        },
      },
    }
  )

  // Le uscite d'errore DOPO il signOut devono portarsi dietro i cookie scritti su okRedirect: senza,
  // il master resta con i cookie di una sessione ormai revocata e viene sbattuto al login.
  const vaiA = (path: string) => {
    const r = NextResponse.redirect(new URL(path, req.url))
    okRedirect.cookies.getAll().forEach((c) => r.cookies.set(c))
    return r
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/', req.url))

  const { data: utente } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  // Impersonare e' un'azione da chi gestisce la rete: non il cliente, non l'agente, non l'autista.
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  const { id } = await params
  const admin = createAdminSupabase()
  // Il target dev'essere un AGENTE dello STESSO master: si entra solo nel proprio staff.
  const { data: target } = await admin.from('utenti')
    .select('id,ruolo,master_id').eq('id', id).maybeSingle()
  if (!target || (target.ruolo || '').toLowerCase() !== 'agente' || target.master_id !== utente.master_id) {
    return NextResponse.redirect(new URL('/dashboard/impostazioni/staff?error=non_autorizzato', req.url))
  }

  // Email di login reale dell'agente (auth.users): robusta anche se disallineata altrove.
  const { data: au } = await admin.auth.admin.getUserById(target.id)
  const email = au?.user?.email
  if (!email) {
    return NextResponse.redirect(new URL('/dashboard/impostazioni/staff?error=email_mancante', req.url))
  }

  // scope 'local': con il default 'global' si revocherebbero TUTTE le sessioni del master, comprese
  // quelle su altri dispositivi che con l'impersonazione non c'entrano.
  await supabase.auth.signOut({ scope: 'local' })

  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !linkData?.properties?.hashed_token) {
    return vaiA('/dashboard/impostazioni/staff?error=impersonazione_fallita')
  }
  const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink', token_hash: linkData.properties.hashed_token,
  })
  if (verifyError || !sessionData.session) {
    return vaiA('/dashboard/impostazioni/staff?error=sessione_non_creata')
  }

  const { registraAudit } = await import('@/lib/audit')
  await registraAudit({ utenteId: user.id, azione: 'impersona_agente', risorsa: id })
  return okRedirect
}
