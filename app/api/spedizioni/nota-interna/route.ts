import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// APPUNTI DEL MASTER su una spedizione: roba sua, che NON viaggia.
//
// Non vanno al corriere, non finiscono sull'etichetta, non li vede il cliente. Per questo NON stanno
// nelle colonne `contenuto`/`note` della spedizione: quelle sono i dati DICHIARATI dal cliente, che
// partono col pacco (istruzioni al corriere, contenuto stampato sulla LDV e usato in dogana).
// Scriverci sopra gli appunti del master cambierebbe l'etichetta ristampata e il documento doganale.
//
// Tabella separata `spedizioni_note_master`: `anon` e `authenticated` non la toccano (grant revocati,
// RLS attiva), quindi nessuna rotta PostgREST la raggiunge — nemmeno una che nascera' domani. Si passa
// solo da qui, e i controlli di perimetro si rifanno A MANO perche' la chiave di servizio scavalca le
// regole per riga.
async function perimetro(spedizioneId: string) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const bloccoAg = bloccaAgente(utente); if (bloccoAg) return { errore: bloccoAg }   // agente = sola lettura
  // Il RUOLO, non la sola appartenenza: master_id ce l'hanno anche i clienti.
  if (!gestisceLaRete(utente)) return { errore: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  if (!spedizioneId) return { errore: NextResponse.json({ error: 'spedizioneId mancante' }, { status: 400 }) }

  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni').select('id,master_id').eq('id', spedizioneId).maybeSingle()
  if (!sped) return { errore: NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 }) }
  // Appunti del master CREATORE: quelli di un altro master non si leggono e non si scrivono.
  if ((sped as any).master_id !== utente!.master_id)
    return { errore: NextResponse.json({ error: 'Non e\' una tua spedizione' }, { status: 403 }) }
  return { admin, user, masterId: utente!.master_id as string }
}

export async function GET(req: NextRequest) {
  const spedizioneId = new URL(req.url).searchParams.get('spedizione_id') || ''
  const p = await perimetro(spedizioneId)
  if (p.errore) return p.errore
  const { data } = await p.admin!.from('spedizioni_note_master')
    .select('contenuto,note,updated_at').eq('spedizione_id', spedizioneId).maybeSingle()
  return NextResponse.json({ contenuto: data?.contenuto || '', note: data?.note || '', updated_at: data?.updated_at || null })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const spedizioneId = body?.spedizioneId || body?.spedizione_id || ''
  const p = await perimetro(spedizioneId)
  if (p.errore) return p.errore

  const contenuto = String(body?.contenuto ?? '').trim().slice(0, 2000)
  const note = String(body?.note ?? '').trim().slice(0, 2000)
  const { error } = await p.admin!.from('spedizioni_note_master').upsert({
    spedizione_id: spedizioneId, master_id: p.masterId, contenuto: contenuto || null, note: note || null,
    updated_at: new Date().toISOString(), updated_by: p.user!.id,
  }, { onConflict: 'spedizione_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, contenuto, note })
}
