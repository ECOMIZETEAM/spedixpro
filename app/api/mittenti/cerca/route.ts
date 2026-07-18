import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Rubrica MITTENTI: autocomplete sul nominativo. Sorgente = mittenti già usati nelle spedizioni
// del master (da qualsiasi origine), così si popola da sola come la rubrica destinatari.
// Ritorna mittenti distinti, più recenti prima.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json([])

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json([])
  const clienteId = req.nextUrl.searchParams.get('clienteId') || null

  let query = supabase.from('spedizioni')
    .select('mitt_nome,mitt_indirizzo,mitt_citta,mitt_provincia,mitt_cap,mitt_paese,mitt_telefono,mitt_email,created_at')
    .eq('master_id', utente.master_id)
    .ilike('mitt_nome', `${q}%`)
    .order('created_at', { ascending: false })
    .limit(60)
  // Il cliente vede SOLO i propri mittenti; il master può filtrare per cliente selezionato.
  if ((utente.ruolo || '').toLowerCase() === 'cliente') query = query.eq('cliente_id', utente.cliente_id)
  else if (clienteId && !clienteId.startsWith('m:') && clienteId !== '__proprio__') query = query.eq('cliente_id', clienteId)

  const { data } = await query
  // Dedup per nominativo+indirizzo+CAP, tieni il più recente, max 8
  const visti = new Set<string>()
  const out: any[] = []
  for (const s of (data || [])) {
    if (!s.mitt_nome) continue
    const key = `${(s.mitt_nome || '').toLowerCase()}|${(s.mitt_indirizzo || '').toLowerCase()}|${s.mitt_cap || ''}`
    if (visti.has(key)) continue
    visti.add(key)
    out.push({
      nome: s.mitt_nome || '', indirizzo: s.mitt_indirizzo || '', citta: s.mitt_citta || '',
      provincia: s.mitt_provincia || '', cap: s.mitt_cap || '', paese: s.mitt_paese || 'IT',
      telefono: s.mitt_telefono || '', email: s.mitt_email || '',
    })
    if (out.length >= 8) break
  }
  return NextResponse.json(out)
}
