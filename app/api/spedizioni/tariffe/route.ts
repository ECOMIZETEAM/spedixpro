import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import {
  spediamoproGetQuotation,
  kgToGrams, cmToMm, euroToCents, centsToEuro
} from '@/lib/spediamopro'

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
  const clienteId = utente?.ruolo === 'cliente' ? utente.cliente_id : body.clienteId

  const { data: cliente } = await supabase
    .from('clienti').select('master_id,listino_cliente_id').eq('id', clienteId).single()

  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })

  const masterId = cliente.master_id
  const pkg = body.packages?.[0]
  const pesoReale = parseFloat(pkg?.weight || 1)
  const provincia = (body.shipTo?.state || '').toUpperCase().trim()
  const zonaNome = ZONE_MAP[provincia] || 'Italia'

  // ─── Costruisce una quotazione per un dato corriere ──────────────────────
  async function quotaCorriere(corriere: any, pesoFatt: number): Promise<any> {
    const cred = corriere.credenziali as Record<string, string>

    if (corriere.tipo === 'spedisci') {
      const res = await fetch(`https://${cred.master_domain}/api/v2/shipping/rates`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packages: body.packages, shipFrom: body.shipFrom, shipTo: body.shipTo,
          notes: '', insuranceValue: 0, codValue: body.codValue || 0, accessoriServices: []
        }),
      })
      const rates = await res.json()
      if (!Array.isArray(rates) || !rates.length) return null
      const r = rates[0]
      return {
        carrierCode: r.carrierCode, contractCode: r.contractCode,
        total_price: r.total_price, weight_price: r.weight_price,
        corriere_id: corriere.id, corriere_tipo: 'spedisci',
      }
    }

    if (corriere.tipo === 'spediamopro') {
      try {
        const quote = await spediamoproGetQuotation(cred.authcode, cred.service_id || null, {
          parcels: [{ weight: kgToGrams(pesoFatt), length: cmToMm(pkg?.length || 10), width: cmToMm(pkg?.width || 10), height: cmToMm(pkg?.height || 10) }],
          sender: { name: body.shipFrom.name, address: body.shipFrom.street1, postalCode: body.shipFrom.postalCode, city: body.shipFrom.city, province: body.shipFrom.state, country: 'IT', phone: body.shipFrom.phone, email: body.shipFrom.email },
          consignee: { name: body.shipTo.name, address: body.shipTo.street1, postalCode: body.shipTo.postalCode, city: body.shipTo.city, province: body.shipTo.state, country: body.shipTo.country || 'IT', phone: body.shipTo.phone, email: body.shipTo.email },
          cashOnDeliveryAmount: body.codValue ? euroToCents(body.codValue) : undefined,
          insuredAmount: body.insuranceValue ? euroToCents(body.insuranceValue) : undefined,
        })
        return {
          carrierCode: 'spediamopro', contractCode: String(quote.service),
          total_price: centsToEuro(quote.totalPrice || 0).toFixed(2),
          weight_price: centsToEuro(quote.totalPrice || 0).toFixed(2),
          corriere_id: corriere.id, corriere_tipo: 'spediamopro',
          _spediamopro_quotation: quote,
        }
      } catch (e) {
        return null
      }
    }
    return null
  }

  // ─── NESSUN LISTINO → tariffe live dal primo corriere disponibile ────────
  if (!cliente.listino_cliente_id) {
    const { data: corrieri } = await supabase
      .from('corrieri').select('id,tipo,credenziali,nome_contratto')
      .eq('master_id', masterId)

    if (!corrieri?.length) return NextResponse.json({ error: 'Nessun corriere configurato' }, { status: 400 })

    const corriere = corrieri.find(c => c.tipo === 'spedisci') || corrieri[0]
    const quote = await quotaCorriere(corriere, pesoReale)
    if (!quote) return NextResponse.json({ error: 'Nessuna tariffa dal corriere' }, { status: 400 })

    return NextResponse.json([{
      carrierCode: quote.carrierCode, contractCode: quote.contractCode,
      weight_price: quote.weight_price, total_price: quote.total_price,
      fuel: '0.00', zona: zonaNome, peso_reale: pesoReale,
      peso_volume: '0.00', peso_fatturato: pesoReale.toFixed(2),
      corriere_nome: corriere.nome_contratto, listino_fascia: 'Tariffa live',
      _spediamopro_quotation: quote._spediamopro_quotation,
    }])
  }

  // ─── LISTINO CLIENTE → prezzo da DB + corriere reale da fascia ───────────
  const { data: listino } = await supabase
    .from('listini_clienti').select('fattore_volume').eq('id', cliente.listino_cliente_id).single()
  const fattore = parseFloat(listino?.fattore_volume) || 5000

  let pesoVolume = 0
  if (pkg?.length && pkg?.width && pkg?.height) {
    pesoVolume = (pkg.length * pkg.width * pkg.height) / fattore
  }
  const pesoFatturato = Math.max(pesoReale, pesoVolume)

  const { data: fasce } = await supabase
    .from('listini_clienti_fasce')
    .select('*, zone(id,nome), corrieri(id,tipo,nome_contratto,credenziali)')
    .eq('listino_id', cliente.listino_cliente_id)
    .order('peso_max', { ascending: true })

  if (!fasce?.length) {
    return NextResponse.json({ error: 'Listino vuoto — configura le fasce prezzi' }, { status: 400 })
  }

  let fasceZona = fasce.filter(f => (f.zone as any)?.nome === zonaNome)
  if (!fasceZona.length) {
    fasceZona = fasce.filter(f => (f.zone as any)?.nome === 'Italia')
  }

  if (!fasceZona.length) {
    return NextResponse.json({ error: `Nessuna fascia prezzo per zona ${zonaNome}` }, { status: 400 })
  }

  const fasciaGiusta = trovaFascia(fasceZona, pesoFatturato)
  if (!fasciaGiusta) {
    return NextResponse.json({ error: `Nessuna fascia per ${pesoFatturato.toFixed(2)}kg` }, { status: 400 })
  }

  const corriere = (fasciaGiusta as any).corrieri

  // Se SpediamoPro, dobbiamo ottenere la quotation reale per poterla accettare dopo
  let spediamoproQuotation = null
  if (corriere?.tipo === 'spediamopro') {
    const quote = await quotaCorriere(corriere, pesoFatturato)
    spediamoproQuotation = quote?._spediamopro_quotation || null
  }

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
    corriere_nome: corriere?.nome_contratto || 'Corriere',
    listino_fascia: `fino a ${fasciaGiusta.peso_max}kg`,
    _corriere_tipo: corriere?.tipo,
    _corriere_id: corriere?.id,
    _spediamopro_quotation: spediamoproQuotation,
  }])
}

function trovaFascia(fasce: any[], peso: number) {
  const finoA = fasce.filter(f => f.tipo !== 'oltre').sort((a, b) => a.peso_max - b.peso_max)
  for (const f of finoA) {
    if (peso <= parseFloat(f.peso_max)) return f
  }
  const oltre = fasce.find(f => f.tipo === 'oltre')
  if (oltre) {
    const ultima = finoA[finoA.length - 1]
    if (ultima) {
      const kgExtra = peso - parseFloat(ultima.peso_max)
      const prezzoExtra = Math.ceil(kgExtra / parseFloat(oltre.peso_max)) * parseFloat(oltre.prezzo)
      return { ...ultima, prezzo: parseFloat(ultima.prezzo) + prezzoExtra }
    }
  }
  return finoA[finoA.length - 1] || null
}
