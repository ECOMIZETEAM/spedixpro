import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Intestazione del report (dati del MASTER loggato): ragione sociale, indirizzo, email, PIVA, logo.
// Sono i SUOI dati (nessun leak): servono a stampare l'header dei PDF come Spedisci.online.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({})
  const { data: u } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!u?.master_id) return NextResponse.json({})
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters')
    .select('nome,indirizzo,cap,citta,provincia,indirizzo_fatturazione,cap_fatturazione,citta_fatturazione,provincia_fatturazione,email,email_sede,partita_iva,piva,logo_url')
    .eq('id', u.master_id).maybeSingle()
  if (!m) return NextResponse.json({})
  const g = (a: any, b: any) => (a ?? b) || ''
  const via = g(m.indirizzo_fatturazione, m.indirizzo)
  const cap = g(m.cap_fatturazione, m.cap)
  const citta = g(m.citta_fatturazione, m.citta)
  const prov = g(m.provincia_fatturazione, m.provincia)
  // Riga indirizzo nello stile dell'esempio: "VIA ..., 81055 , SANTA MARIA CAPUA VETERE, CE"
  const indirizzo = [via, cap, [citta, prov].filter(Boolean).join(', ')].filter(Boolean).join(', ')
  return NextResponse.json({
    nome: m.nome || '',
    indirizzo,
    email: g(m.email, m.email_sede),
    piva: g(m.partita_iva, m.piva),
    logo_url: m.logo_url || null,
  })
}
