import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // 303 = "See Other": il browser prosegue in GET. Col default (307) ripeteva il POST
    // sulla homepage statica -> 405 "La pagina non funziona" a ogni login sbagliato.
    return NextResponse.redirect(new URL('/?error=credenziali_errate', req.url), 303)
  }

  return NextResponse.redirect(new URL('/dashboard', req.url), 303)
}
