import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { SPED_COLS } from '@/lib/spedizioni-cols'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { nonStaffMaster } from '@/lib/permessi'
import { fetchAll } from '@/lib/fetch-all'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,cliente_id,ruolo,nome,cognome,masters(nome,parent_master_id,abbonamento_piano,abbonamento_limite)').eq('id', user.id).single()

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
      { data: ultime }, meseRows,
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
      // Fatturato mese: TUTTE le righe (senza range PostgREST taglierebbe a 1000 -> totale errato).
      fetchAll(() => adminA.from('spedizioni').select('costo_totale').in('cliente_id', ids).gte('created_at', inizioMese).not('stato', 'in', '(annullata)').order('created_at', { ascending: false }).order('id', { ascending: false })),
    ])
    const fatturatoMese = (meseRows || []).reduce((s: number, x: any) => s + Number(x.costo_totale || 0), 0)
    const tassoConsegna = spedizioniTotali > 0 ? Math.round((consegnateTotali / spedizioniTotali) * 1000) / 10 : 0
    // LDV ancora da chiudere in distinta (nessuna distinta assegnata), escluse le annullate.
    const daMettereInDistinta = await C(base().is('distinta_id', null).not('stato', 'in', '(annullata)'))
    return NextResponse.json({
      ruolo: 'agente',
      daMettereInDistinta,
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

  // Da qui in giù si passa al client ADMIN (service role), che BYPASSA la RLS e legge tutta la
  // rete del master: fatturato, contrassegni, elenco clienti e le ultime spedizioni con i dati di
  // mittente e destinatario. Senza questa guardia bastava una sessione CLIENTE per chiamare la
  // rotta a mano e ricevere tutto (la pagina cliente usa /api/cliente/dashboard, quindi il portale
  // non se ne accorgeva). Il ramo AGENTE resta sopra: è staff, ma confinato ai suoi clienti.
  if (nonStaffMaster(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

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
    { count: daMettereInDistinta },
    { data: clientiNegativi },
    { data: mioCredito },
  ] = await Promise.all([
    // Via ADMIN (bypassa RLS): le RPC aggregano SOLO il sotto-albero del proprio master (p_master),
    // quindi contano proprie + improprie della rete SOTTO. Con il client user-scoped l'RLS limitava
    // alle sole proprie del master (0 per chi spedisce solo tramite i sotto-master, es. E&A).
    admin.rpc('dashboard_contatori_master', { p_master: masterId }),
    admin.rpc('dashboard_statistiche_master', { p_master: masterId }),
    admin.rpc('dashboard_kpi_master', { p_master: masterId }),
    // Spedizioni recenti di tutta la rete (sé + discendenza), via admin per i permessi cross-master.
    admin.from('spedizioni').select(SPED_COLS).in('master_id', reteIds.length ? reteIds : [masterId]).order('created_at',{ascending:false}).limit(10),
    // LDV di TUTTA la rete ancora da chiudere in distinta (era una query in coda: ora nel batch).
    admin.from('spedizioni').select('id', { count: 'exact', head: true })
      .in('master_id', reteIds.length ? reteIds : [masterId])
      .is('distinta_id', null)
      .not('stato', 'in', '(annullata)'),
    // CREDITI DA RECUPERARE: clienti con saldo NEGATIVO. Le due modalita' vanno tenute DISTINTE:
    // - credito a scalare -> il cliente e' BLOCCATO (non spedisce finche' non ricarica), ma gli
    //   addebiti di giacenze/resi/rettifiche continuano a scalare: e' denaro da farsi ridare;
    //   - fattura -> andare sotto zero e' NORMALE, e' semplicemente l'importo da fatturare.
    admin.from('clienti').select('id,ragione_sociale,credito,tipo_contratto')
      .eq('master_id', masterId).lt('credito', 0).order('credito', { ascending: true }),
    // IL CREDITO DEL MASTER stesso: conto RETE (verso il master sopra) + conto PROPRIO (contratti suoi).
    // Puo' essere negativo — chi fattura va sotto zero ed e' normale (REGOLE.md).
    admin.from('masters').select('credito,credito_proprio').eq('id', masterId).maybeSingle(),
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
    creditoMaster: {
      rete: Number((mioCredito as any)?.credito || 0),
      proprio: Number((mioCredito as any)?.credito_proprio || 0),
    },
    daMettereInDistinta: daMettereInDistinta || 0,
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
    creditiDaRecuperare: (() => {
      const righe = (clientiNegativi || []) as any[]
      const scalare = righe.filter(r => (r.tipo_contratto || '') === 'credito_scalare')
      const fattura = righe.filter(r => (r.tipo_contratto || '') !== 'credito_scalare')
      const somma = (a: any[]) => Math.round(a.reduce((s, r) => s + Number(r.credito || 0), 0) * 100) / 100
      const mappa = (a: any[]) => a.slice(0, 8).map(r => ({ id: r.id, nome: r.ragione_sociale, saldo: Number(r.credito || 0) }))
      return {
        scalare: { clienti: scalare.length, totale: somma(scalare), lista: mappa(scalare) },
        fattura: { clienti: fattura.length, totale: somma(fattura), lista: mappa(fattura) },
      }
    })(),
  })
}