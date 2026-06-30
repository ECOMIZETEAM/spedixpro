import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

function generaPassword(len = 10): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  // Solo un master (non un cliente) può creare un nuovo master
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const body = await req.json()
  const email = body.email?.toLowerCase().trim()
  const nome = body.nome?.trim()

  if (!email) return NextResponse.json({ error: 'Email obbligatoria' }, { status: 400 })
  if (!nome) return NextResponse.json({ error: 'Nome obbligatorio' }, { status: 400 })

  // Verifica email non già usata
  const { data: existingMaster } = await supabase.from('masters').select('id').eq('email', email).single()
  if (existingMaster) return NextResponse.json({ error: 'Email già registrata come master' }, { status: 400 })

  // Crea il nuovo record master, figlio del master corrente
  const { data: nuovoMaster, error: masterError } = await supabase.from('masters').insert({
    nome,
    slug: nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    email,
    telefono: body.telefono || null,
    piva: body.piva || null,
    parent_master_id: utente.master_id,
    is_super_master: false,
    attivo: true,
  }).select().single()

  if (masterError || !nuovoMaster) {
    return NextResponse.json({ error: masterError?.message || 'Errore creazione master' }, { status: 400 })
  }

  // Crea l'utente Auth per il nuovo master
  const password = generaPassword()
  try {
    const admin = createAdminSupabase()
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })

    if (authError || !authUser?.user) {
      // Rollback: elimina il master se non riusciamo a creare l'utente
      await supabase.from('masters').delete().eq('id', nuovoMaster.id)
      return NextResponse.json({ error: authError?.message || 'Errore creazione utente auth' }, { status: 400 })
    }

    await supabase.from('utenti').insert({
      id: authUser.user.id,
      ruolo: 'master',
      master_id: nuovoMaster.id, // il SUO id, non quello del padre
      nome,
      attivo: true,
    })
  } catch (e: any) {
    await supabase.from('masters').delete().eq('id', nuovoMaster.id)
    return NextResponse.json({ error: e.message || 'Errore creazione utente' }, { status: 400 })
  }

  // Invia email con credenziali (riusa la stessa funzione email dei clienti, se compatibile)
  try {
    const { inviaCredenzialiCliente } = await import('@/lib/email')
    await inviaCredenzialiCliente({
      email, nomeCliente: nome, masterNome: 'SpedixPro',
      dominio: 'spedixpro.vercel.app', password,
    })
  } catch (e) {
    console.error('Errore invio email master:', e)
  }

  return NextResponse.json({ id: nuovoMaster.id, password_debug: password })
}
