import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { createAdminSupabase } from '@/lib/supabase-admin'

// MASSIMO (target) accetta una rimessa contrassegni ricevuta dal padre (M1):
// crea le distinte contrassegni verso i PROPRI clienti con quelle LDV e marca
// la distinta ricevuta come accettata.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = no scrittura / no rete
  if (!utente?.master_id || utente.ruolo === 'cliente') {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  const mio = utente.master_id
  const body = await req.json()
  const distintaId = body.distintaId
  if (!distintaId) return NextResponse.json({ error: 'distintaId mancante' }, { status: 400 })

  const admin = createAdminSupabase()

  // La distinta ricevuta deve essere indirizzata al MIO master
  const { data: ricevuta } = await admin.from('distinte_contrassegni')
    .select('id,target_master_id,accettata_target')
    .eq('id', distintaId).maybeSingle()
  if (!ricevuta || ricevuta.target_master_id !== mio) {
    return NextResponse.json({ error: 'Rimessa non trovata o non tua' }, { status: 404 })
  }
  if (ricevuta.accettata_target) {
    return NextResponse.json({ error: 'Rimessa già accettata' }, { status: 400 })
  }

  // LDV incluse nella rimessa
  const { data: righeRic } = await admin.from('distinte_contrassegni_righe')
    .select('numero_spedizione').eq('distinta_id', distintaId)
  const numeri = (righeRic || []).map((r: any) => r.numero_spedizione).filter(Boolean)
  if (!numeri.length) return NextResponse.json({ error: 'Nessuna LDV nella rimessa' }, { status: 400 })

  // Spedizioni della rimessa (MIE o dei miei SOTTO-MASTER): la rimessa è indirizzata a me, quindi le
  // LDV sono legittimamente del mio sotto-albero. Le prendo TUTTE (non solo master_id=mio) per poter
  // RIPROPAGARE ai sotto-master → cascata multi-livello a qualsiasi profondità (come i resi).
  const { data: spedizioni } = await admin.from('spedizioni')
    .select('id,master_id,cliente_id,contrassegno,numero')
    .in('numero', numeri)
    .gt('contrassegno', 0)
  if (!spedizioni?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 404 })

  // Prima linea per ogni discendente: il figlio DIRETTO attraverso cui discende (come resi/elenco).
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

  // ANTI-DUPLICATO PER-MASTER: escludo le spedizioni già presenti in una distinta creata da ME
  // (una LDV può stare in una distinta a OGNI livello della catena, ma non due volte sullo stesso).
  const { data: mieDist } = await admin.from('distinte_contrassegni').select('id').eq('master_id', mio)
  const mieIds = (mieDist || []).map((d: any) => d.id)
  const giaMie = new Set<string>()
  if (mieIds.length) {
    const { data: mieRighe } = await admin.from('distinte_contrassegni_righe').select('spedizione_id').in('distinta_id', mieIds)
    for (const r of (mieRighe || [])) if (r.spedizione_id) giaMie.add(r.spedizione_id)
  }
  const daCaricare = spedizioni.filter((s: any) => !giaMie.has(s.id))
  const giaCaricate = spedizioni.length - daCaricare.length

  // DUE RAMI: spedizioni MIE → distinta al cliente; spedizioni di un SOTTO-MASTER → rimessa verso la
  // sua PRIMA LINEA (che a sua volta accetterà e ripropagherà).
  const clientiMap: Record<string, any[]> = {}
  const masterMap: Record<string, any[]> = {}
  for (const s of daCaricare) {
    if (s.master_id === mio) {
      if (!s.cliente_id) continue
      ;(clientiMap[s.cliente_id] = clientiMap[s.cliente_id] || []).push(s)
    } else {
      const fl = primaLinea.get(s.master_id)
      if (!fl) continue
      ;(masterMap[fl] = masterMap[fl] || []).push(s)
    }
  }

  let create = 0
  // Verso i miei CLIENTI (livello finale): marco le spedizioni come in_distinta.
  for (const [clienteId, sped] of Object.entries(clientiMap)) {
    const totale = sped.reduce((acc, s) => acc + Number(s.contrassegno || 0), 0)
    const { data: distinta } = await admin.from('distinte_contrassegni').insert({
      master_id: mio, cliente_id: clienteId, totale_iniziale: totale, totale_rimborsato: totale, stato: 'in_lavorazione',
    }).select().single()
    if (!distinta) continue
    await admin.from('distinte_contrassegni_righe').insert(sped.map(s => ({
      distinta_id: distinta.id, spedizione_id: s.id, numero_spedizione: s.numero,
      importo_cod: Number(s.contrassegno), importo_sistema: Number(s.contrassegno),
    })))
    await admin.from('spedizioni').update({ stato_contrassegno: 'in_distinta', distinta_contrassegno_id: distinta.id }).in('id', sped.map(s => s.id))
    create++
  }
  // Verso i SOTTO-MASTER (rimessa): NON marco le spedizioni (le marcherà il sotto-master quando crea
  // le distinte ai suoi clienti); l'anti-duplicato è garantito dal per-master giaMie.
  for (const [flId, sped] of Object.entries(masterMap)) {
    const totale = sped.reduce((acc, s) => acc + Number(s.contrassegno || 0), 0)
    const { data: distinta } = await admin.from('distinte_contrassegni').insert({
      master_id: mio, target_master_id: flId, totale_iniziale: totale, totale_rimborsato: totale, stato: 'in_lavorazione',
    }).select().single()
    if (!distinta) continue
    await admin.from('distinte_contrassegni_righe').insert(sped.map(s => ({
      distinta_id: distinta.id, spedizione_id: s.id, numero_spedizione: s.numero,
      importo_cod: Number(s.contrassegno), importo_sistema: Number(s.contrassegno),
    })))
    create++
  }

  // Marca la rimessa ricevuta come accettata
  await admin.from('distinte_contrassegni')
    .update({ accettata_target: true, accettata_target_at: new Date().toISOString() })
    .eq('id', distintaId)

  return NextResponse.json({ success: true, distinteCreate: create, giaCaricate })
}
