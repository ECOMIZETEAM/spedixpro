import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { gestisceLaRete } from '@/lib/ruoli'
import { ricorrenzaValida } from '@/lib/calendario-ricorrenza'
import { vociNelPeriodo, promemoriaDaFare, COLONNE_EVENTO } from '@/lib/calendario-server'

// LE TUE VOCI DEL CALENDARIO (promemoria, eventi, riunioni), anche quelle che si ripetono, e quelle a cui sei invitato.
// Tabelle calendario_eventi e calendario_inviti (scripts/calendario-eventi.sql, scripts/calendario-fase2.sql): RLS
// attiva e nessun permesso ad anon e authenticated, quindi le si tocca solo da qui (e dal giro degli avvisi), col
// client di servizio, e ogni scrittura è legata a utente_id = chi ha la sessione: nessuno cambia le voci di un altro.
// Lo storico non si cancella: «elimina» mette eliminato_il, la riga resta.
//
// INVITI (Lorenzo 25/11): li crea solo lo staff del master (titolare, admin, operatore), su eventi e riunioni; si
// invitano staff, agenti e clienti DELLO STESSO MASTER. Chi è invitato non vede gli altri invitati né la spedizione
// collegata (lib/calendario-server).

const TIPI = new Set(['promemoria', 'evento', 'riunione'])
const RUOLI_INVITABILI = ['master', 'admin', 'operatore', 'agente', 'cliente']
const UUID = /^[0-9a-f-]{36}$/i

async function chi() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('master_id,cliente_id,ruolo').eq('id', user.id).single()
  return { id: user.id, master_id: u?.master_id || null, cliente_id: u?.cliente_id || null, ruolo: String(u?.ruolo || '') }
}

// controlla e ripulisce quello che arriva dal browser: nessun campo oltre a questi entra nel database
function pulisci(b: any): { ok: true; v: Record<string, any>; invitati: string[] | null } | { ok: false; errore: string } {
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
    if (c.tipo !== 'spedizione' || !UUID.test(String(c.id || ''))) return { ok: false, errore: 'Collegamento non valido' }
    collegamento = { tipo: 'spedizione', id: String(c.id), etichetta: String(c.etichetta || '').slice(0, 200) }
  }
  let ricorrenza: any = null
  if (b?.ricorrenza) {
    const r = ricorrenzaValida(b.ricorrenza, inizio)
    if (!r.ok) return { ok: false, errore: r.errore }
    ricorrenza = r.r
  }
  // gli invitati si toccano solo se arriva un elenco di identificativi: la voce letta dal calendario porta gli invitati
  // come schede (nome, risposta) e, rimandata intera per segnarla fatta, li avrebbe tolti tutti
  let invitati: string[] | null = null
  if (Array.isArray(b?.invitati) && b.invitati.every((x: any) => typeof x === 'string')) {
    invitati = [...new Set(b.invitati.map((x: any) => String(x)))].filter((x) => UUID.test(x as string)) as string[]
    if (invitati.length > 50) return { ok: false, errore: 'Al massimo 50 invitati' }
    if (invitati.length && tipo === 'promemoria') return { ok: false, errore: 'Si invita a un evento o a una riunione, non a un promemoria' }
  }
  return {
    ok: true,
    invitati,
    v: {
      tipo, titolo,
      inizio: inizio.toISOString(), fine: fine ? fine.toISOString() : null,
      tutto_il_giorno: !!b?.tutto_il_giorno,
      luogo: b?.luogo ? String(b.luogo).trim().slice(0, 200) || null : null,
      note: b?.note ? String(b.note).trim().slice(0, 4000) || null : null,
      avviso_minuti: avviso,
      collegamento,
      // un promemoria che si ripete è «fatto» giorno per giorno (colonna fatti), non tutto insieme
      fatto: ricorrenza ? false : !!b?.fatto,
      ricorrenza,
    },
  }
}

// INVITI: chi può invitare e chi può essere invitato. Ritorna l'errore da mostrare, o null.
async function controllaInvitati(admin: any, u: { id: string; master_id: string | null; ruolo: string }, ids: string[]): Promise<string | null> {
  if (!ids.length) return null
  if (!gestisceLaRete(u) || !u.master_id) return 'Gli inviti li manda lo staff del master'
  if (ids.includes(u.id)) return 'Non serve invitare te stesso'
  const { data, error } = await admin.from('utenti').select('id,ruolo,master_id,attivo').in('id', ids)
  if (error) return 'Invitati non verificati: ' + error.message
  const buoni = (data || []).filter((x: any) => x.master_id === u.master_id && RUOLI_INVITABILI.includes(String(x.ruolo || '').toLowerCase()) && x.attivo !== false)
  if (buoni.length !== ids.length) return 'Qualcuno degli invitati non fa parte del tuo master'
  return null
}

// allinea gli invitati di una voce all'elenco scelto: i nuovi entrano in attesa, i tolti si segnano tolti, chi c'era resta
// com'era (con la sua risposta); chi viene rimesso dopo essere stato tolto torna in attesa
async function allineaInviti(admin: any, eventoId: string, organizzatore: string, ids: string[]): Promise<string | null> {
  const { data: ora, error } = await admin.from('calendario_inviti').select('id,utente_id,eliminato_il').eq('evento_id', eventoId)
  if (error) return 'Inviti non letti: ' + error.message
  const per = new Map<string, any>((ora || []).map((i: any) => [i.utente_id, i]))
  const adesso = new Date().toISOString()
  const nuovi = ids.filter((id) => !per.has(id)).map((id) => ({ evento_id: eventoId, utente_id: id, invitato_da: organizzatore }))
  const rimessi = ids.filter((id) => per.get(id)?.eliminato_il).map((id) => per.get(id).id)
  const tolti = (ora || []).filter((i: any) => !i.eliminato_il && !ids.includes(i.utente_id)).map((i: any) => i.id)
  if (nuovi.length) { const r = await admin.from('calendario_inviti').insert(nuovi); if (r.error) return 'Inviti non salvati: ' + r.error.message }
  if (rimessi.length) {
    const r = await admin.from('calendario_inviti').update({ eliminato_il: null, stato: 'in_attesa', risposto_il: null, invito_mandato_il: null, avvisato_il: null, avvisato_occorrenza: null }).in('id', rimessi)
    if (r.error) return 'Inviti non salvati: ' + r.error.message
  }
  if (tolti.length) { const r = await admin.from('calendario_inviti').update({ eliminato_il: adesso }).in('id', tolti); if (r.error) return 'Inviti non salvati: ' + r.error.message }
  return null
}

export async function GET(req: NextRequest) {
  const u = await chi()
  if (!u) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const p = req.nextUrl.searchParams
  const admin = createAdminSupabase()
  try {
    if (p.get('dafare') === '1') return NextResponse.json({ eventi: await promemoriaDaFare(admin, u.id) })
    const dal = new Date(p.get('dal') || ''), al = new Date(p.get('al') || '')
    if (isNaN(dal.getTime()) || isNaN(al.getTime()) || al < dal) return NextResponse.json({ error: 'Periodo non valido' }, { status: 400 })
    if ((al.getTime() - dal.getTime()) / 86400000 > 62) return NextResponse.json({ error: 'Periodo troppo lungo' }, { status: 400 })
    return NextResponse.json({ eventi: await vociNelPeriodo(admin, u.id, dal, al) })
  } catch (e: any) {
    return NextResponse.json({ error: 'Lettura non riuscita: ' + (e?.message || e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const u = await chi()
  if (!u) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await req.json().catch(() => null)
  const r = pulisci(b)
  if (!r.ok) return NextResponse.json({ error: r.errore }, { status: 400 })
  const admin = createAdminSupabase()
  const errInv = r.invitati ? await controllaInvitati(admin, u, r.invitati) : null
  if (errInv) return NextResponse.json({ error: errInv }, { status: 400 })
  const { data, error } = await admin.from('calendario_eventi')
    .insert({ ...r.v, utente_id: u.id, master_id: u.master_id, cliente_id: u.cliente_id })
    .select(COLONNE_EVENTO).single()
  if (error) return NextResponse.json({ error: 'Salvataggio non riuscito: ' + error.message }, { status: 500 })
  if (r.invitati?.length) {
    const e2 = await allineaInviti(admin, data.id, u.id, r.invitati)
    if (e2) return NextResponse.json({ error: e2 + ' (la voce è salvata: riaprila per rimettere gli invitati)' }, { status: 500 })
  }
  return NextResponse.json({ evento: data })
}

export async function PATCH(req: NextRequest) {
  const u = await chi()
  if (!u) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Voce non valida' }, { status: 400 })
  const b = await req.json().catch(() => null)
  const r = pulisci(b)
  if (!r.ok) return NextResponse.json({ error: r.errore }, { status: 400 })
  const admin = createAdminSupabase()
  // eq utente_id: si cambia solo una voce propria (un id indovinato di un altro, o una voce a cui si è solo invitati,
  // non trova righe)
  const { data: prima, error: ePrima } = await admin.from('calendario_eventi')
    .select('inizio,tutto_il_giorno,avviso_minuti,ricorrenza')
    .eq('id', id).eq('utente_id', u.id).is('eliminato_il', null).maybeSingle()
  if (ePrima) return NextResponse.json({ error: 'Lettura non riuscita: ' + ePrima.message }, { status: 500 })
  if (!prima) return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
  const errInv = r.invitati ? await controllaInvitati(admin, u, r.invitati) : null
  if (errInv) return NextResponse.json({ error: errInv }, { status: 400 })
  // l'avviso si riarma solo se cambia QUANDO avvisare: correggere una nota non deve rimandare l'email
  const cambiaMomento = new Date((prima as any).inizio).getTime() !== new Date(r.v.inizio).getTime()
    || (prima as any).tutto_il_giorno !== r.v.tutto_il_giorno || (prima as any).avviso_minuti !== r.v.avviso_minuti
    || JSON.stringify((prima as any).ricorrenza ?? null) !== JSON.stringify(r.v.ricorrenza ?? null)
  const { data, error } = await admin.from('calendario_eventi')
    .update({ ...r.v, aggiornato_il: new Date().toISOString(), ...(cambiaMomento ? { avvisato_il: null, avvisato_occorrenza: null } : {}) })
    .eq('id', id).eq('utente_id', u.id).is('eliminato_il', null)
    .select(COLONNE_EVENTO).maybeSingle()
  if (error) return NextResponse.json({ error: 'Salvataggio non riuscito: ' + error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
  // cambiato il momento: anche gli invitati riavranno l'avviso
  if (cambiaMomento) await admin.from('calendario_inviti').update({ avvisato_il: null, avvisato_occorrenza: null }).eq('evento_id', id)
  if (r.invitati) {
    const e2 = await allineaInviti(admin, id, u.id, r.invitati)
    if (e2) return NextResponse.json({ error: e2 }, { status: 500 })
  }
  return NextResponse.json({ evento: data })
}

export async function DELETE(req: NextRequest) {
  const u = await chi()
  if (!u) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Voce non valida' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data, error } = await admin.from('calendario_eventi')
    .update({ eliminato_il: new Date().toISOString() })
    .eq('id', id).eq('utente_id', u.id).is('eliminato_il', null)
    .select('id').maybeSingle()
  if (error) return NextResponse.json({ error: 'Eliminazione non riuscita: ' + error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Voce non trovata' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
