import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaAgente } from '@/lib/agente'

// GLI AUTISTI DEL CIRCUITO INTERNO.
//
// Un autista e' legato a una ZONA: e' su quella che gli arrivano i ritiri e le consegne. La zona
// e' la stessa entita' che gia' regge i prezzi (zone + zone_cap), quindi chi ha gia' disegnato le
// sue zone di consegna non deve ridisegnarle qui.
//
// Non si cancella nessuno: un autista che se ne va si disattiva, altrimenti sparirebbe dalle
// consegne che ha fatto e il registro di chi ha portato cosa non tornerebbe piu'.

async function contesto(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  return { user, utente, admin: createAdminSupabase() }
}

export async function GET(req: NextRequest) {
  const ctx = await contesto(req)
  if (ctx instanceof NextResponse) return ctx
  const { utente, admin } = ctx
  // L'agente non c'entra con gli autisti: non li gestisce e non deve vedere l'organizzazione
  // interna del master (chi guida dove). Stessa cosa per l'autista stesso.
  const r = (utente.ruolo || '').toLowerCase()
  if (r === 'agente' || r === 'autista') return NextResponse.json({ autisti: [], zone: [] })
  const { data } = await admin.from('autisti')
    .select('id,nome,telefono,email,zona_id,attivo,note,created_at,zone(nome)')
    .eq('master_id', utente.master_id).order('attivo', { ascending: false }).order('nome')
  // Le zone del master: servono per assegnare l'autista, e sono le stesse dei prezzi.
  const { data: zone } = await admin.from('zone').select('id,nome,corriere_id').eq('master_id', utente.master_id).order('nome')
  return NextResponse.json({ autisti: data || [], zone: zone || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await contesto(req)
  if (ctx instanceof NextResponse) return ctx
  const { utente, admin } = ctx
  const _b = bloccaAgente(utente); if (_b) return _b        // agente = sola lettura
  const b = await req.json()
  const nome = String(b?.nome || '').trim()
  if (!nome) return NextResponse.json({ error: 'Il nome è obbligatorio' }, { status: 400 })

  // La zona arriva dal browser: dev'essere una TUA, altrimenti si aggancia l'autista a una zona
  // di un altro master — che poi torna col suo nome nell'elenco, ed e' un dato che non e' tuo.
  let zonaId: string | null = b?.zona_id || null
  if (zonaId) {
    const { data: z } = await admin.from('zone').select('id').eq('id', zonaId).eq('master_id', utente.master_id).maybeSingle()
    if (!z) zonaId = null
  }

  const campi = {
    nome,
    telefono: String(b?.telefono || '').trim() || null,
    email: String(b?.email || '').trim() || null,
    zona_id: zonaId,
    note: String(b?.note || '').trim() || null,
    attivo: b?.attivo !== false,
  }

  if (b?.id) {
    // eq su master_id: un id che arriva dal browser non basta a dire che l'autista e' tuo.
    const { error } = await admin.from('autisti').update(campi).eq('id', b.id).eq('master_id', utente.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, id: b.id })
  }
  const { data, error } = await admin.from('autisti')
    .insert({ ...campi, master_id: utente.master_id }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data?.id })
}
