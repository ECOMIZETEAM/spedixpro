import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  // ?conMaster=1 -> includi i sotto-master agganciati come se fossero clienti (per i filtri)
  const conMaster = req.nextUrl.searchParams.get('conMaster') === '1'
  const { data } = await supabase.from('clienti')
    .select('id,ragione_sociale,so_indirizzo,so_citta,so_provincia,so_cap,sl_citta,email,telefono,piva,codice_cliente,attivo,listino_cliente_id,tipo_contratto,credito,listini_clienti(nome)')
    .eq('master_id', utente?.master_id)
    .order('ragione_sociale')
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
    const r3 = await supabase.from('integrazioni').select('cliente_id,piattaforma,nome_negozio,identificativo,stato,credenziali').in('cliente_id', clienteIds)
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
    }).map((co:any)=>({ nome_contratto: co.nome_contratto, tipo: co.tipo }))
    return { ...c, contratti_attivi: attivi, negozi: negoziMap.get(c.id) || [] }
  })
  if (conMaster && utente?.master_id) {
    // I sotto-master agganciati compaiono come pseudo-clienti (id = "m:<masterId>")
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
        corrPerSub.get(c.master_id)!.push({ nome_contratto: c.nome_contratto, tipo: c.tipo })
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
    return NextResponse.json([...clientiOut, ...masterOut])
  }
  return NextResponse.json(clientiOut)
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
