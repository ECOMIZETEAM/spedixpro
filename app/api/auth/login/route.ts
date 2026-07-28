import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  // Email normalizzata: dal telefono arriva spesso con la maiuscola iniziale o uno spazio in
  // coda (correttore automatico) e l'accesso falliva senza che l'utente potesse capire perché.
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Tracciato: prima successo ed errore rispondevano entrambi 303 e dai log non si
    // distingueva un accesso riuscito da uno fallito. Nel log solo l'indirizzo, mai la password.
    console.warn('[LOGIN][FALLITO]', { email, motivo: error.message })
    // 303 = "See Other": il browser prosegue in GET. Col default (307) ripeteva il POST
    // sulla homepage statica -> 405 "La pagina non funziona" a ogni login sbagliato.
    return NextResponse.redirect(new URL('/?error=credenziali_errate', req.url), 303)
  }

  return NextResponse.redirect(new URL('/dashboard', req.url), 303)
}
