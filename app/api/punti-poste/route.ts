import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { pudoConfigDaVettore, spediamoproPudoCourier } from '@/lib/punti-poste'
import { easyparcelPudo } from '@/lib/easyparcel'
import { spediamoproPudoSearch } from '@/lib/spediamopro'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cerca i PuntoPoste / Uffici Postali vicino a una posizione, per un contratto DVA "Porta a un
// PuntoPoste" (PDB-P2H/P2TAB/P2UP). L'apikey e il nome del provider restano LATO SERVER: al client
// tornano solo i punti pubblici (codice, indirizzo, coordinate, distanza). Serve al selettore-punto
// in creazione spedizione (origine per tutti, destinazione per P2TAB/P2UP).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const p = req.nextUrl.searchParams
  const corriereId = p.get('corriereId') || ''
  const cap = (p.get('cap') || '').trim()
  const citta = (p.get('city') || '').trim()
  const lat = p.get('lat') ? Number(p.get('lat')) : undefined
  const lon = p.get('lon') ? Number(p.get('lon')) : undefined
  if (!corriereId) return NextResponse.json({ error: 'Contratto mancante' }, { status: 400 })
  if (!cap && (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)))
    return NextResponse.json({ error: 'Serve un CAP o la posizione' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: corr } = await admin.from('corrieri').select('id,master_id,tipo,credenziali').eq('id', corriereId).maybeSingle()
  if (!corr || (corr.tipo !== 'easyparcel' && corr.tipo !== 'spediamopro')) return NextResponse.json({ error: 'Contratto non valido' }, { status: 404 })

  // Perimetro: il contratto dev'essere del master del chiamante o di un suo ANTENATO (i contratti
  // condivisi scendono lungo la catena). Vale per master/agente/cliente (tutti hanno master_id).
  const catena = new Set<string>()
  let cur: string | null = utente.master_id
  for (let i = 0; i < 25 && cur; i++) {
    catena.add(cur)
    const { data: m } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
    cur = (m as any)?.parent_master_id || null
  }
  if (!catena.has(corr.master_id)) return NextResponse.json({ error: 'Contratto non disponibile' }, { status: 403 })

  const cred = (corr.credenziali || {}) as any

  // ── SpediamoPro: ricerca per CAP (l'API non accetta lat/lon). Il corriere (brt/inpost/sda) esce dal
  //    service_id. Solo punto di CONSEGNA (deliveryPudo), nessun deposito. ──
  if (corr.tipo === 'spediamopro') {
    const courier = spediamoproPudoCourier(cred.service_id)
    if (!courier) return NextResponse.json({ error: 'Questo contratto non prevede un punto di consegna da scegliere.' }, { status: 400 })
    if (!cred.authcode) return NextResponse.json({ error: 'Contratto non configurato.' }, { status: 400 })
    if (!cap) return NextResponse.json({ error: 'Cerca il punto inserendo il CAP del destinatario.' }, { status: 400 })
    try {
      const punti = await spediamoproPudoSearch(cred.authcode, { courier, cap, city: citta || undefined })
      return NextResponse.json({ punti, tipologia: courier })
    } catch (e: any) {
      console.error('[PUNTI-POSTE][SP] pudo KO', String(e?.message || e).slice(0, 150))
      return NextResponse.json({ error: 'Ricerca punti non disponibile in questo momento.' }, { status: 502 })
    }
  }

  // ── DVA (easyparcel) ──
  // Cerca i punti di CONSEGNA (dove ritira il destinatario): P2TAB→RTZ, P2UP→FMP. L'origine (deposito)
  // non passa di qui: è una semplice scelta FMP/APT nel form.
  const tipologia = pudoConfigDaVettore(cred.vettore).consegnaTipologia
  if (!tipologia) return NextResponse.json({ error: 'Questo contratto non prevede un punto di consegna da scegliere.' }, { status: 400 })
  if (!cred.apikey) return NextResponse.json({ error: 'Contratto non configurato.' }, { status: 400 })

  try {
    // La chiamata pudo usa la FAMIGLIA vettore 'PDB' (non il codice servizio), + tipologia RTZ/FMP.
    const punti = await easyparcelPudo(cred.apikey, { vettore: 'PDB', tipologia, cap: cap || undefined, lat, lon, radius: 20, limit: 30 })
    return NextResponse.json({ punti, tipologia })
  } catch (e: any) {
    console.error('[PUNTI-POSTE] pudo KO', String(e?.message || e).slice(0, 150))
    return NextResponse.json({ error: 'Ricerca punti non disponibile in questo momento.' }, { status: 502 })
  }
}
