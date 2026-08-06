import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'

// Funzione ATTIVA SOLO per E&A MULTIEXPRESS: gestisce i crediti dei portali esterni
// (SpediamoPro / Spedisci.online) da cui compra i contratti per rivendere.
const EA_ID = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ abilitato: false })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (utente?.master_id !== EA_ID) return NextResponse.json({ abilitato: false })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  // Ricariche registrate sui portali.
  const { data: ricariche } = await admin.from('ricariche_portale')
    .select('*').eq('master_id', EA_ID).order('created_at', { ascending: false })

  // Speso sul portale = tutto cio' che consuma il conto esterno, raggruppato per TIPO del corriere
  // (spedisci = SDA; spediamopro = tutto il resto).
  //
  // Due difetti gravi che questo calcolo aveva, entrambi silenziosi:
  //  1) leggeva i movimenti SENZA paginazione. PostgREST tronca ogni risposta a 1000 righe, e
  //     E&A ne ha oltre 14.000: lo "speso" mostrato era 5.756 EUR invece di 82.839, cioe' il
  //     residuo del portale risultava enormemente piu' alto del vero. Ora si usa fetchAll.
  //  2) contava SOLO i movimenti di tipo 'spedizione'. I RIMBORSI delle spedizioni annullate non
  //     venivano sottratti, quindi una spedizione annullata restava "spesa" per sempre.
  // Si tiene conto anche di rettifiche e giacenze: anche quelle pesano sul conto del portale.
  const movs = await fetchAll(() => admin.from('movimenti')
    .select('importo, spedizione_id, tipo')
    .eq('master_target_id', EA_ID)
    // 'reso' compreso: un pacco che rientra il corriere lo fa pagare, quindi pesa sul conto del
    // portale come una spedizione. Prima mancava, e i resi non comparivano nello speso.
    .in('tipo', ['spedizione', 'rimborso', 'rettifica', 'giacenza', 'reso']))

  const spedIds = Array.from(new Set((movs || []).map((m: any) => m.spedizione_id).filter(Boolean)))
  const tipoPerSped = new Map<string, string | null>()
  // A blocchi: un .in() con migliaia di id verrebbe troncato anche lui.
  for (let i = 0; i < spedIds.length; i += 300) {
    const { data: speds } = await admin.from('spedizioni').select('id, corrieri(tipo)').in('id', spedIds.slice(i, i + 300))
    for (const s of (speds || [])) tipoPerSped.set(s.id, (s.corrieri as any)?.tipo || null)
  }
  // IL TERZO FORNITORE MANCAVA DEL TUTTO.
  // La pagina nasce con due portali e non e' mai stata aggiornata quando ne e' entrato un terzo:
  // il suo speso non finiva in nessuno dei due secchi e semplicemente spariva dal conto. Misurato
  // sui dati veri: 1.270 movimenti per 10.526,97 euro usciti dal conto di E&A e non riconciliati da
  // nessuna parte. Non era un errore di calcolo, era un fornitore invisibile.
  let spesoSpediamo = 0, spesoSpedisci = 0, spesoEasyparcel = 0
  for (const m of (movs || [])) {
    const tipo = m.spedizione_id ? tipoPerSped.get(m.spedizione_id) : null
    // L'importo e' negativo quando esce (addebito) e positivo quando rientra (rimborso):
    // sommare -importo da' direttamente lo speso NETTO, senza casi particolari per tipo.
    const netto = -(Number(m.importo) || 0)
    if (tipo === 'spedisci') spesoSpedisci += netto
    else if (tipo === 'spediamopro') spesoSpediamo += netto
    else if (tipo === 'easyparcel') spesoEasyparcel += netto
  }

  const ricSpediamo = (ricariche || []).filter((r: any) => r.portale === 'spediamopro').reduce((s: number, r: any) => s + Number(r.importo || 0), 0)
  const ricSpedisci = (ricariche || []).filter((r: any) => r.portale === 'spedisci').reduce((s: number, r: any) => s + Number(r.importo || 0), 0)
  const ricEasyparcel = (ricariche || []).filter((r: any) => r.portale === 'easyparcel').reduce((s: number, r: any) => s + Number(r.importo || 0), 0)
  const r2 = (n: number) => Math.round(n * 100) / 100

  // SALDO VERO letto dal portale, non dedotto per sottrazione: e' l'unico numero che non dipende
  // da quali ricariche sono state trascritte a mano qui dentro. Con questo il controllo si fa da
  // solo — residuo calcolato contro saldo reale — invece di doverlo rifare a mano ogni volta.
  // Best-effort: se il portale non risponde, la pagina funziona lo stesso senza questo dato.
  let saldoReale: number | null = null
  try {
    const { data: cSp } = await admin.from('corrieri')
      .select('credenziali').eq('master_id', EA_ID).eq('tipo', 'spediamopro').limit(1).maybeSingle()
    const authcode = (cSp?.credenziali as any)?.authcode
    if (authcode) {
      const { getSpediamoproToken } = await import('@/lib/spediamopro')
      const token = await getSpediamoproToken(authcode)
      const w = await fetch('https://core.spediamopro.com/api/v2/wallet', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      if (w.ok) {
        const wd = await w.json()
        // Il saldo arriva in CENTESIMI.
        const cent = Number(wd?.data?.balance)
        if (Number.isFinite(cent)) saldoReale = r2(cent / 100)
      }
    }
  } catch { /* il saldo live e' un di piu': non deve far fallire la pagina */ }

  return NextResponse.json({
    abilitato: true,
    ricariche: ricariche || [],
    portali: {
      spediamopro: {
        ricariche: r2(ricSpediamo), speso: r2(spesoSpediamo), residuo: r2(ricSpediamo - spesoSpediamo),
        saldoReale,
        // Scarto fra il residuo calcolato qui e il saldo vero del portale: se non e' ~0 vuol dire
        // che manca una ricarica da trascrivere, oppure che il portale ha addebitato qualcosa che
        // da noi non risulta (es. rettifiche di peso fatte da loro).
        scarto: saldoReale === null ? null : r2(saldoReale - (ricSpediamo - spesoSpediamo)),
      },
      spedisci: { ricariche: r2(ricSpedisci), speso: r2(spesoSpedisci), residuo: r2(ricSpedisci - spesoSpedisci) },
      easyparcel: { ricariche: r2(ricEasyparcel), speso: r2(spesoEasyparcel), residuo: r2(ricEasyparcel - spesoEasyparcel) },
    },
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (utente?.master_id !== EA_ID) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json()
  const portale = ['spedisci', 'spediamopro', 'easyparcel'].includes(body.portale) ? body.portale : null
  const importo = Number(body.importo)
  if (!portale) return NextResponse.json({ error: 'Portale non valido' }, { status: 400 })
  if (!isFinite(importo) || importo === 0) return NextResponse.json({ error: 'Inserisci un importo diverso da 0 (usa il − per correggere)' }, { status: 400 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { error } = await admin.from('ricariche_portale').insert({
    master_id: EA_ID, portale, importo, data: body.data || null,
    note: body.note ? String(body.note).slice(0, 200) : null, created_by: user.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (utente?.master_id !== EA_ID) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { error } = await admin.from('ricariche_portale').delete().eq('id', id).eq('master_id', EA_ID)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
