import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Funzione ATTIVA SOLO per E&A MULTIEXPRESS: gestisce i crediti dei portali esterni
// (SpediamoPro / Spedisci.online / DVA) da cui compra i contratti per rivendere. È l'UNICA pagina
// dove i nomi dei fornitori tecnici possono comparire (riconciliazione costi E&A, cfr. REGOLE.md).
const EA_ID = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'

// Etichetta leggibile del gruppo. Spedisci ha PIÙ sotto-account (master_domain), ognuno col suo
// wallet: es. revlogistic.spedisci.online → "Spedisci · revlogistic".
function labelGruppo(gruppo: string, portale: string): string {
  const g = String(gruppo || portale || '')
  if (portale === 'spediamopro' || g === 'spediamopro') return 'SpediamoPro'
  if (portale === 'easyparcel' || g === 'easyparcel') return 'DVA'
  if (portale === 'spedisci' || g.endsWith('.spedisci.online')) return 'Spedisci · ' + g.replace('.spedisci.online', '')
  return g || portale
}
// Dal gruppo (fine) al portale (grosso): spediamopro/easyparcel restano; qualsiasi altro = spedisci.
function portaleDaGruppo(gruppo: string): string {
  if (gruppo === 'spediamopro' || gruppo === 'easyparcel') return gruppo
  return 'spedisci'
}
// Ordine di visualizzazione: prima i due conti unici, poi i sotto-account Spedisci.
function ordine(portale: string): number {
  return portale === 'spediamopro' ? 0 : portale === 'easyparcel' ? 1 : 2
}

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ abilitato: false })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (utente?.master_id !== EA_ID) return NextResponse.json({ abilitato: false })

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()

  // Ricariche registrate (con il gruppo fine, per Spedisci il sotto-account).
  const { data: ricariche } = await admin.from('ricariche_portale')
    .select('*').eq('master_id', EA_ID).order('created_at', { ascending: false })

  // SPESO per gruppo, aggregato NEL DATABASE (prima si scaricavano 14.000+ movimenti in memoria a
  // ogni apertura: era la lentezza). La RPC raggruppa spediamopro/easyparcel per tipo e Spedisci per
  // master_domain (i 5 sotto-account) e sottrae già i rimborsi.
  const { data: spesoRows } = await admin.rpc('speso_portali_ea')

  const r2 = (n: number) => Math.round(n * 100) / 100
  const gruppi = new Map<string, { gruppo: string; portale: string; speso: number; ricariche: number; rimesseCod: number }>()
  for (const row of (spesoRows || []) as any[]) {
    if (!['spediamopro', 'easyparcel', 'spedisci'].includes(row.portale)) continue   // gls/interno non sono wallet
    gruppi.set(row.gruppo, { gruppo: row.gruppo, portale: row.portale, speso: Number(row.speso) || 0, ricariche: 0, rimesseCod: 0 })
  }
  for (const r of (ricariche || []) as any[]) {
    const g = r.gruppo || r.portale
    if (!gruppi.has(g)) gruppi.set(g, { gruppo: g, portale: r.portale, speso: 0, ricariche: 0, rimesseCod: 0 })
    const gg = gruppi.get(g)!
    // La rimessa contrassegni (COD riaccreditato dal provider) alza il residuo come una ricarica,
    // ma la teniamo distinta per mostrarla separata sulla card.
    if (r.categoria === 'cod') gg.rimesseCod += Number(r.importo || 0)
    else gg.ricariche += Number(r.importo || 0)
  }

  // Saldo VERO letto dai provider (ognuno col suo modo), IN PARALLELO con timeout: è un di più e non
  // deve rallentare la pagina. Da qui deduco "quanto inserito davvero" = saldo + speso, che spiega lo
  // scarto con le ricariche trascritte. Chiave = GRUPPO (per Spedisci, il singolo sotto-account):
  //  - SpediamoPro: GET /wallet (centesimi, prepagato)
  //  - DVA: apikeyinfo → credito_prepagato (prepagato di rete)
  //  - Spedisci: GET https://{master_domain}/api/v2/account → campo `credit` (postpagato: negativo = dovuto)
  const conTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p.catch(() => null), new Promise<null>(res => setTimeout(() => res(null), ms))])

  const { data: corr } = await admin.from('corrieri')
    .select('tipo, credenziali').eq('master_id', EA_ID).in('tipo', ['spediamopro', 'easyparcel', 'spedisci'])
  const authcode = (corr || []).find((c: any) => c.tipo === 'spediamopro')?.credenziali?.authcode
  const epCred = (corr || []).find((c: any) => c.tipo === 'easyparcel')?.credenziali
  const spedisciAcc = new Map<string, string>()   // master_domain → password (uno per sotto-account)
  for (const c of (corr || []) as any[]) {
    const cd = c.credenziali
    if (c.tipo === 'spedisci' && cd?.master_domain && cd?.password && !spedisciAcc.has(cd.master_domain)) spedisciAcc.set(cd.master_domain, cd.password)
  }

  const tasks: Array<Promise<{ gruppo: string; saldo: number } | null>> = []
  tasks.push(conTimeout((async () => {
    if (!authcode) return null
    const { getSpediamoproToken } = await import('@/lib/spediamopro')
    const token = await getSpediamoproToken(authcode)
    const w = await fetch('https://core.spediamopro.com/api/v2/wallet', { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    if (!w.ok) return null
    const cent = Number((await w.json())?.data?.balance)
    return Number.isFinite(cent) ? { gruppo: 'spediamopro', saldo: r2(cent / 100) } : null
  })(), 4000))
  tasks.push(conTimeout((async () => {
    const apikey = (epCred as any)?.apikey
    if (!apikey || (epCred as any)?.ambiente !== 'produzione') return null
    const { easyparcelInfo } = await import('@/lib/easyparcel')
    const info = await easyparcelInfo(apikey)
    return info.live && Number.isFinite(info.credito) ? { gruppo: 'easyparcel', saldo: r2(info.credito) } : null
  })(), 4000))
  for (const [dom, pass] of spedisciAcc) {
    tasks.push(conTimeout((async () => {
      const res = await fetch(`https://${dom}/api/v2/account`, { headers: { Authorization: `Bearer ${pass}`, Accept: 'application/json' } })
      if (!res.ok) return null
      const c = Number((await res.json())?.credit)   // saldo conto del sotto-account
      return Number.isFinite(c) ? { gruppo: dom, saldo: r2(c) } : null
    })(), 4000))
  }
  const saldiRis = await Promise.all(tasks)
  const saldoLive: Record<string, number | null> = {}
  for (const rr of saldiRis) if (rr) saldoLive[rr.gruppo] = rr.saldo

  const out = Array.from(gruppi.values()).map(g => {
    const residuo = r2(g.ricariche + g.rimesseCod - g.speso)
    const base: any = {
      gruppo: g.gruppo, portale: g.portale, label: labelGruppo(g.gruppo, g.portale),
      ricariche: r2(g.ricariche), rimesseCod: r2(g.rimesseCod), speso: r2(g.speso), residuo,
    }
    const sLive = saldoLive[g.gruppo]
    if (sLive != null) {
      base.saldoReale = sLive
      // La RICONCILIAZIONE (versato = saldo+speso, scarto, Allinea) vale SOLO per i conti DEDICATI di
      // E&A — SpediamoPro e DVA — dove il nostro speso aggrega tutta e sola la rete. I conti Spedisci
      // sono account rivenditore SEPARATI (E.M Express, M.C Logistica…) con attività fuori MoovExpress:
      // lì saldo+speso NON è "versato", quindi mostriamo solo il saldo grezzo (niente scarto/Allinea).
      if (g.portale === 'spediamopro' || g.portale === 'easyparcel') {
        base.realeInserito = r2(sLive + g.speso)
        base.scarto = r2(sLive - residuo)
      }
    }
    return base
  }).sort((a, b) => ordine(a.portale) - ordine(b.portale) || a.label.localeCompare(b.label))

  return NextResponse.json({ abilitato: true, ricariche: ricariche || [], gruppi: out })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (utente?.master_id !== EA_ID) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json()
  // Ora si passa il GRUPPO (fine). Compat: se arriva ancora 'portale', vale come gruppo.
  const gruppo = String(body.gruppo || body.portale || '').trim()
  const importo = Number(body.importo)
  // 'cod' = rimessa contrassegni riaccreditata dal provider; 'ricarica' = versamento di E&A.
  const categoria = body.categoria === 'cod' ? 'cod' : 'ricarica'
  if (!gruppo) { console.error('[RICARICHE][400] gruppo mancante — body:', JSON.stringify(body)); return NextResponse.json({ error: 'Gruppo non valido' }, { status: 400 }) }
  if (!isFinite(importo) || importo === 0) { console.error('[RICARICHE][400] importo non valido — body:', JSON.stringify(body)); return NextResponse.json({ error: 'Inserisci un importo diverso da 0 (usa il − per correggere)' }, { status: 400 }) }
  const portale = portaleDaGruppo(gruppo)

  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const { data: ins, error } = await admin.from('ricariche_portale').insert({
    master_id: EA_ID, portale, gruppo, importo, categoria, data: body.data || null,
    note: body.note ? String(body.note).slice(0, 200) : null, created_by: user.id,
  }).select('id, portale, gruppo').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Ricarica e rimessa contrassegni ACCREDITANO entrambe il credito rete di E&A (l'utente ha scelto
  // di contare il COD nel credito). Movimento atomico via RPC, conto 'rete' (fn_conto_di con
  // spedizione null → 'rete'). Riferimento = id per poterlo stornare alla cancellazione.
  try {
    await admin.rpc('registra_movimento_master', {
      p_master_owner_id: EA_ID, p_master_target_id: EA_ID, p_tipo: 'ricarica',
      p_descrizione: (categoria === 'cod' ? 'Rimessa contrassegni ' : 'Ricarica ') + labelGruppo((ins as any).gruppo, (ins as any).portale),
      p_importo: importo, p_riferimento: (ins as any).id, p_spedizione_id: null, p_created_by: user.id,
    })
  } catch (e) { console.error('accredito ricarica/cod portale fallito', e) }

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
  // Leggo la ricarica PRIMA di cancellarla, per stornare l'accredito corrispondente.
  const { data: ric } = await admin.from('ricariche_portale')
    .select('importo, portale, gruppo').eq('id', id).eq('master_id', EA_ID).maybeSingle()
  const { error } = await admin.from('ricariche_portale').delete().eq('id', id).eq('master_id', EA_ID)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Storna dal credito l'accredito fatto al momento della ricarica (storico intatto: movimento opposto).
  if (ric) {
    try {
      await admin.rpc('registra_movimento_master', {
        p_master_owner_id: EA_ID, p_master_target_id: EA_ID, p_tipo: 'ricarica',
        p_descrizione: 'Storno ricarica ' + labelGruppo((ric as any).gruppo, (ric as any).portale),
        p_importo: -Number((ric as any).importo || 0), p_riferimento: id, p_spedizione_id: null, p_created_by: user.id,
      })
    } catch (e) { console.error('storno ricarica portale fallito', e) }
  }
  return NextResponse.json({ ok: true })
}
