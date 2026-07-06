import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// MASSIMO (target) accetta una rimessa contrassegni ricevuta dal padre (M1):
// crea le distinte contrassegni verso i PROPRI clienti con quelle LDV e marca
// la distinta ricevuta come accettata.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
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

  // Le spedizioni corrispondenti che sono MIE (del mio master)
  const { data: spedizioni } = await admin.from('spedizioni')
    .select('id,cliente_id,contrassegno,numero,stato_contrassegno,distinta_contrassegno_id')
    .in('numero', numeri)
    .eq('master_id', mio)
    .gt('contrassegno', 0)
  if (!spedizioni?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 404 })

  // ANTI-DUPLICATO: escludo quelle già in una distinta contrassegni (già caricate)
  const daCaricare = spedizioni.filter((s: any) =>
    !s.distinta_contrassegno_id && s.stato_contrassegno !== 'in_distinta' && s.stato_contrassegno !== 'pagato'
  )
  const giaCaricate = spedizioni.length - daCaricare.length

  // Raggruppa per cliente e crea una distinta contrassegni per ciascun cliente
  const clientiMap: Record<string, any[]> = {}
  for (const s of daCaricare) {
    if (!s.cliente_id) continue
    if (!clientiMap[s.cliente_id]) clientiMap[s.cliente_id] = []
    clientiMap[s.cliente_id].push(s)
  }

  let create = 0
  for (const [clienteId, sped] of Object.entries(clientiMap)) {
    const totale = sped.reduce((acc, s) => acc + Number(s.contrassegno || 0), 0)
    const { data: distinta } = await admin.from('distinte_contrassegni').insert({
      master_id: mio,
      cliente_id: clienteId,
      totale_iniziale: totale,
      totale_rimborsato: totale,
      stato: 'in_lavorazione',
    }).select().single()
    if (!distinta) continue
    const righe = sped.map(s => ({
      distinta_id: distinta.id,
      spedizione_id: s.id,
      numero_spedizione: s.numero,
      importo_cod: Number(s.contrassegno),
      importo_sistema: Number(s.contrassegno),
    }))
    await admin.from('distinte_contrassegni_righe').insert(righe)
    await admin.from('spedizioni').update({
      stato_contrassegno: 'in_distinta',
      distinta_contrassegno_id: distinta.id,
    }).in('id', sped.map(s => s.id))
    create++
  }

  // Marca la rimessa ricevuta come accettata
  await admin.from('distinte_contrassegni')
    .update({ accettata_target: true, accettata_target_at: new Date().toISOString() })
    .eq('id', distintaId)

  return NextResponse.json({ success: true, distinteCreate: create, giaCaricate })
}
