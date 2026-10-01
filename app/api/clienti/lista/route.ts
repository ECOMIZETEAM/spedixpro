import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isProviderTecnico } from '@/lib/corriere-logo'
import { isAgente, nomeAgente } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'
export async function GET(req: NextRequest) {
  const _t0 = Date.now()
  const _log = (esito: string) => { const ms = Date.now() - _t0; if (ms > 300) console.log('[CLIENTI][TEMPI]', ms + 'ms', 'istanza=' + Math.round(process.uptime()) + 's', esito) }
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  // ?conMaster=1 -> includi i sotto-master agganciati come se fossero clienti (per i filtri)
  const conMaster = req.nextUrl.searchParams.get('conMaster') === '1'
  let qCli = supabase.from('clienti')
    .select('id,ragione_sociale,so_indirizzo,so_citta,so_provincia,so_cap,sl_citta,email,telefono,piva,codice_cliente,attivo,listino_cliente_id,tipo_contratto,credito,listini_clienti(nome)')
    .eq('master_id', utente?.master_id)
    .eq('ledger', false)   // i clienti-ledger (contabilità delle condivisioni) non compaiono nella lista
  // Agente: solo i clienti a lui assegnati.
  if (isAgente(utente)) qCli = qCli.eq('agente', nomeAgente(utente))
  const { data } = await qCli.order('ragione_sociale')
  const clienti = data || []
  const listinoIds = Array.from(new Set(clienti.map((c:any)=>c.listino_cliente_id).filter(Boolean)))
  const clienteIds = clienti.map((c:any)=>c.id)
  let agganci: any[] = []
  let stati: any[] = []
  let integrazioni: any[] = []
  if (listinoIds.length) {
    const r1 = await supabase.from('listini_clienti_corrieri').select('listino_id, corriere_id, corrieri(id,nome_contratto,tipo)').in('listino_id', listinoIds)
    agganci = r1.data || []
  }
  if (clienteIds.length) {
    const r2 = await supabase.from('clienti_corrieri_abilitati').select('cliente_id, corriere_id, abilitato').in('cliente_id', clienteIds)
    stati = r2.data || []
    // Il campo `credenziali` serve solo a ricavare l'URL del negozio (cred.shop / cred.site_url), e
    // lo legge il SERVICE_ROLE: la chiave che il negoziante ha dato al suo negozio non deve essere
    // leggibile dalla sessione di chi sta a monte nella rete. Il perimetro non cambia — `clienteIds`
    // arriva dalla lista gia' filtrata dalla RLS qui sopra.
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const r3 = await createAdminSupabase().from('integrazioni').select('cliente_id,piattaforma,nome_negozio,identificativo,stato,credenziali').in('cliente_id', clienteIds)
    integrazioni = r3.data || []
  }
  // Negozi collegati per cliente (URL sicuro calcolato server-side, mai le credenziali)
  const negoziMap = new Map<string, any[]>()
  for (const it of integrazioni) {
    if (!negoziMap.has(it.cliente_id)) negoziMap.set(it.cliente_id, [])
    negoziMap.get(it.cliente_id)!.push({
      piattaforma: (it.piattaforma || '').toLowerCase(),
      nome: it.nome_negozio || it.identificativo || it.piattaforma,
      stato: it.stato,
      url: negozioUrl(it),
    })
  }
  const abilMap = new Map(stati.map((s:any)=>[s.cliente_id + '|' + s.corriere_id, s.abilitato]))
  const perListino: any = {}
  for (const a of agganci) {
    if (!a.corrieri) continue
    if (!perListino[a.listino_id]) perListino[a.listino_id] = []
    perListino[a.listino_id].push(a.corrieri)
  }
  const clientiOut = clienti.map((c:any)=>{
    const corr = perListino[c.listino_cliente_id] || []
    const attivi = corr.filter((co:any)=>{
      const k = c.id + '|' + co.id
      return abilMap.has(k) ? abilMap.get(k) : true
    }).map((co:any)=>({ nome_contratto: co.nome_contratto, tipo: isProviderTecnico(co.tipo) ? null : co.tipo }))
    return { ...c, contratti_attivi: attivi, negozi: negoziMap.get(c.id) || [] }
  })

  // MASTER COLLEGATI (condivisione contratti): il "ledger" è il compratore visto come cliente di QUESTO
  // master. Prima lo nascondevo (vedi .eq('ledger',false) sopra); va invece mostrato come un cliente con
  // badge "Master collegato", così il venditore vede movimenti/credito e gli aggancia il suo listino —
  // come ha chiesto il flusso nuovo (niente pagina condivisioni a parte). Isolato: è un clienti del
  // venditore (RLS per master_id); l'agente non lo vede. corrieri_condivisi è solo service-role.
  let ledgerOut: any[] = []
  if (!isAgente(utente) && utente?.master_id) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: ledgers } = await admin.from('clienti')
      .select('id,ragione_sociale,so_indirizzo,so_citta,so_provincia,so_cap,sl_citta,email,telefono,piva,codice_cliente,attivo,listino_cliente_id,tipo_contratto,credito,listini_clienti(nome)')
      .eq('master_id', utente.master_id).eq('ledger', true).order('ragione_sociale')
    if (ledgers?.length) {
      const lids = ledgers.map((l:any)=>l.id)
      const { data: links } = await admin.from('corrieri_condivisi')
        .select('cliente_ledger_id,master_id,stato').in('cliente_ledger_id', lids).neq('stato','revocata')
      const buyerIds = Array.from(new Set((links||[]).map((l:any)=>l.master_id).filter(Boolean)))
      const nomi = new Map<string,string>()
      if (buyerIds.length) {
        const { data: ms } = await admin.from('masters').select('id,nome').in('id', buyerIds)
        for (const m of (ms||[])) nomi.set(m.id, m.nome)
      }
      const linkPerLedger = new Map<string,any>()
      for (const l of (links||[])) if (!linkPerLedger.has(l.cliente_ledger_id)) linkPerLedger.set(l.cliente_ledger_id, l)
      ledgerOut = ledgers.map((l:any)=>{
        const lk = linkPerLedger.get(l.id)
        return { ...l, is_ledger: true, master_collegato: lk ? (nomi.get(lk.master_id) || '—') : '—', contratti_attivi: [], negozi: [] }
      })
    }
  }
  if (conMaster && vedeLaRete(utente)) {
    // I sotto-master agganciati compaiono come pseudo-clienti (id = "m:<masterId>")
    // (mai per l'agente: non deve vedere la rete/sotto-master)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: figli } = await admin.from('masters')
      .select('id,nome,email,telefono,credito,attivo,tipo_contratto,parent_listino_id,indirizzo,citta,provincia,cap,indirizzo_operativo,citta_operativo,provincia_operativo,cap_operativo')
      .eq('parent_master_id', utente.master_id).order('nome', { ascending: true })
    // Contratti attivi del sotto-master = i suoi corrieri (come per i clienti col loro listino)
    const figliIds = (figli || []).map((m: any) => m.id)
    // Listino agganciato al sotto-master (parent_listino_id -> listini_clienti): nome per la colonna Listino
    const subListinoIds = Array.from(new Set((figli || []).map((m: any) => m.parent_listino_id).filter(Boolean)))
    const subListinoNomi = new Map<string, string>()
    if (subListinoIds.length) {
      const { data: ls } = await admin.from('listini_clienti').select('id,nome').in('id', subListinoIds)
      for (const l of (ls || [])) subListinoNomi.set(l.id, l.nome)
    }
    const corrPerSub = new Map<string, any[]>()
    if (figliIds.length) {
      const { data: corrFigli } = await admin.from('corrieri').select('master_id,nome_contratto,tipo').in('master_id', figliIds)
      for (const c of (corrFigli || [])) {
        if (!corrPerSub.has(c.master_id)) corrPerSub.set(c.master_id, [])
        corrPerSub.get(c.master_id)!.push({ nome_contratto: c.nome_contratto, tipo: isProviderTecnico(c.tipo) ? null : c.tipo })
      }
    }
    const masterOut = (figli || []).map((m: any) => ({
      id: 'm:' + m.id, ragione_sociale: m.nome || '—', is_master: true,
      email: m.email || '', telefono: m.telefono || '', credito: Number(m.credito || 0),
      attivo: m.attivo !== false, tipo_contratto: m.tipo_contratto || null,
      codice_cliente: 'SUB-MASTER', contratti_attivi: corrPerSub.get(m.id) || [],
      // Listino agganciato (come per i clienti): id per il link + nome per la colonna
      listino_cliente_id: m.parent_listino_id || null,
      listini_clienti: m.parent_listino_id ? { nome: subListinoNomi.get(m.parent_listino_id) || null } : null,
      // Indirizzo per il mittente quando spedisci per suo conto (sede operativa, fallback legale)
      so_indirizzo: m.indirizzo_operativo || m.indirizzo || '',
      so_citta: m.citta_operativo || m.citta || '',
      so_provincia: m.provincia_operativo || m.provincia || '',
      so_cap: m.cap_operativo || m.cap || '',
    }))
    _log('clienti=' + clientiOut.length + ' sottomaster=' + masterOut.length + ' collegati=' + ledgerOut.length)
    return NextResponse.json([...clientiOut, ...masterOut, ...ledgerOut])
  }
  _log('clienti=' + clientiOut.length + ' collegati=' + ledgerOut.length)
  return NextResponse.json([...clientiOut, ...ledgerOut])
}

// Link "vai al negozio" per piattaforma. Non espone mai token/segreti.
function negozioUrl(it: any): string | null {
  const p = (it.piattaforma || '').toLowerCase()
  const cred = (it.credenziali || {}) as any
  const ident = it.identificativo || ''
  const nome = it.nome_negozio || ''
  const norm = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`)
  if (p === 'shopify') { const shop = cred.shop || ident || nome; return shop ? norm(shop) : null }
  if (p === 'woocommerce' || p === 'prestashop') {
    const u = cred.site_url || cred.url || cred.store_url || cred.shop_url || nome || ident
    return u ? norm(u) : null
  }
  if (p === 'ebay') return 'https://www.ebay.it/sh/ovw'
  if (p === 'amazon') return 'https://sellercentral.amazon.it/home'
  if (p === 'tiktok') return 'https://seller.tiktokglobalshop.com'
  if (p === 'temu') return 'https://seller.temu.com'
  return null
}
