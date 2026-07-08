import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Rubrica destinatari: autocomplete sul nominativo. Sorgente = destinatari già spediti
// dal master (da qualsiasi origine: manuale, CSV, Shopify, eBay, Woo, PrestaShop),
// così si popola da sola. Ritorna destinatari distinti, più recenti prima.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json([])

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json([])
  const clienteId = req.nextUrl.searchParams.get('clienteId') || null

  let query = supabase.from('spedizioni')
    .select('dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_cap,dest_paese,dest_telefono,dest_email,created_at')
    .eq('master_id', utente.master_id)
    .ilike('dest_nome', `${q}%`)
    .order('created_at', { ascending: false })
    .limit(60)
  if (clienteId && !clienteId.startsWith('m:') && clienteId !== '__proprio__') query = query.eq('cliente_id', clienteId)

  const { data } = await query
  // Dedup per nominativo+indirizzo+CAP, tieni il più recente, max 8
  const visti = new Set<string>()
  const out: any[] = []
  for (const s of (data || [])) {
    const key = `${(s.dest_nome||'').toLowerCase()}|${(s.dest_indirizzo||'').toLowerCase()}|${s.dest_cap||''}`
    if (visti.has(key)) continue
    visti.add(key)
    out.push({
      nome: s.dest_nome || '', indirizzo: s.dest_indirizzo || '', citta: s.dest_citta || '',
      provincia: s.dest_provincia || '', cap: s.dest_cap || '', paese: s.dest_paese || 'IT',
      telefono: s.dest_telefono || '', email: s.dest_email || '',
    })
    if (out.length >= 8) break
  }
  return NextResponse.json(out)
}
