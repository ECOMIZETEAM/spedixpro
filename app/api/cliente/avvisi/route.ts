import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// L'AVVISO PER CHI USA LE API.
//
// Va SOLO a chi le API le usa davvero. La stragrande maggioranza dei clienti spedisce dal portale
// e non sa nemmeno che esistano: mandare a loro un messaggio sui pacchetti API vorrebbe dire
// spaventare 580 persone per parlarne a 7, e la prossima volta nessuno leggerebbe piu' niente.
//
// "Usa le API" = ha una chiave attiva e l'ha adoperata almeno una volta. Avere una chiave e non
// averla mai usata non conta: quel cliente non e' interessato, e il messaggio lo confonderebbe.

const AVVISO_API = 'pacchetti-api-2026-08'

async function contesto() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('cliente_id,ruolo').eq('id', user.id).maybeSingle()
  if (!u?.cliente_id || (u.ruolo || '').toLowerCase() !== 'cliente') return null
  return { user, clienteId: u.cliente_id as string, admin: createAdminSupabase() }
}

export async function GET() {
  const ctx = await contesto()
  if (!ctx) return NextResponse.json({ avviso: null })
  const { clienteId, admin } = ctx

  const { data: chiave } = await admin.from('api_keys')
    .select('id').eq('cliente_id', clienteId).neq('attivo', false).not('last_used_at', 'is', null).limit(1).maybeSingle()
  if (!chiave) return NextResponse.json({ avviso: null })

  const { data: visto } = await admin.from('avvisi_visti')
    .select('cliente_id').eq('cliente_id', clienteId).eq('avviso', AVVISO_API).maybeSingle()
  if (visto) return NextResponse.json({ avviso: null })

  // Quanto ha spedito questo mese e quale pacchetto gli servirebbe: un avviso che dice "guarda che
  // cambia qualcosa" senza dire cosa cambia PER TE non serve a niente.
  const { data: stato } = await admin.rpc('fn_stato_api_cliente', { p_cliente: clienteId })
  const { data: piani } = await admin.from('piani_api').select('codice,nome,limite,prezzo').eq('attivo', true).order('ordine')
  return NextResponse.json({ avviso: AVVISO_API, stato: stato || null, piani: piani || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await contesto()
  if (!ctx) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { avviso } = await req.json().catch(() => ({} as any))
  if (avviso !== AVVISO_API) return NextResponse.json({ error: 'Avviso sconosciuto' }, { status: 400 })
  await ctx.admin.from('avvisi_visti')
    .upsert({ cliente_id: ctx.clienteId, avviso: AVVISO_API, visto_da: ctx.user.id }, { onConflict: 'cliente_id,avviso' })
  return NextResponse.json({ success: true })
}
