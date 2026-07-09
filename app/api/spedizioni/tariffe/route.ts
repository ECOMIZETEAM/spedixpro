import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import {
  spediamoproGetQuotation,
  kgToGrams, cmToMm, euroToCents, centsToEuro
} from '@/lib/spediamopro'
import { trovaZoneMatch } from '@/lib/zone-match'
import { calcolaPrezzoCorriere } from '@/lib/pricing'

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

// True se un collo supera le misure massime del corriere per il suo scaglione di PESO REALE.
// La spedizione va quindi esclusa da quel corriere. Vuoto/incompleto = nessun limite.
function superaMisureMax(settings: any, pesoReale: number, colli: any[]): boolean {
  const sc = settings?.misure_scaglioni
  const lim = (sc && sc.soglia_kg != null && sc.soglia_kg !== '')
    ? (pesoReale > Number(sc.soglia_kg) ? sc.sopra : sc.sotto)
    : settings?.misure_max
  const L = Number(lim?.lunghezza) || 0, W = Number(lim?.larghezza) || 0, H = Number(lim?.altezza) || 0
  if (!(L > 0 && W > 0 && H > 0)) return false
  const limits = [L, W, H].sort((a, b) => b - a)
  return (colli || []).some((c: any) => {
    const dims = [Number(c.length) || 0, Number(c.width) || 0, Number(c.height) || 0].sort((a, b) => b - a)
    return dims[0] > limits[0] || dims[1] > limits[1] || dims[2] > limits[2]
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json()
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id').eq('id', user.id).single()

  // Spedizione PER CONTO DI UN SOTTO-MASTER (clienteId = "m:<id>"): la trattiamo come un cliente,
  // col LISTINO CHE GLI HAI ASSEGNATO (masters.parent_listino_id, di tua proprietà → sempre
  // aggiornato: peso volume, contrassegni, sponda, misure massime dai TUOI corrieri).
  const subMatch = (typeof body.clienteId === 'string' && body.clienteId.startsWith('m:')) ? body.clienteId.slice(2) : null
  let subListinoId: string | null = null
  if (subMatch && utente?.ruolo !== 'cliente' && utente?.master_id) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: sm } = await admin.from('masters').select('parent_master_id,parent_listino_id').eq('id', subMatch).maybeSingle()
    if (!sm || sm.parent_master_id !== utente.master_id) return NextResponse.json({ error: 'Sotto-master non autorizzato' }, { status: 403 })
    subListinoId = sm.parent_listino_id || null
    if (!subListinoId) return NextResponse.json({ error: 'Il sotto-master non ha un listino assegnato. Assegnaglielo dalla scheda master.' }, { status: 400 })
  }

  // ─── SPEDIZIONE PROPRIA DEL MASTER → tariffe da LISTINO CORRIERE ───
  const isProprio = utente?.ruolo !== 'cliente' && body.clienteId === '__proprio__'
  if (isProprio) {
    const masterIdP = utente!.master_id
    const colliP = Array.isArray(body.packages) && body.packages.length ? body.packages : [body.packages?.[0] || { weight: 1 }]
    const pesoRealeP = colliP.reduce((s: number, p: any) => s + (parseFloat(p?.weight) || 0), 0) || 1
    const provinciaP = (body.shipTo?.state || '').toUpperCase().trim()
    const capP = (body.shipTo?.postalCode || '').trim()
    const paeseP = (body.shipTo?.country || 'IT').toUpperCase().trim()
    const isEsteroP = paeseP !== 'IT'

    // Corrieri da quotare = quelli che hanno delle fasce prezzo nei listini del master
    // (indipendentemente da quale listino_id: l'editor salva sotto un listino unico).
    const { data: listiniM } = await supabase.from('listini_corrieri').select('id').eq('master_id', masterIdP)
    const listinoIdsM = (listiniM || []).map((l: any) => l.id)
    let corrieriDaQuotare: any[] = []
    if (listinoIdsM.length) {
      const { data: fasceCorr } = await supabase.from('listini_corrieri_fasce').select('corriere_id').in('listino_id', listinoIdsM)
      const ids = [...new Set((fasceCorr || []).map((f: any) => f.corriere_id).filter(Boolean))]
      if (ids.length) {
        const { data: cs } = await supabase.from('corrieri').select('id,tipo,nome_contratto,attivo,settings').in('id', ids)
        corrieriDaQuotare = (cs || []).map((c: any) => ({ corriere_id: c.id, corrieri: c }))
      }
    }

    // Nessun listino corrieri (con prezzi) assegnato al master → niente tariffe.
    if (!corrieriDaQuotare.length) return NextResponse.json({ error: 'Nessun contratto attivo' }, { status: 400 })

    const risultati: any[] = []
    for (const lc of corrieriDaQuotare) {
      const corr: any = (lc as any).corrieri
      if (!corr || corr.attivo === false) continue
      if (superaMisureMax(corr.settings, pesoRealeP, colliP)) continue   // fuori misura per il suo scaglione
      const prezzo = await calcolaPrezzoCorriere(supabase, {
        corriereId: (lc as any).corriere_id, masterId: masterIdP,
        provincia: provinciaP, cap: capP, paese: paeseP,
        pesoReale: pesoRealeP, packages: colliP,
        contrassegno: Number(body.codValue || 0), assicurazione: Number(body.insuranceValue || 0),
      })
      if (prezzo == null || prezzo <= 0) continue   // nessun listino/fascia per questa zona o prezzo 0 -> non mostrare
      risultati.push({
        carrierCode: corr.tipo || 'sda', contractCode: '',
        weight_price: prezzo.toFixed(2), prezzo_spedizione: prezzo.toFixed(2),
        costo_contrassegno: '0.00', costo_assicurazione: '0.00',
        total_price: prezzo.toFixed(2), fuel: '0.00',
        zona: isEsteroP ? (PAESI[paeseP] || paeseP) : (ZONE_MAP[provinciaP] || 'Italia'),
        peso_reale: pesoRealeP, peso_volume: '0.00', peso_fatturato: pesoRealeP.toFixed(2),
        corriere_nome: corr.nome_contratto || 'Corriere', listino_fascia: 'Listino corriere',
        _corriere_tipo: corr.tipo, _corriere_id: corr.id,
      })
    }
    if (!risultati.length) return NextResponse.json({ error: 'Nessuna tariffa dal listino corriere per questa destinazione' }, { status: 400 })
    risultati.sort((a, b) => Number(a.total_price) - Number(b.total_price))
    return NextResponse.json(risultati)
  }

  const clienteId = utente?.ruolo === 'cliente' ? utente.cliente_id : body.clienteId

  let cliente: any
  if (subMatch) {
    // Sotto-master trattato come cliente: listino = quello assegnato (di tua proprietà → query ok)
    cliente = { master_id: utente!.master_id, listino_cliente_id: subListinoId }
  } else {
    const { data } = await supabase.from('clienti').select('master_id,listino_cliente_id').eq('id', clienteId).single()
    cliente = data
  }
  if (!cliente) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })

  // Mappa impostazioni per-contratto del cliente (contrassegno abilitato o no)
  const codRichiesto = Number(body.codValue || 0) > 0
  // Stato per-contratto: cliente = clienti_corrieri_abilitati; sotto-master = masters_corrieri_abilitati (admin).
  let abil: any[] = []
  if (subMatch) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data } = await admin.from('masters_corrieri_abilitati').select('corriere_id, abilitato, settings').eq('master_id', subMatch)
    abil = data || []
  } else {
    const { data } = await supabase.from('clienti_corrieri_abilitati').select('corriere_id, abilitato, settings').eq('cliente_id', clienteId)
    abil = data || []
  }
  const contrassegnoOff = new Set(
    abil.filter((a:any) => a.settings && a.settings.contrassegno === 'no').map((a:any) => a.corriere_id)
  )
  // Contratti DISABILITATI dal padre/master → esclusi dalle tariffe.
  const disabilitati = new Set(abil.filter((a:any) => a.abilitato === false).map((a:any) => a.corriere_id))

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

  // Sponda idraulica: sopra soglia_kg si aggiunge prezzo_kg € per ogni kg oltre la soglia (peso fatturato).
  const spondaPerCorriere = new Map<string, { soglia: number; prezzoKg: number }>()
  if (cliente.listino_cliente_id) {
    const { data: supplS } = await supabase
      .from('listini_clienti_supplementi')
      .select('corriere_id, descrizione, valore')
      .eq('listino_id', cliente.listino_cliente_id).eq('tipo', 'sponda')
    for (const s of (supplS || [])) {
      let d:any = null; try { d = JSON.parse(s.descrizione) } catch {}
      const soglia = Number(d?.soglia_kg) || 0
      const prezzoKg = Number(s.valore) || 0
      if (soglia > 0 && prezzoKg > 0) spondaPerCorriere.set(s.corriere_id, { soglia, prezzoKg })
    }
  }
  function calcolaSponda(corriereId: string, pesoFatt: number): number {
    const cfg = spondaPerCorriere.get(corriereId)
    if (!cfg) return 0
    // La soglia è solo il trigger: da lì in su il prezzo/kg si applica sul TOTALE dei kg.
    if (pesoFatt < cfg.soglia) return 0
    return Math.round(pesoFatt * cfg.prezzoKg * 100) / 100
  }

  // Extra / servizi accessori per corriere (dal listino cliente): opzioni che il cliente
  // può aggiungere alla spedizione. Solo elencati qui; l'importo scelto si somma in creazione.
  const accessoriPerCorriere = new Map<string, {nome:string,prezzo:number,perc:number}[]>()
  if (cliente.listino_cliente_id) {
    const { data: supplX } = await supabase
      .from('listini_clienti_supplementi')
      .select('corriere_id, nome, descrizione, valore')
      .eq('listino_id', cliente.listino_cliente_id).eq('tipo', 'accessorio')
    for (const s of (supplX || [])) {
      let d:any = null; try { d = JSON.parse(s.descrizione) } catch {}
      const nome = s.nome || d?.nome || ''
      const prezzo = Number(d?.prezzo ?? s.valore ?? 0) || 0
      const perc = Number(d?.perc ?? 0) || 0
      if (!nome || (prezzo <= 0 && perc <= 0)) continue
      if (!accessoriPerCorriere.has(s.corriere_id)) accessoriPerCorriere.set(s.corriere_id, [])
      accessoriPerCorriere.get(s.corriere_id)!.push({ nome, prezzo, perc })
    }
  }

  // Base percentuale: 'totale' = intero importo del supplemento; 'differenza' = importo
  // meno il massimo della PRIMA fascia (es. franchigia 500€ → % solo sull'eccedenza).
  function calcolaAssicurazione(corriereId: string, _prezzoSped: number): number | null {
    if (assicImporto <= 0) return 0
    const scal = scaglioniAssicPerCorriere.get(corriereId)
    if (!scal || !scal.length) return 0
    const s = scal.find(x => assicImporto <= x.valore_max)
    if (!s) return null
    const primaFasciaMax = Number(scal[0]?.valore_max) || 0
    const base = s.calcolo_su === 'differenza' ? Math.max(0, assicImporto - primaFasciaMax) : assicImporto
    return s.prezzo_fisso + (s.perc/100) * base
  }

  function calcolaContrassegno(corriereId: string, _prezzoSped: number): number | null {
    if (codImporto <= 0) return 0
    const scal = scaglioniContrPerCorriere.get(corriereId)
    // COD richiesto ma NESSUNA tariffa contrassegno configurata sul listino → corriere non disponibile.
    if (!scal || !scal.length) return null
    const s = scal.find(x => codImporto <= x.valore_max)
    if (!s) return null // importo oltre il massimo → corriere non disponibile
    const primaFasciaMax = Number(scal[0]?.valore_max) || 0
    const base = s.calcolo_su === 'differenza' ? Math.max(0, codImporto - primaFasciaMax) : codImporto
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

  // ─── NESSUN LISTINO ASSEGNATO → nessun prezzo, nessun corriere ───────────
  // Finché non gli viene assegnato un listino con i suoi prezzi, non deve vedere tariffe.
  if (!cliente.listino_cliente_id) {
    return NextResponse.json({ error: 'Nessun contratto attivo' }, { status: 400 })
  }

  // ─── LISTINO CLIENTE → prezzo da DB + corriere reale da fascia ───────────
  const { data: listino } = await supabase
    .from('listini_clienti').select('fattore_volume,solo_peso_reale').eq('id', cliente.listino_cliente_id).single()
  const fattore = parseFloat(listino?.fattore_volume) || 5000

  let pesoVolume = 0
  for (const p of tuttiColli) {
    if (p?.length && p?.width && p?.height) pesoVolume += (p.length * p.width * p.height) / fattore
  }
  // Se il listino è "solo peso reale", il volumetrico viene ignorato: si paga sempre sul peso reale.
  const pesoFatturato = listino?.solo_peso_reale ? pesoReale : Math.max(pesoReale, pesoVolume)
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

  // Match zona via zone_cap (CAP esatto > provincia > jolly), ristretto alle zone del listino
  const zoneMatchIds = await trovaZoneMatch(
    supabase,
    { paese: paeseDest, provincia, cap: capDest },
    fasce.map((f: any) => (f.zone as any)?.id).filter(Boolean)
  )

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
  let esclusiContrassegno = 0, esclusiAssic = 0, esclusiMisura = 0, esclusiFascia = 0, esclusiQuota = 0
  let ultimoErroreQuota = ''

  for (const [corriereId, fasceDelCorriere] of fascePerCorriere) {
    if (disabilitati.has(corriereId)) continue   // contratto disattivato per questo cliente/sotto-master
    const settsC = (fasceDelCorriere[0]?.corrieri as any)?.settings || {}
    // Limite misure per scaglione di PESO REALE: se un collo eccede, il corriere non è disponibile.
    if (superaMisureMax(settsC, pesoReale, tuttiColli)) { esclusiMisura++; continue }
    // Peso su cui si tassa: reale se agevolazione misure (≤50x32x28) OPPURE "peso reale fino a X kg" (≤ soglia); altrimenti volumetrico.
    const _prs = settsC?.peso_reale_soglia
    const _usaRealeSoglia = !!_prs?.attivo && Number(_prs.kg) > 0 && pesoReale <= Number(_prs.kg)
    const pesoPerFascia = ((!!settsC.agevolazione_peso_reale && entroMisureAgevolate) || _usaRealeSoglia) ? pesoReale : pesoFatturato
    const fasciaGiusta = trovaFascia(fasceDelCorriere, pesoPerFascia)
    if (!fasciaGiusta) { esclusiFascia++; continue }   // peso oltre l'ultima fascia e nessuna "oltre X ogni"
    if (Number(fasciaGiusta.prezzo) <= 0) continue   // prezzo 0 per questa zona/peso -> non mostrare il corriere
    if (codRichiesto && contrassegnoOff.has(corriereId)) continue

    const corriere = (fasciaGiusta as any).corrieri

    let spediamoproQuotation = null
    if (corriere?.tipo === 'spediamopro') {
      let quote = null
      try {
        quote = await quotaCorriere(corriere, pesoFatturato)
      } catch (e: any) { ultimoErroreQuota = String(e?.message || '') }
      spediamoproQuotation = quote?._spediamopro_quotation || null
      if (!quote) { esclusiQuota++; continue }   // il corriere non ha tariffe per queste misure/peso
    }

    if (calcolaContrassegno(corriereId, Number(fasciaGiusta.prezzo)) === null) { if (codRichiesto) esclusiContrassegno++; continue }
    if (calcolaAssicurazione(corriereId, Number(fasciaGiusta.prezzo)) === null) { if (assicImporto > 0) esclusiAssic++; continue }

    // Sponda e peso fatturato usano il peso EFFETTIVO (reale se agevolazione attiva ed entro misure, altrimenti volumetrico).
    const nolo = Number(fasciaGiusta.prezzo)
    const fuelPct = Number((fasciaGiusta as any).fuel) || 0
    const costoFuel = nolo * fuelPct / 100
    const sponda = calcolaSponda(corriereId, pesoPerFascia)
    const prezzoSped = nolo + costoFuel + sponda
    risultati.push({
      carrierCode: corriere?.tipo || 'sda',
      contractCode: '',
      weight_price: nolo.toFixed(2),
      prezzo_spedizione: prezzoSped.toFixed(2),
      costo_sponda: sponda.toFixed(2),
      costo_fuel: costoFuel.toFixed(2),
      fuel_pct: fuelPct,
      costo_contrassegno: (calcolaContrassegno(corriereId, prezzoSped) ?? 0).toFixed(2),
      costo_assicurazione: (calcolaAssicurazione(corriereId, prezzoSped) ?? 0).toFixed(2),
      total_price: (prezzoSped + (calcolaContrassegno(corriereId, prezzoSped) ?? 0) + (calcolaAssicurazione(corriereId, prezzoSped) ?? 0)).toFixed(2),
      fuel: costoFuel.toFixed(2),
      zona: isEstero ? (PAESI[paeseDest] || paeseDest) : ((fasciaGiusta as any)?.zone?.nome || zonaNome),
      peso_reale: pesoReale,
      peso_volume: pesoVolume.toFixed(2),
      peso_fatturato: pesoPerFascia.toFixed(2),   // peso EFFETTIVO su cui è calcolato il prezzo (reale se agevolazione)
      corriere_nome: corriere?.nome_contratto || 'Corriere',
      listino_fascia: `fino a ${fasciaGiusta.peso_max}kg`,
      accessori_disponibili: accessoriPerCorriere.get(corriereId) || [],
      _corriere_tipo: corriere?.tipo,
      _corriere_id: corriere?.id,
      _spediamopro_quotation: spediamoproQuotation,
    })
  }

  if (!risultati.length) {
    const pf = pesoFatturato.toFixed(2)
    if (esclusiFascia > 0) return NextResponse.json({ error: `Peso fatturato ${pf}kg (reale ${pesoReale.toFixed(2)}kg / volume ${pesoVolume.toFixed(2)}kg) oltre l'ultima fascia del listino. Aggiungi una fascia "oltre X ogni" nel listino per coprire i pesi/misure maggiori.` }, { status: 400 })
    if (esclusiMisura > 0) return NextResponse.json({ error: `Le misure del collo superano le misure massime consentite dal corriere per questo peso (Impostazioni corriere → Misure massime).` }, { status: 400 })
    if (esclusiQuota > 0) {
      const dett = /province|provincia|state/i.test(ultimoErroreQuota)
        ? ' Manca la PROVINCIA del mittente o del destinatario: completa l\'indirizzo (provincia obbligatoria per l\'Italia).'
        : ultimoErroreQuota ? ` Dettaglio corriere: ${ultimoErroreQuota.slice(0, 200)}` : ''
      return NextResponse.json({ error: `Il corriere ha rifiutato la spedizione (${pf}kg).${dett}` }, { status: 400 })
    }
    if (esclusiContrassegno > 0) return NextResponse.json({ error: 'Nessun corriere disponibile per il contrassegno richiesto: configura la tariffa contrassegno sul listino (tab Contrassegni) o riduci l\'importo.' }, { status: 400 })
    if (esclusiAssic > 0) return NextResponse.json({ error: 'Nessun corriere disponibile per l\'assicurazione richiesta: configura la tariffa assicurazione sul listino o riduci il valore.' }, { status: 400 })
    return NextResponse.json({ error: `Nessuna tariffa disponibile per ${pf}kg in zona ${zonaNome}` }, { status: 400 })
  }

  risultati.sort((a,b)=>Number(a.total_price)-Number(b.total_price))
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
  // Peso oltre l'ultima fascia e nessuna fascia "oltre X ogni": corriere non disponibile.
  return null
}
