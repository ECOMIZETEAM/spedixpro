import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

// Rubrica destinatari: autocomplete sul nominativo. DUE sorgenti unite:
//  1) la RUBRICA salvata dal cliente (tabella rubrica_destinatari, anche importata da file) — ha la
//     priorità, sono contatti scelti apposta;
//  2) i destinatari GIÀ SPEDITI (tabella spedizioni, da qualsiasi origine: manuale, CSV, Shopify…),
//     così la rubrica si popola da sola anche senza import.
// La tabella rubrica nega anon/authenticated → si legge via admin (service_role) applicando QUI lo
// stesso perimetro della query spedizioni. Ritorna destinatari distinti, max 8.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
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
  // Il cliente vede SOLO i propri destinatari; il master può filtrare per cliente selezionato.
  if ((utente.ruolo || '').toLowerCase() === 'cliente') query = query.eq('cliente_id', utente.cliente_id)
  else if (isAgente(utente)) {
    // L'agente vede SOLO i destinatari dei SUOI clienti (match per nome). Un clienteId dal browser
    // vale solo se è davvero uno dei suoi; altrimenti restringe a tutti e soli i suoi clienti. Senza
    // questo ramo cadeva sull'else e leggeva la rubrica PII di qualsiasi cliente del master.
    const idsMiei = idClientiPerFiltro(await clientiAgente(supabase, utente))
    if (clienteId && idsMiei.includes(clienteId)) query = query.eq('cliente_id', clienteId)
    else query = query.in('cliente_id', idsMiei)
  }
  else if (clienteId && !clienteId.startsWith('m:') && clienteId !== '__proprio__') query = query.eq('cliente_id', clienteId)

  const { data } = await query

  // RUBRICA salvata (stesso perimetro della query spedizioni), via admin perché la tabella non è
  // leggibile col token dell'utente. Match sul nominativo come per lo storico.
  const admin = createAdminSupabase()
  let rq = admin.from('rubrica_destinatari')
    .select('nome,indirizzo,citta,provincia,cap,paese,telefono,email')
    .ilike('nome', `${q}%`)
    .order('nome', { ascending: true })
    .limit(30)
  if ((utente.ruolo || '').toLowerCase() === 'cliente') rq = rq.eq('cliente_id', utente.cliente_id)
  else if (isAgente(utente)) {
    const idsMiei = idClientiPerFiltro(await clientiAgente(supabase, utente))
    if (clienteId && idsMiei.includes(clienteId)) rq = rq.eq('cliente_id', clienteId)
    else rq = rq.in('cliente_id', idsMiei.length ? idsMiei : ['00000000-0000-0000-0000-000000000000'])
  } else {
    rq = rq.eq('master_id', utente.master_id)
    if (clienteId && !clienteId.startsWith('m:') && clienteId !== '__proprio__') rq = rq.eq('cliente_id', clienteId)
  }
  const { data: rub } = await rq

  // Dedup per nominativo+indirizzo+CAP, max 8. La RUBRICA salvata viene prima (contatti scelti
  // apposta), poi lo storico delle spedizioni riempie i posti rimasti.
  const visti = new Set<string>()
  const out: any[] = []
  const push = (nome: string, indirizzo: string, citta: string, provincia: string, cap: string, paese: string, telefono: string, email: string) => {
    if (out.length >= 8) return
    const key = `${(nome||'').toLowerCase()}|${(indirizzo||'').toLowerCase()}|${cap||''}`
    if (visti.has(key)) return
    visti.add(key)
    out.push({ nome: nome||'', indirizzo: indirizzo||'', citta: citta||'', provincia: provincia||'', cap: cap||'', paese: paese||'IT', telefono: telefono||'', email: email||'' })
  }
  for (const r of (rub || [])) push(r.nome, r.indirizzo, r.citta, r.provincia, r.cap, r.paese, r.telefono, r.email)
  for (const s of (data || [])) push(s.dest_nome, s.dest_indirizzo, s.dest_citta, s.dest_provincia, s.dest_cap, s.dest_paese, s.dest_telefono, s.dest_email)
  return NextResponse.json(out)
}
