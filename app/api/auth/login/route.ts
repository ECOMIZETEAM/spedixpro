import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return NextResponse.redirect(new URL('/?error=credenziali_errate', req.url))
  }

  return NextResponse.redirect(new URL('/dashboard', req.url))
}
