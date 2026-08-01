import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { noloCliente, noloMaster, addebitaResi, pagatoDaMaster, type RigaReso } from '@/lib/reso-prezzi'
import { corriereDiMasterPerNome } from '@/lib/contratto-per-nome'

// Il master accetta un RESO ricevuto dalla rete e lo PROPAGA:
// - spedizioni dei propri clienti -> distinta reso verso il cliente (addebito nolo)
// - spedizioni di un sotto-master  -> distinta reso verso il sotto-master (prima linea),
//   che poi accetterà a sua volta.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  if (!utente?.master_id || utente.ruolo === 'cliente') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio = utente.master_id
  const { distintaId } = await req.json()
  if (!distintaId) return NextResponse.json({ error: 'distintaId mancante' }, { status: 400 })
  const admin = createAdminSupabase()

  const { data: ric } = await admin.from('distinte_resi')
    .select('id,target_master_id,accettata_target,voci').eq('id', distintaId).maybeSingle()
  if (!ric || ric.target_master_id !== mio) return NextResponse.json({ error: 'Reso non trovato o non tuo' }, { status: 404 })
  if (ric.accettata_target) return NextResponse.json({ error: 'Reso già accettato' }, { status: 400 })
  const voci: any[] = Array.isArray(ric.voci) ? ric.voci : []
  const ids = voci.map(v => v.id).filter(Boolean)
  if (!ids.length) return NextResponse.json({ error: 'Nessuna LDV nel reso' }, { status: 400 })

  const { data: speds } = await admin.from('spedizioni')
    .select('id,numero,master_id,cliente_id,dest_provincia,dest_cap,dest_paese,dest_citta,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,corriere_id,costo_totale,giacenza_reso_addebitato,corrieri(nome_contratto)')
    .in('id', ids)

  // prima linea per ogni discendente
  const primaLinea = new Map<string, string>()
  {
    let frontier = [mio]
    for (let i = 0; i < 12 && frontier.length; i++) {
      const { data: figli } = await admin.from('masters').select('id,parent_master_id').in('parent_master_id', frontier)
      const nuovi: string[] = []
      for (const c of (figli || [])) {
        if (primaLinea.has(c.id)) continue
        primaLinea.set(c.id, c.parent_master_id === mio ? c.id : (primaLinea.get(c.parent_master_id) || c.id))
        nuovi.push(c.id)
      }
      frontier = nuovi
    }
  }

  // anti-duplicato: spedizioni già in una MIA distinta reso
  const { data: mieResi } = await admin.from('distinte_resi').select('voci').eq('master_id', mio)
  const giaResi = new Set<string>()
  for (const d of (mieResi || [])) for (const v of (Array.isArray(d.voci) ? d.voci : [])) if (v?.id) giaResi.add(v.id)

  const clientGroups: Record<string, any[]> = {}
  const masterGroups: Record<string, any[]> = {}
  let giaCaricate = 0
  for (const s of (speds || [])) {
    if (giaResi.has(s.id)) { giaCaricate++; continue }
    if (s.master_id === mio) {
      if (!s.cliente_id) continue
      if (!clientGroups[s.cliente_id]) clientGroups[s.cliente_id] = []
      clientGroups[s.cliente_id].push(s)
    } else {
      const fl = primaLinea.get(s.master_id)
      if (!fl) continue
      if (!masterGroups[fl]) masterGroups[fl] = []
      masterGroups[fl].push(s)
    }
  }

  let create = 0
  const vociDi = (arr: any[]) => arr.map(s => voci.find(v => v.id === s.id) || { id: s.id, numero: s.numero })
  const nextNum = async () => {
    const { count } = await admin.from('distinte_resi').select('id', { count: 'exact', head: true }).eq('master_id', mio)
    return (count || 0) + 1
  }

  // ── Gruppi CLIENTE: addebito nolo al cliente ──
  for (const [clienteId, arr] of Object.entries(clientGroups)) {
    const { data: cli } = await admin.from('clienti').select('listino_cliente_id').eq('id', clienteId).single()
    let totale = 0
    const numero = await nextNum()
    const { data: dist } = await admin.from('distinte_resi').insert({
      master_id: mio, cliente_id: clienteId, numero, totale_ldv: arr.length, totale: 0, voci: vociDi(arr), stato: 'chiusa',
    }).select().single()
    if (!dist) continue
    const righe: RigaReso[] = []
    for (const s of arr) {
      await admin.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', s.id)
      const nolo = await noloCliente(admin, s, cli?.listino_cliente_id)
      righe.push({
        spedizione_id: s.id, cliente_id: clienteId, master_owner_id: mio, corriere_id: s.corriere_id || null,
        nolo: nolo != null ? nolo : Math.max(0, Number(s.costo_totale || 0)),
      })
    }
    // La percentuale, la guardia contro il doppio addebito (compreso il reso già pagato allo
    // svincolo giacenza) e la scrittura di tutte le voci in una transazione: le fa il database.
    try {
      for (const e of await addebitaResi(admin, righe, user.id)) totale += Number(e.importo || 0)
    } catch (e) { console.error('Errore addebito reso cliente:', e) }
    await admin.from('distinte_resi').update({ totale }).eq('id', dist.id)
    create++
  }

  // ── Gruppi SOTTO-MASTER (prima linea): addebito il prezzo che LUI ha pagato ──
  for (const [flId, arr] of Object.entries(masterGroups)) {
    let totale = 0
    const numero = await nextNum()
    const { data: dist } = await admin.from('distinte_resi').insert({
      master_id: mio, cliente_id: null, target_master_id: flId, numero, totale_ldv: arr.length, totale: 0, voci: vociDi(arr), stato: 'chiusa',
    }).select().single()
    if (!dist) continue
    const righe: RigaReso[] = []
    for (const s of arr) {
      await admin.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', s.id)
      // Il prezzo lo decide il SUO listino corrieri, quindi serve la SUA copia del contratto.
      const suoCorriere = await corriereDiMasterPerNome(admin, flId, (s as any).corrieri?.nome_contratto || null)
      righe.push({
        spedizione_id: s.id, master_target_id: flId, master_owner_id: mio, corriere_id: suoCorriere,
        nolo: (suoCorriere ? await noloMaster(admin, flId, suoCorriere, s) : null) || 0,
        pagato: await pagatoDaMaster(admin, s.id, flId),
      })
    }
    try {
      for (const e of await addebitaResi(admin, righe, user.id)) totale += Number(e.importo || 0)
    } catch (e) { console.error('Errore addebito reso sotto-master:', e) }
    await admin.from('distinte_resi').update({ totale }).eq('id', dist.id)
    create++
  }

  await admin.from('distinte_resi')
    .update({ accettata_target: true, accettata_target_at: new Date().toISOString() })
    .eq('id', distintaId)

  return NextResponse.json({ success: true, distinteCreate: create, giaCaricate })
}
