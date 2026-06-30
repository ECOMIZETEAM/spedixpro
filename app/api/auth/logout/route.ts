import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/', req.url))
}
