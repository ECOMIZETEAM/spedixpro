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
const PAESI: Record<string,string> = {
  IT:'Italia', DE:'Germania', FR:'Francia', ES:'Spagna', BE:'Belgio', IE:'Irlanda',
  DK:'Danimarca', LU:'Lussemburgo', MC:'Monaco', NL:'Paesi Bassi', PT:'Portogallo',
  AT:'Austria', FI:'Finlandia', SE:'Svezia', SI:'Slovenia', CZ_C:'Rep. Ceca',
  HR:'Croazia', GR:'Grecia', PL:'Polonia', SK:'Slovacchia', HU:'Ungheria',
  BG:'Bulgaria', EE:'Estonia', LV:'Lettonia', LT:'Lituania', RO:'Romania', GB:'Regno Unito',
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

  // Mappa impostazioni per-contratto del cliente (contrassegno abilitato o no)
  const codRichiesto = Number(body.codValue || 0) > 0
  const { data: abil } = await supabase
    .from('clienti_corrieri_abilitati').select('corriere_id, settings').eq('cliente_id', clienteId)
  const contrassegnoOff = new Set(
    (abil || []).filter((a:any) => a.settings && a.settings.contrassegno === 'no').map((a:any) => a.corriere_id)
  )

  // Scaglioni contrassegno per corriere (dal listino del cliente)
  const codImporto = Number(body.codValue || 0)
  const scaglioniContrPerCorriere = new Map<string, any[]>()
  if (cliente.listino_cliente_id && codImporto > 0) {
    const { data: suppl } = await supabase
      .from('listini_clienti_supplementi')
      .select('corriere_id, descrizione, valore, tipo_calcolo')
      .eq('listino_id', cliente.listino_cliente_id).eq('tipo', 'contrassegno')
    for (const s of (suppl || [])) {
      let d:any = null; try { d = JSON.parse(s.descrizione) } catch {}
      const scal = {
        valore_max: parseFloat(d?.valore_max ?? '') || 0,
        prezzo_fisso: parseFloat(d?.prezzo_fisso ?? s.valore ?? '') || 0,
        perc: parseFloat(d?.perc ?? '') || 0,
        calcolo_su: d?.calcolo_su || s.tipo_calcolo || 'totale',
      }
      if (!scaglioniContrPerCorriere.has(s.corriere_id)) scaglioniContrPerCorriere.set(s.corriere_id, [])
      scaglioniContrPerCorriere.get(s.corriere_id)!.push(scal)
    }
    for (const arr of scaglioniContrPerCorriere.values()) arr.sort((a,b)=>a.valore_max - b.valore_max)
  }

  // Scaglioni assicurazione per corriere (stessa dinamica del contrassegno)
  const assicImporto = Number(body.insuranceValue || 0)
  const scaglioniAssicPerCorriere = new Map<string, any[]>()
  if (cliente.listino_cliente_id && assicImporto > 0) {
    const { data: supplA } = await supabase
      .from('listini_clienti_supplementi')
      .select('corriere_id, descrizione, valore, tipo_calcolo')
      .eq('listino_id', cliente.listino_cliente_id).eq('tipo', 'assicurazione')
    for (const s of (supplA || [])) {
      let d:any = null; try { d = JSON.parse(s.descrizione) } catch {}
      const scal = {
        valore_max: parseFloat(d?.valore_max ?? '') || 0,
        prezzo_fisso: parseFloat(d?.prezzo_fisso ?? s.valore ?? '') || 0,
        perc: parseFloat(d?.perc ?? '') || 0,
        calcolo_su: d?.calcolo_su || s.tipo_calcolo || 'totale',
      }
      if (!scaglioniAssicPerCorriere.has(s.corriere_id)) scaglioniAssicPerCorriere.set(s.corriere_id, [])
      scaglioniAssicPerCorriere.get(s.corriere_id)!.push(scal)
    }
    for (const arr of scaglioniAssicPerCorriere.values()) arr.sort((a,b)=>a.valore_max - b.valore_max)
  }

  function calcolaAssicurazione(corriereId: string, prezzoSped: number): number | null {
    if (assicImporto <= 0) return 0
    const scal = scaglioniAssicPerCorriere.get(corriereId)
    if (!scal || !scal.length) return 0
    const s = scal.find(x => assicImporto <= x.valore_max)
    if (!s) return null
    let base = prezzoSped
    if (s.calcolo_su === 'valore_merce') base = Number(body.valoreMerce || 0)
    else if (s.calcolo_su === 'nolo') base = prezzoSped
    return s.prezzo_fisso + (s.perc/100) * base
  }

  function calcolaContrassegno(corriereId: string, prezzoSped: number): number | null {
    if (codImporto <= 0) return 0
    const scal = scaglioniContrPerCorriere.get(corriereId)
    if (!scal || !scal.length) return 0
    const s = scal.find(x => codImporto <= x.valore_max)
    if (!s) return null // importo oltre il massimo → corriere non disponibile
    let base = prezzoSped
    if (s.calcolo_su === 'valore_merce') base = Number(body.valoreMerce || 0)
    else if (s.calcolo_su === 'nolo') base = prezzoSped
    return s.prezzo_fisso + (s.perc/100) * base
  }

  const masterId = cliente.master_id
  const pkg = body.packages?.[0]
  const tuttiColli = Array.isArray(body.packages) && body.packages.length ? body.packages : [pkg]
  const pesoReale = tuttiColli.reduce((s:number,p:any) => s + (parseFloat(p?.weight) || 0), 0) || 1
  const provincia = (body.shipTo?.state || '').toUpperCase().trim()
  const capDest = (body.shipTo?.postalCode || '').trim()
  const paeseDest = (body.shipTo?.country || 'IT').toUpperCase().trim()
  const isEstero = paeseDest !== 'IT'
  const zonaNome = ZONE_MAP[provincia] || 'Italia'
  // Zona da zone_cap: match per paese, con priorita CAP esatto > provincia > jolly.
  // Vale sia per Italia che estero. Fallback a ZONE_MAP piu sotto se nessun match.
  let zoneMatchIds: string[] = []
  {
    const { data: zc } = await supabase.from('zone_cap').select('zona_id,provincia,cap').eq('paese', paeseDest)
    const righe = zc || []
    // 1) CAP esatto
    let match = righe.filter((r: any) => r.cap && r.cap !== '*' && r.cap === capDest)
    // 2) provincia (cap jolly)
    if (!match.length) match = righe.filter((r: any) => r.provincia && r.provincia !== '*' && r.provincia.toUpperCase() === provincia && (!r.cap || r.cap === '*'))
    // 3) jolly totale (paese, provincia * cap *) -> tipico estero
    if (!match.length) match = righe.filter((r: any) => (!r.provincia || r.provincia === '*') && (!r.cap || r.cap === '*'))
    zoneMatchIds = match.map((r: any) => r.zona_id).filter(Boolean)
  }
  // Compat: manteniamo zoneEsteroIds usato piu sotto nel filtro fasce
  let zoneEsteroIds: string[] = zoneMatchIds

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
          consignee: { name: body.shipTo.name, address: body.shipTo.street1, postalCode: body.shipTo.postalCode, city: body.shipTo.city, province: isEstero ? (body.shipTo.state || body.shipTo.city || '-') : body.shipTo.state, country: body.shipTo.country || 'IT', phone: body.shipTo.phone, email: body.shipTo.email },
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
      } catch (e: any) {
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
      fuel: '0.00', zona: isEstero ? (PAESI[paeseDest] || paeseDest) : zonaNome, peso_reale: pesoReale,
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
  for (const p of tuttiColli) {
    if (p?.length && p?.width && p?.height) pesoVolume += (p.length * p.width * p.height) / fattore
  }
  const pesoFatturato = Math.max(pesoReale, pesoVolume)
  const entroMisureAgevolate = tuttiColli.every((p: any) => {
    const L = Number(p?.length)||0, W = Number(p?.width)||0, H = Number(p?.height)||0
    if (!L && !W && !H) return true
    const dims = [L, W, H].sort((a,b)=>b-a); const lim = [50, 32, 28]
    return dims[0] <= lim[0] && dims[1] <= lim[1] && dims[2] <= lim[2]
  })

  const { data: fasce } = await supabase
    .from('listini_clienti_fasce')
    .select('*, zone(id,nome), corrieri(id,tipo,nome_contratto,credenziali,settings)')
    .eq('listino_id', cliente.listino_cliente_id)
    .order('peso_max', { ascending: true })

  if (!fasce?.length) {
    return NextResponse.json({ error: 'Listino vuoto — configura le fasce prezzi' }, { status: 400 })
  }

  let fasceZona
  // 1) Prova zone_cap (match per CAP/provincia/paese) - vale Italia ed estero
  fasceZona = zoneMatchIds.length ? fasce.filter(f => zoneMatchIds.includes((f.zone as any)?.id)) : []
  if (isEstero) {
    if (!fasceZona.length) {
      return NextResponse.json({ error: `Nessuna tariffa disponibile per spedizioni verso ${paeseDest}` }, { status: 400 })
    }
  } else {
    // 2) Fallback ZONE_MAP per l'Italia se zone_cap non ha dato risultati
    if (!fasceZona.length) {
      fasceZona = fasce.filter(f => (f.zone as any)?.nome === zonaNome)
    }
    if (!fasceZona.length) {
      fasceZona = fasce.filter(f => (f.zone as any)?.nome === 'Italia')
    }
    if (!fasceZona.length) {
      return NextResponse.json({ error: `Nessuna fascia prezzo per zona ${zonaNome}` }, { status: 400 })
    }
  }

  // *** FIX: raggruppa le fasce per corriere, trova la fascia giusta PER OGNI corriere ***
  const fascePerCorriere = new Map<string, any[]>()
  for (const f of fasceZona) {
    const corriereId = (f.corrieri as any)?.id
    if (!corriereId) continue
    if (!fascePerCorriere.has(corriereId)) fascePerCorriere.set(corriereId, [])
    fascePerCorriere.get(corriereId)!.push(f)
  }

  if (!fascePerCorriere.size) {
    return NextResponse.json({ error: `Nessuna fascia prezzo per zona ${zonaNome}` }, { status: 400 })
  }

  const risultati: any[] = []

  for (const [corriereId, fasceDelCorriere] of fascePerCorriere) {
    const settsC = (fasceDelCorriere[0]?.corrieri as any)?.settings || {}
    const pesoPerFascia = (!!settsC.agevolazione_peso_reale && entroMisureAgevolate) ? pesoReale : pesoFatturato
    const fasciaGiusta = trovaFascia(fasceDelCorriere, pesoPerFascia)
    if (!fasciaGiusta) continue
    if (codRichiesto && contrassegnoOff.has(corriereId)) continue

    const corriere = (fasciaGiusta as any).corrieri

    let spediamoproQuotation = null
    if (corriere?.tipo === 'spediamopro') {
      let quote = null
      try {
        quote = await quotaCorriere(corriere, pesoFatturato)
      } catch {}
      spediamoproQuotation = quote?._spediamopro_quotation || null
      if (!quote) continue
    }

    if (calcolaContrassegno(corriereId, Number(fasciaGiusta.prezzo)) === null) continue
    if (calcolaAssicurazione(corriereId, Number(fasciaGiusta.prezzo)) === null) continue

    risultati.push({
      carrierCode: corriere?.tipo || 'sda',
      contractCode: '',
      weight_price: Number(fasciaGiusta.prezzo).toFixed(2),
      prezzo_spedizione: Number(fasciaGiusta.prezzo).toFixed(2),
      costo_contrassegno: (calcolaContrassegno(corriereId, Number(fasciaGiusta.prezzo)) ?? 0).toFixed(2),
      costo_assicurazione: (calcolaAssicurazione(corriereId, Number(fasciaGiusta.prezzo)) ?? 0).toFixed(2),
      total_price: (Number(fasciaGiusta.prezzo) + (calcolaContrassegno(corriereId, Number(fasciaGiusta.prezzo)) ?? 0) + (calcolaAssicurazione(corriereId, Number(fasciaGiusta.prezzo)) ?? 0)).toFixed(2),
      fuel: '0.00',
      zona: isEstero ? (PAESI[paeseDest] || paeseDest) : zonaNome,
      peso_reale: pesoReale,
      peso_volume: pesoVolume.toFixed(2),
      peso_fatturato: pesoFatturato.toFixed(2),
      corriere_nome: corriere?.nome_contratto || 'Corriere',
      listino_fascia: `fino a ${fasciaGiusta.peso_max}kg`,
      _corriere_tipo: corriere?.tipo,
      _corriere_id: corriere?.id,
      _spediamopro_quotation: spediamoproQuotation,
    })
  }

  if (!risultati.length) {
    return NextResponse.json({ error: `Nessuna tariffa disponibile per ${pesoFatturato.toFixed(2)}kg in zona ${zonaNome}` }, { status: 400 })
  }

  return NextResponse.json(risultati)
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
