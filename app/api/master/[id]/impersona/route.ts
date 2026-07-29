import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Impersona un master DISCENDENTE (solo discesa nella catena).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // La response di redirect porta i cookie della nuova sessione (sidebar subito).
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

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/', req.url))

  const { data: utente } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  if (!utente || utente.ruolo !== 'master') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }
  const { id } = await params
  const admin = createAdminSupabase()
  // Impersonare un sotto-master = "entrare" nella sua rete: consentito SOLO ai master
  // con visibilità completa (root / vede_rete_completa). Rete privata per gli altri.
  const { masterVedeReteCompleta } = await import('@/lib/rete-masters')
  if (!utente.master_id || !(await masterVedeReteCompleta(admin, utente.master_id))) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // Verifica catena: risalgo dal target; il mio master deve essere un antenato
  let cur: string | null = id
  let inCatena = false
  for (let i = 0; i < 20 && cur; i++) {
    const { data: m } = await admin.from('masters').select('id,parent_master_id').eq('id', cur).maybeSingle()
    if (!m) break
    if (m.parent_master_id === utente.master_id) { inCatena = true; break }
    cur = m.parent_master_id
  }
  if (!inCatena) {
    return NextResponse.redirect(new URL('/dashboard/clienti/master?error=non_autorizzato', req.url))
  }

  // Utente master del target
  const { data: targetUser } = await admin.from('utenti')
    .select('id').eq('master_id', id).eq('ruolo', 'master').limit(1).maybeSingle()
  if (!targetUser) {
    return NextResponse.redirect(new URL('/dashboard/clienti/master?error=utente_master_mancante', req.url))
  }
  const { data: au } = await admin.auth.admin.getUserById(targetUser.id)
  const email = au?.user?.email
  if (!email) {
    return NextResponse.redirect(new URL('/dashboard/clienti/master?error=email_mancante', req.url))
  }

  // scope 'local': con il default 'global' si revocavano TUTTE le sessioni del master, comprese
  // quelle su altri dispositivi che con l'impersonazione non c'entrano.
  await supabase.auth.signOut({ scope: 'local' })

  // Dopo il signOut le uscite d'errore devono portarsi dietro i cookie scritti su okRedirect,
  // altrimenti il master resta con cookie di una sessione revocata e viene sbattuto al login.
  const vaiA = (path: string) => {
    const r = NextResponse.redirect(new URL(path, req.url))
    okRedirect.cookies.getAll().forEach((c) => r.cookies.set(c))
    return r
  }

  const { data: linkData, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !linkData?.properties?.hashed_token) {
    return vaiA('/dashboard/clienti/master?error=impersonazione_fallita')
  }
  const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink', token_hash: linkData.properties.hashed_token,
  })
  if (verifyError || !sessionData.session) {
    return vaiA('/dashboard/clienti/master?error=sessione_non_creata')
  }
  const { registraAudit } = await import('@/lib/audit')
  await registraAudit({ utenteId: user.id, ruolo: 'master', azione: 'impersona_master', risorsa: id })
  return okRedirect
}
