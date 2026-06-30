import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

const ZONE_MAP: Record<string,string> = {
  CA:'Sardegna',CI:'Sardegna',VS:'Sardegna',NU:'Sardegna',OG:'Sardegna',OT:'Sardegna',OR:'Sardegna',SS:'Sardegna',
  AG:'Sicilia',CL:'Sicilia',CT:'Sicilia',EN:'Sicilia',ME:'Sicilia',PA:'Sicilia',RG:'Sicilia',SR:'Sicilia',TP:'Sicilia',
  CS:'Calabria',CZ:'Calabria',KR:'Calabria',RC:'Calabria',VV:'Calabria',
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json()
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()

  // clienteId: se cliente loggato usa il suo, altrimenti usa quello passato dal master
  const clienteId = utente?.ruolo === 'cliente' ? utente.cliente_id : body.clienteId

  // Prendi dati cliente incluso master_id e listino
  const { data: cliente } = await supabase
    .from('clienti').select('master_id,listino_cliente_id').eq('id', clienteId).single()

  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })

  const masterId = cliente.master_id
  const pkg = body.packages?.[0]
  const pesoReale = parseFloat(pkg?.weight || 1)
  const provincia = (body.shipTo?.state || '').toUpperCase().trim()
  const zonaNome = ZONE_MAP[provincia] || 'Italia'

  // Se nessun listino → fallback spedisci.online
  if (!cliente.listino_cliente_id) {
    const { data: corriere } = await supabase.from('corrieri').select('credenziali').eq('master_id', masterId).eq('tipo','spedisci').single()
    if (!corriere) return NextResponse.json({ error: 'Nessun corriere configurato' }, { status: 400 })
    const cred = corriere.credenziali as Record<string,string>
    const res = await fetch(`https://${cred.master_domain}/api/v2/shipping/rates`, {
      method:'POST', headers:{'Authorization':`Bearer ${cred.password}`,'Content-Type':'application/json'},
      body: JSON.stringify({ packages:body.packages, shipFrom:body.shipFrom, shipTo:body.shipTo, notes:'', insuranceValue:0, codValue:body.codValue||0, accessoriServices:[] })
    })
    const rates = await res.json()
    return NextResponse.json(Array.isArray(rates) ? rates : [])
  }

  // Prendi listino con fattore volume
  const { data: listino } = await supabase
    .from('listini_clienti').select('fattore_volume').eq('id', cliente.listino_cliente_id).single()
  const fattore = parseFloat(listino?.fattore_volume) || 5000

  // Calcola peso volumetrico
  let pesoVolume = 0
  if (pkg?.length && pkg?.width && pkg?.height) {
    pesoVolume = (pkg.length * pkg.width * pkg.height) / fattore
  }
  const pesoFatturato = Math.max(pesoReale, pesoVolume)

  console.log(`Peso reale: ${pesoReale}kg | Vol: ${pesoVolume.toFixed(2)}kg | Fatturato: ${pesoFatturato.toFixed(2)}kg | Zona: ${zonaNome}`)

  // Trova zona per master
  const { data: zona } = await supabase
    .from('zone').select('id').eq('nome', zonaNome).eq('master_id', masterId).single()

  // Prendi fasce listino cliente
  const { data: fasce } = await supabase
    .from('listini_clienti_fasce')
    .select('*, zone(nome), corrieri(tipo,nome_contratto)')
    .eq('listino_id', cliente.listino_cliente_id)
    .order('peso_max', { ascending: true })

  if (!fasce?.length) {
    return NextResponse.json({ error: 'Listino vuoto — configura le fasce prezzi' }, { status: 400 })
  }

  // Filtra per zona corretta
  let fasceZona = fasce.filter(f => f.zona_id === zona?.id)

  // Fallback su Italia
  if (!fasceZona.length) {
    const { data: zonaIt } = await supabase.from('zone').select('id').eq('nome','Italia').eq('master_id', masterId).single()
    fasceZona = fasce.filter(f => f.zona_id === zonaIt?.id)
  }

  if (!fasceZona.length) {
    return NextResponse.json({ error: `Nessuna fascia prezzo per zona ${zonaNome}` }, { status: 400 })
  }

  const fasciaGiusta = trovaFascia(fasceZona, pesoFatturato)
  if (!fasciaGiusta) {
    return NextResponse.json({ error: `Nessuna fascia per ${pesoFatturato.toFixed(2)}kg` }, { status: 400 })
  }

  // Prendi anche corriere per il nome
  const { data: corriere } = await supabase.from('corrieri').select('tipo,nome_contratto').eq('master_id', masterId).eq('tipo','spedisci').single()

  return NextResponse.json([{
    carrierCode: corriere?.tipo || 'sda',
    contractCode: '',
    weight_price: Number(fasciaGiusta.prezzo).toFixed(2),
    total_price: Number(fasciaGiusta.prezzo).toFixed(2),
    fuel: '0.00',
    zona: zonaNome,
    peso_reale: pesoReale,
    peso_volume: pesoVolume.toFixed(2),
    peso_fatturato: pesoFatturato.toFixed(2),
    corriere_nome: corriere?.nome_contratto || 'SDA Express',
    listino_fascia: `fino a ${fasciaGiusta.peso_max}kg`,
  }])
}

function trovaFascia(fasce: any[], peso: number) {
  const finoA = fasce.filter(f => f.tipo !== 'oltre').sort((a,b) => a.peso_max - b.peso_max)
  for (const f of finoA) {
    if (peso <= parseFloat(f.peso_max)) return f
  }
  const oltre = fasce.find(f => f.tipo === 'oltre')
  if (oltre) {
    const ultima = finoA[finoA.length-1]
    if (ultima) {
      const kgExtra = peso - parseFloat(ultima.peso_max)
      const prezzoExtra = Math.ceil(kgExtra / parseFloat(oltre.peso_max)) * parseFloat(oltre.prezzo)
      return { ...ultima, prezzo: parseFloat(ultima.prezzo) + prezzoExtra }
    }
  }
  return finoA[finoA.length-1] || null
}
