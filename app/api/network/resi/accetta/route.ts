import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { calcolaPrezzoListino } from '@/lib/pricing'

// Il master accetta un RESO ricevuto dalla rete e lo PROPAGA:
// - spedizioni dei propri clienti -> distinta reso verso il cliente (addebito nolo)
// - spedizioni di un sotto-master  -> distinta reso verso il sotto-master (prima linea),
//   che poi accetterà a sua volta.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
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
    .select('id,numero,master_id,cliente_id,dest_provincia,dest_cap,dest_paese,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,corriere_id,costo_totale')
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
    const { count } = await admin.from('distinte_resi').select('*', { count: 'exact', head: true }).eq('master_id', mio)
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
    for (const s of arr) {
      await admin.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', s.id)
      let costoReso = 0
      if (cli?.listino_cliente_id) {
        const packages = (Array.isArray(s.colli_dettaglio) && s.colli_dettaglio.length)
          ? s.colli_dettaglio.map((c: any) => ({ weight: s.peso_reale || 1, length: c.lunghezza, width: c.larghezza, height: c.altezza }))
          : [{ weight: s.peso_reale || 1, length: s.lunghezza, width: s.larghezza, height: s.altezza }]
        const ris = await calcolaPrezzoListino(admin, {
          listinoId: cli.listino_cliente_id, provincia: s.dest_provincia || '', cap: s.dest_cap || '', paese: s.dest_paese || 'IT',
          packages, corriereId: s.corriere_id,
        })
        costoReso = ris?.prezzo || 0
      }
      if (!(costoReso > 0)) costoReso = Math.max(0, Number(s.costo_totale || 0))
      totale += costoReso
      // Addebito atomico al credito del cliente (RPC transazionale)
      if (costoReso > 0) {
        try {
          await registraMovimento(admin, {
            masterId: mio, clienteId, tipo: 'reso', descrizione: `Reso ${s.numero}`,
            importo: -costoReso, spedizioneId: s.id, createdBy: user.id,
          })
        } catch (e) { console.error('Errore addebito reso cliente:', e) }
      }
    }
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
    for (const s of arr) {
      await admin.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', s.id)
      const { data: mov } = await admin.from('movimenti')
        .select('importo').eq('spedizione_id', s.id).eq('master_target_id', flId).eq('tipo', 'spedizione').limit(1).maybeSingle()
      const costoReso = Math.abs(Number(mov?.importo || 0))
      if (costoReso <= 0) continue
      totale += costoReso
      try {
        await registraMovimentoMaster(admin, {
          masterOwnerId: mio, masterTargetId: flId, tipo: 'reso', descrizione: `Reso ${s.numero}`,
          importo: -costoReso, spedizioneId: s.id, createdBy: user.id,
        })
      } catch (e) { console.error('Errore addebito reso sotto-master:', e) }
    }
    await admin.from('distinte_resi').update({ totale }).eq('id', dist.id)
    create++
  }

  await admin.from('distinte_resi')
    .update({ accettata_target: true, accettata_target_at: new Date().toISOString() })
    .eq('id', distintaId)

  return NextResponse.json({ success: true, distinteCreate: create, giaCaricate })
}
