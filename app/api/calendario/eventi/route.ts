import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { giornoRoma, fineGiornoRomaISO } from '@/lib/date-roma'

// LE TUE VOCI DEL CALENDARIO (promemoria, eventi, riunioni). Tabella calendario_eventi (scripts/calendario-eventi.sql,
// applicato il 25/11/2026): RLS attiva e nessun permesso ad anon e authenticated, quindi la si tocca solo da qui (e dal
// giro degli avvisi), col client di servizio, e ogni lettura e scrittura è legata a utente_id = chi ha la sessione.
// Nessuno legge o cambia le voci di un altro.
// Lo storico non si cancella: «elimina» mette eliminato_il, la riga resta.

const COLONNE = 'id,tipo,titolo,inizio,fine,tutto_il_giorno,luogo,note,avviso_minuti,collegamento,fatto,creato_il'
const TIPI = new Set(['promemoria', 'evento', 'riunione'])

async function chi() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('master_id,cliente_id,ruolo').eq('id', user.id).single()
  return { id: user.id, master_id: u?.master_id || null, cliente_id: u?.cliente_id || null }
}

// controlla e ripulisce quello che arriva dal browser: nessun campo oltre a questi entra nel database
function pulisci(b: any): { ok: true; v: Record<string, any> } | { ok: false; errore: string } {
  const tipo = String(b?.tipo || '')
  if (!TIPI.has(tipo)) return { ok: false, errore: 'Tipo non valido' }
  const titolo = String(b?.titolo || '').trim().slice(0, 200)
  if (!titolo) return { ok: false, errore: 'Scrivi un titolo' }
  const inizio = new Date(b?.inizio)
  if (isNaN(inizio.getTime())) return { ok: false, errore: 'Data non valida' }
  const fine = b?.fine ? new Date(b.fine) : null
  if (fine && (isNaN(fine.getTime()) || fine < inizio)) return { ok: false, errore: 'La fine viene prima dell’inizio' }
  const avviso = b?.avviso_minuti == null ? null : Number(b.avviso_minuti)
  if (avviso != null && (!Number.isInteger(avviso) || avviso < 0 || avviso > 60 * 24 * 7)) return { ok: false, errore: 'Avviso non valido' }
  let collegamento: any = null
  if (b?.collegamento) {
    const c = b.collegamento
    if (c.tipo !== 'spedizione' || !/^[0-9a-f-]{36}$/i.test(String(c.id || ''))) return { ok: false, errore: 'Collegamento non valido' }
    collegamento = { tipo: 'spedizione', id: String(c.id), etichetta: String(c.etichetta || '').slice(0, 200) }
  }
  return {
    ok: true,
    v: {
      tipo, titolo,
      inizio: inizio.toISOString(), fine: fine ? fine.toISOString() : null,
      tutto_il_giorno: !!b?.tutto_il_giorno,
      luogo: b?.luogo ? String(b.luogo).trim().slice(0, 200) || null : null,
      note: b?.note ? String(b.note).trim().slice(0, 4000) || null : null,
      avviso_minuti: avviso,
      collegamento,
      fatto: !!b?.fatto,
    },
  }
}

export async function GET(req: NextRequest) {
  const u = await chi()
  if (!u) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const p = req.nextUrl.searchParams
  const admin = createAdminSupabase()
  let q = admin.from('calendario_eventi').select(COLONNE).eq('utente_id', u.id).is('eliminato_il', null)
  if (p.get('dafare') === '1') {
    // i promemoria ancora da fare fino alla fine di oggi (anche quelli rimasti indietro)
    q = q.eq('tipo', 'promemoria').eq('fatto', false).lte('inizio', fineGiornoRomaISO(giornoRoma())).order('inizio', { ascending: true }).limit(200)
  } else {
    const dal = new Date(p.get('dal') || ''), al = new Date(p.get('al') || '')
    if (isNaN(dal.getTime()) || isNaN(al.getTime()) || al < dal) return NextResponse.json({ error: 'Periodo non valido' }, { status: 400 })
    if ((al.getTime() - dal.getTime()) / 86400000 > 62) return NextResponse.json({ error: 'Periodo troppo lungo' }, { status: 400 })
    // una voce entra se si sovrappone al periodo: comincia prima della fine e finisce (o comincia) dopo l'inizio
    q = q.lt('inizio', al.toISOString())
      // tra virgolette: dentro il filtro «or» le date hanno punti e due punti
      .or(`fine.gte."${dal.toISOString()}",and(fine.is.null,inizio.gte."${dal.toISOString()}")`)
      .order('inizio', { ascending: true }).limit(2000)
  }
  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'Lettura non riuscita: ' + error.message }, { status: 500 })
  return NextResponse.json({ eventi: data || [] })
}

export async function POST(req: NextRequest) {
  const u = await chi()
  if (!u) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await req.json().catch(() => null)
  const r = pulisci(b)
  if (!r.ok) return NextResponse.json({ error: r.errore }, { status: 400 })
  const admin = createAdminSupabase()
  const { data, error } = await admin.from('calendario_eventi')
    .insert({ ...r.v, utente_id: u.id, master_id: u.master_id, cliente_id: u.cliente_id })
    .select(COLONNE).single()
  if (error) return NextResponse.json({ error: 'Salvataggio non riuscito: ' + error.message }, { status: 500 })
  return NextResponse.json({ evento: data })
}

export async function PATCH(req: NextRequest) {
  const u = await chi()
  if (!u) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Voce non valida' }, { status: 400 })
  const b = await req.json().catch(() => null)
  const r = pulisci(b)
  if (!r.ok) return NextResponse.json({ error: r.errore }, { status: 400 })
  const admin = createAdminSupabase()
  // eq utente_id: si cambia solo una voce propria (un id indovinato di un altro non trova righe)
  const { data: prima, error: ePrima } = await admin.from('calendario_eventi')
    .select('inizio,tutto_il_giorno,avviso_minuti')
    .eq('id', id).eq('utente_id', u.id).is('eliminato_il', null).maybeSingle()
  if (ePrima) return NextResponse.json({ error: 'Lettura non riuscita: ' + ePrima.message }, { status: 500 })
  if (!prima) return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
  // l'avviso si riarma solo se cambia QUANDO avvisare: correggere una nota non deve rimandare l'email
  const cambiaMomento = new Date((prima as any).inizio).getTime() !== new Date(r.v.inizio).getTime()
    || (prima as any).tutto_il_giorno !== r.v.tutto_il_giorno || (prima as any).avviso_minuti !== r.v.avviso_minuti
  const { data, error } = await admin.from('calendario_eventi')
    .update({ ...r.v, aggiornato_il: new Date().toISOString(), ...(cambiaMomento ? { avvisato_il: null } : {}) })
    .eq('id', id).eq('utente_id', u.id).is('eliminato_il', null)
    .select(COLONNE).maybeSingle()
  if (error) return NextResponse.json({ error: 'Salvataggio non riuscito: ' + error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
  return NextResponse.json({ evento: data })
}

export async function DELETE(req: NextRequest) {
  const u = await chi()
  if (!u) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Voce non valida' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data, error } = await admin.from('calendario_eventi')
    .update({ eliminato_il: new Date().toISOString() })
    .eq('id', id).eq('utente_id', u.id).is('eliminato_il', null)
    .select('id').maybeSingle()
  if (error) return NextResponse.json({ error: 'Eliminazione non riuscita: ' + error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
