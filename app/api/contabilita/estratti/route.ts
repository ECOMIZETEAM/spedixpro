import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraAudit } from '@/lib/audit'
import { chiSei } from '@/lib/contabilita-accesso'
import { leggiEstrattoFinom } from '@/lib/estratto-finom'
import { applicaSicuri, resoconto, salvaEstratto } from '@/lib/contabilita-estratti'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// L'ESTRATTO CONTO (lib/contabilita-estratti): si carica il PDF della banca, il portale lo legge, lo salva e
// abbina i bonifici alle ricariche. Solo il titolare e i suoi admin: e' il conto in banca dell'azienda.
// In prova solo per Ecomize Solution (lib/contabilita-banca).

const DATA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const c = await chiSei(); if ('errore' in c) return c.errore
  const admin = createAdminSupabase()
  const { data: estratti, error } = await admin.from('estratti_conto')
    .select('id,banca,intestatario,conto_iban,dal,al,saldo_iniziale,saldo_finale,n_righe,nome_file,caricato_il')
    .eq('master_id', c.masterId).order('al', { ascending: false }).order('caricato_il', { ascending: false }).limit(60)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!estratti?.length) return NextResponse.json({ estratti: [], resoconto: null })
  // Il periodo chiesto, altrimenti quello dell'ultimo estratto caricato.
  const p = req.nextUrl.searchParams
  const dal = DATA.test(p.get('dal') || '') ? p.get('dal')! : estratti[0].dal
  const al = DATA.test(p.get('al') || '') ? p.get('al')! : estratti[0].al
  try {
    // Aprendo la pagina si riprovano gli abbinamenti sicuri: le ricariche registrate dopo il caricamento
    // e i pagatori aggiunti dalla scheda del cliente trovano qui il loro bonifico.
    await applicaSicuri(admin, c.masterId, dal, al)
    return NextResponse.json({ estratti, resoconto: await resoconto(admin, c.masterId, dal, al) })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const c = await chiSei(); if ('errore' in c) return c.errore
  const corpo = await req.json().catch(() => ({})) as { pdfBase64?: string, nomeFile?: string }
  const raw = String(corpo.pdfBase64 || '')
  const dati = raw.includes(',') ? raw.split(',').pop()! : raw
  if (!dati) return NextResponse.json({ error: 'Nessun PDF ricevuto.' }, { status: 400 })
  const bytes = Buffer.from(dati, 'base64')
  // Il limite del server per una richiesta e' 4,5 MB, e il PDF viaggia in base64 (un terzo in piu').
  if (bytes.length > 3 * 1024 * 1024) return NextResponse.json({ error: 'PDF troppo grande: carica un mese alla volta.' }, { status: 400 })
  let estratto
  try { estratto = await leggiEstrattoFinom(new Uint8Array(bytes)) }
  catch (e: any) { return NextResponse.json({ error: 'Non riesco a leggere il PDF: ' + String(e?.message || e) }, { status: 400 }) }
  const admin = createAdminSupabase()
  try {
    const salvato = await salvaEstratto(admin, c.masterId, estratto, String(corpo.nomeFile || 'estratto.pdf'), c.userId)
    const applicati = await applicaSicuri(admin, c.masterId, estratto.dal, estratto.al)
    await registraAudit({ utenteId: c.userId, ruolo: c.ruolo, azione: 'estratto_conto_caricato', risorsa: salvato.estrattoId, dettaglio: `${estratto.dal}→${estratto.al} · ${estratto.righe.length} movimenti · ${salvato.nuove} nuovi` })
    return NextResponse.json({ ok: true, dal: estratto.dal, al: estratto.al, saldoIniziale: estratto.saldoIniziale, saldoFinale: estratto.saldoFinale, ...salvato, ...applicati })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore nel salvataggio' }, { status: 500 }) }
}
