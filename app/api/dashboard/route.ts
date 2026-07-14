import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome,masters(nome,parent_master_id,abbonamento_piano,abbonamento_limite)').eq('id', user.id).single()

  // ── AGENTE: dashboard confinata ai SUOI clienti. Piano = quello del MASTER (riferimento),
  //    conteggio = spedizioni dei suoi clienti. Nessun dato/rete/KPI del master. ──
  if (isAgente(utente)) {
    const ids = idClientiPerFiltro(await clientiAgente(supabase, utente))
    const nMiei = ids[0] === '00000000-0000-0000-0000-000000000000' ? 0 : ids.length
    const mRec: any = (utente as any)?.masters || {}
    const isRootA = !mRec?.parent_master_id
    const limitePianoA = Number(mRec?.abbonamento_limite || 0) || 50000
    const abbonamentoAttivoA = isRootA || !!mRec?.abbonamento_piano
    const { createAdminSupabase: _adminA } = await import('@/lib/supabase-admin')
    const adminA = _adminA()
    const oggi = new Date()
    const inizioMese = new Date(oggi.getFullYear(), oggi.getMonth(), 1).toISOString()
    const startOggi = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate()).toISOString()
    const base = () => adminA.from('spedizioni').select('id', { count: 'exact', head: true }).in('cliente_id', ids)
    const C = async (b: any) => (await b).count || 0
    const [
      inLavorazione, inTransito, inGiacenza, consegnateTotali, spedizioniTotali,
      spedizioniMese, consegnateMese, spediteOggi,
      { data: ultime }, { data: meseRows },
    ] = await Promise.all([
      C(base().eq('stato', 'in_lavorazione')),
      C(base().eq('stato', 'in_transito')),
      C(base().eq('stato', 'in_giacenza')),
      C(base().eq('stato', 'consegnata')),
      C(base().not('stato', 'in', '(annullata)')),
      C(base().gte('created_at', inizioMese).not('stato', 'in', '(annullata)')),
      C(base().eq('stato', 'consegnata').gte('created_at', inizioMese)),
      C(base().gte('updated_at', startOggi).in('stato', ['spedita', 'in_transito', 'consegnata'])),
      adminA.from('spedizioni').select(SPED_COLS).in('cliente_id', ids).order('created_at', { ascending: false }).limit(10),
      adminA.from('spedizioni').select('costo_totale').in('cliente_id', ids).gte('created_at', inizioMese).not('stato', 'in', '(annullata)').limit(20000),
    ])
    const fatturatoMese = (meseRows || []).reduce((s: number, x: any) => s + Number(x.costo_totale || 0), 0)
    const tassoConsegna = spedizioniTotali > 0 ? Math.round((consegnateTotali / spedizioniTotali) * 1000) / 10 : 0
    return NextResponse.json({
      ruolo: 'agente',
      masterNome: (((utente as any)?.nome) || 'Agente'),
      totClienti: nMiei, clientiTotali: nMiei,
      spedizioniMese, limiteMese: limitePianoA, abbonamentoAttivo: abbonamentoAttivoA, illimitato: isRootA,
      spediteOggi, daSpedire: inLavorazione, inLavorazione,
      spedizioniTotali, fatturatoMese: Math.round(fatturatoMese * 100) / 100, consegnateMese,
      inTransito, inGiacenza, codDaRimettere: 0, sottomaster: 0,
      consegnateTotali, tassoConsegna, topCorriere: null, topCliente: null,
      statsMensili: [], statiUltimi30: {}, ultimeSpedizioni: ultime || [],
    })
  }

  const masterId = utente?.master_id
  const masterRec: any = (utente as any)?.masters || {}
  const masterNome = masterRec?.nome || 'Master'
  const isRoot = !masterRec?.parent_master_id                 // il master principale è esente
  const abbonamentoAttivo = isRoot || !!masterRec?.abbonamento_piano
  const limitePiano = Number(masterRec?.abbonamento_limite || 0) || 50000

  // Rete: la volumetria (piano + spedizioni recenti) considera TUTTO il sotto-albero del master.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const admin = createAdminSupabase()
  const reteIds = masterId ? await sottoAlberoMasterIds(admin, masterId) : []
  // Contatori + statistiche aggregati nel DB (una query ciascuno) invece di scaricare
  // le righe grezze: le liste PostgREST sono limitate a 1000 righe e falsavano i totali a volume.
  const [
    { data: contatori },
    { data: statistiche },
    { data: kpi },
    { data: ultimeSpedizioni },
  ] = await Promise.all([
    // Via ADMIN (bypassa RLS): le RPC aggregano SOLO il sotto-albero del proprio master (p_master),
    // quindi contano proprie + improprie della rete SOTTO. Con il client user-scoped l'RLS limitava
    // alle sole proprie del master (0 per chi spedisce solo tramite i sotto-master, es. E&A).
    admin.rpc('dashboard_contatori_master', { p_master: masterId }),
    admin.rpc('dashboard_statistiche_master', { p_master: masterId }),
    admin.rpc('dashboard_kpi_master', { p_master: masterId }),
    // Spedizioni recenti di tutta la rete (sé + discendenza), via admin per i permessi cross-master.
    admin.from('spedizioni').select(SPED_COLS).in('master_id', reteIds.length ? reteIds : [masterId]).order('created_at',{ascending:false}).limit(10),
  ])
  // Contatore piano (X/limite) = spedizioni del mese di TUTTA la rete, dalla STESSA RPC (subtree)
  // così coincide con le altre statistiche (niente più discrepanze tipo 98 vs 86).
  const spedMeseRete = (contatori as any)?.spedizioniMese || 0
  const c: any = contatori || {}
  const st: any = statistiche || {}
  const k: any = kpi || {}

  return NextResponse.json({
    ruolo: (utente as any)?.ruolo || 'master',
    masterNome,
    totClienti: c.totClienti||0,
    spedizioniMese: spedMeseRete||0,
    limiteMese: limitePiano,
    abbonamentoAttivo,
    illimitato: isRoot,
    spediteOggi: c.spediteOggi||0,
    daSpedire: c.daSpedire||0,
    inLavorazione: c.inLavorazione||0,
    // KPI globali di tutta la rete (proprie + improprie)
    spedizioniTotali: k.spedizioniTotali||0,
    fatturatoMese: Number(k.fatturatoMese||0),
    consegnateMese: k.consegnateMese||0,
    inTransito: k.inTransito||0,
    inGiacenza: k.inGiacenza||0,
    codDaRimettere: Number(k.codDaRimettere||0),
    clientiTotali: k.clientiTotali||0,
    sottomaster: k.sottomaster||0,
    consegnateTotali: k.consegnateTotali||0,
    tassoConsegna: (k.spedizioniTotali > 0 ? Math.round((Number(k.consegnateTotali||0) / Number(k.spedizioniTotali)) * 1000) / 10 : 0),
    topCorriere: k.topCorriere || null,
    topCliente: k.topCliente || null,
    statsMensili: st.mensili || [],
    statiUltimi30: st.stati30 || {},
    ultimeSpedizioni: ultimeSpedizioni||[],
  })
}