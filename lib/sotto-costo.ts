// RILEVAZIONE DEL SOTTO-COSTO — quello che un master vende ai suoi clienti sotto quello che paga lui.
//
// Sta qui e non nella rotta perche' la stessa funzione deve servire al Check Sotto Costo, a
// "Listini da adeguare" e alla verifica che rifa' il controllo su tutti i master: se ciascuno avesse
// la sua copia, al primo ritocco direbbero cifre diverse.
//
// FASCE: stessa zona, stesso peso, fuel compreso (invariato).
// SUPPLEMENTI: ognuno con la formula con cui si ADDEBITA davvero, non confrontando i numeri a vista.
// Fino al 15/10 il confronto era per "contratto + tipo + nome" e numero contro numero; su Wave 19
// righe su 21 erano false, su tutti i master circa due su tre:
// - contrassegno e assicurazione non hanno nome: tutti gli scaglioni finivano sulla stessa chiave e
//   il primo scaglione del cliente (fino a 516 €, fisso) veniva confrontato con l'ULTIMO del costo
//   (fino a 2.000 €, 2 € + 1,5%) → "null (tu 1.5%, lui 0%)" su listini identici al costo;
// - giacenze e accessori si pagano fisso + % del nolo: "0 € + 100%" contro "2 € + 0%" non perde mai;
// - una riga che MANCA nel listino del cliente non compariva, e per giacenze, apertura e sponda
//   mancare vuol dire che il cliente paga zero mentre il master paga.

import { parseScaglioniSupp, scaglioniPerPeso, supplPresenteMax, commissioneSupp, type ScaglioneSupp } from '@/lib/pricing'
import { chiaveServizioGiacenza, predefinitoGiacenzaCliente, peggioreSuNolo, type Nolo } from '@/lib/sotto-costo-formule'

export type RigaSottoCosto = {
  chiave: string
  listino_id: string; listino_nome: string; clienti: string[]
  corriere: string; zona: string
  tipo: 'fascia' | 'supplemento'
  descrizione: string
  prezzo_cliente: number; costo_tuo: number; differenza: number
  corriere_id?: string       // per il deep-link all'editor sul corriere giusto (?corriere=)
  fascia_id?: string; supplemento_id?: string
  // Riga ASSENTE nel listino del cliente: con Adegua la si crea, partendo da quello che il cliente
  // paga oggi senza riga (il predefinito), come per le righe che ci sono.
  manca?: { tipo: string; nome: string; valore: number; perc: number; soglia_kg?: number }
}

const r2 = (x: number) => Math.round(x * 100) / 100
const r4 = (x: number) => Math.round(x * 10000) / 10000   // la sponda e' in centesimi al kg
const conFuel = (prezzo: any, fuel: any) => r2((Number(prezzo) || 0) * (1 + (Number(fuel) || 0) / 100))
const percDi = (descrizione: any) => { try { return Number(JSON.parse(descrizione || '{}')?.perc) || 0 } catch { return 0 } }
const jsonDi = (descrizione: any) => { try { return JSON.parse(descrizione || '{}') || {} } catch { return {} } }
const eur = (n: number) => Number(n).toFixed(2).replace('.', ',')
const perId = (a: any, b: any) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

async function leggiTutte(admin: any, tabella: string, colonne: string, col: string, ids: string[]) {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 50) {
    for (let da = 0; ; da += 1000) {
      const { data, error } = await admin.from(tabella).select(colonne).in(col, ids.slice(i, i + 50)).order('id').range(da, da + 999)
      if (error) throw new Error(`${tabella}: ${error.message}`)
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
  }
  return out
}

export async function rilevaSottoCosto(admin: any, masterId: string): Promise<RigaSottoCosto[]> {
  const { data: mieiCorrieri } = await admin.from('corrieri').select('id,nome_contratto').eq('master_id', masterId)
  const corrIds = (mieiCorrieri || []).map((c: any) => c.id)
  if (!corrIds.length) return []
  const nomeCorr = new Map<string, string>((mieiCorrieri || []).map((c: any) => [c.id, c.nome_contratto || 'Contratto']))
  const { data: zone } = await admin.from('zone').select('id,nome,corriere_id').in('corriere_id', corrIds)
  const nomeZona = new Map<string, string>((zone || []).map((z: any) => [z.id, z.nome || 'Zona']))

  const { data: listini } = await admin.from('listini_clienti').select('id,nome').eq('master_id', masterId)
  const nomeListino = new Map<string, string>((listini || []).map((l: any) => [l.id, l.nome || 'Listino']))
  const ids = [...nomeListino.keys()]
  if (!ids.length) return []
  const clientiDi = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from('clienti').select('ragione_sociale,listino_cliente_id').in('listino_cliente_id', ids.slice(i, i + 100))
    for (const c of (data || [])) {
      const k = (c as any).listino_cliente_id
      if (!clientiDi.has(k)) clientiDi.set(k, [])
      clientiDi.get(k)!.push((c as any).ragione_sociale || '—')
    }
  }

  // ── I MIEI COSTI ──
  const costoFascia = new Map<string, number>()   // corriere|zona|peso_max -> costo mio, col fuel
  for (const f of await leggiTutte(admin, 'listini_corrieri_fasce', 'id,corriere_id,zona_id,peso_max,prezzo,fuel', 'corriere_id', corrIds)) {
    costoFascia.set(`${f.corriere_id}|${f.zona_id}|${f.peso_max}`, conFuel(f.prezzo, f.fuel))
  }
  // Supplementi di costo SOLO dai listini corriere di questo master, prima riga per id: e' cosi' che
  // li legge la catena (prezzoGiacenzaMaster, accessori in lib/cascata.ts). Esistono righe appese al
  // listino di un ALTRO master che puntano a un mio corriere: non sono il mio costo.
  const { data: listiniCorr } = await admin.from('listini_corrieri').select('id').eq('master_id', masterId)
  const mieiListiniCorr = new Set((listiniCorr || []).map((l: any) => l.id))
  const suppCosto = (await leggiTutte(admin, 'listini_corrieri_supplementi', 'id,listino_id,corriere_id,tipo,nome,valore,descrizione', 'corriere_id', corrIds))
    .filter((s: any) => mieiListiniCorr.has(s.listino_id)).sort(perId)

  // ── I MIEI LISTINI CLIENTE ──
  const righe: RigaSottoCosto[] = []
  const base = (listinoId: string, corriereId: string) => ({
    listino_id: listinoId, listino_nome: nomeListino.get(listinoId) || 'Listino',
    clienti: clientiDi.get(listinoId) || [], corriere_id: corriereId, corriere: nomeCorr.get(corriereId) || '—',
  })

  // FASCE: stessa zona, stessa fascia di peso. Intanto si raccolgono i noli fascia per fascia: sono
  // la base dei servizi a percentuale (giacenze, accessori).
  const noli = new Map<string, Nolo[]>()   // listino|corriere -> noli in comune col mio costo
  for (const f of await leggiTutte(admin, 'listini_clienti_fasce', 'id,listino_id,corriere_id,zona_id,peso_max,prezzo,fuel', 'listino_id', ids)) {
    const mioCosto = costoFascia.get(`${f.corriere_id}|${f.zona_id}|${f.peso_max}`)
    if (mioCosto == null) continue          // fascia che non ho: non ho un costo da confrontare
    const prezzo = conFuel(f.prezzo, f.fuel)
    const zona = nomeZona.get(f.zona_id) || '—'
    if (prezzo > 0) {
      const k = `${f.listino_id}|${f.corriere_id}`
      if (!noli.has(k)) noli.set(k, [])
      noli.get(k)!.push({ cliente: prezzo, costo: mioCosto, etichetta: `${zona} fino a ${f.peso_max} kg` })
    }
    if (prezzo >= mioCosto - 0.005) continue
    righe.push({
      ...base(f.listino_id, f.corriere_id), chiave: `f:${f.id}`, fascia_id: f.id, zona,
      tipo: 'fascia', descrizione: `fino a ${f.peso_max} kg`,
      prezzo_cliente: prezzo, costo_tuo: mioCosto, differenza: r2(prezzo - mioCosto),
    })
  }

  const suppCliente = (await leggiTutte(admin, 'listini_clienti_supplementi', 'id,listino_id,corriere_id,tipo,nome,valore,descrizione', 'listino_id', ids)).sort(perId)
  const clientePer = new Map<string, any[]>()   // listino|corriere -> righe supplemento del cliente
  for (const s of suppCliente) {
    const k = `${s.listino_id}|${s.corriere_id}`
    if (!clientePer.has(k)) clientePer.set(k, [])
    clientePer.get(k)!.push(s)
  }
  const costoPer = new Map<string, any[]>()     // corriere -> righe supplemento di costo
  for (const s of suppCosto) {
    if (!costoPer.has(s.corriere_id)) costoPer.set(s.corriere_id, [])
    costoPer.get(s.corriere_id)!.push(s)
  }
  // Il listino vende quel contratto se ha almeno una fascia prezzata: senza, il cliente non lo puo'
  // usare e una riga mancante non costa niente.
  const coppie = new Set<string>([...noli.keys(), ...clientePer.keys()])

  for (const k of coppie) {
    const [listinoId, corriereId] = k.split('|')
    const costo = costoPer.get(corriereId)
    if (!costo?.length) continue
    const cli = clientePer.get(k) || []
    const nolo = noli.get(k) || []
    const vende = nolo.length > 0

    // ── GIACENZE: fisso + % del nolo. Le tre operazioni che si addebitano vanno per operazione
    // (la prima riga che ci cade dentro, come l'addebito); gli altri servizi per nome.
    const chiaveG = (nome: string) => chiaveServizioGiacenza(nome) || `nome:${String(nome || '').toLowerCase().trim()}`
    const costoG = new Map<string, any>(), cliG = new Map<string, any>()
    for (const s of costo) if (s.tipo === 'giacenza' && !costoG.has(chiaveG(s.nome))) costoG.set(chiaveG(s.nome), s)
    for (const s of cli) if (s.tipo === 'giacenza' && !cliG.has(chiaveG(s.nome))) cliG.set(chiaveG(s.nome), s)
    if (vende) {
      for (const [kg, c] of costoG) {
        const mioC = { valore: Number(c.valore) || 0, perc: percDi(c.descrizione) }
        const s = cliG.get(kg)
        const vend = s ? { valore: Number(s.valore) || 0, perc: percDi(s.descrizione) } : predefinitoGiacenzaCliente(c.nome)
        const p = peggioreSuNolo(vend, mioC, nolo)
        if (!p || p.differenza >= -0.005) continue
        const nome = s?.nome || c.nome
        const nonRichiedibile = !chiaveServizioGiacenza(nome) ? ' — oggi non si può chiedere dal portale' : ''
        righe.push({
          ...base(listinoId, corriereId), zona: 'giacenza', tipo: 'supplemento',
          chiave: s ? `s:${s.id}` : `m:${listinoId}|${corriereId}|giacenza|${nome}`,
          ...(s ? { supplemento_id: s.id } : { manca: { tipo: 'giacenza', nome, valore: vend.valore, perc: vend.perc } }),
          descrizione: `${nome}${s ? '' : ' (manca nel listino)'}: vendi ${eur(vend.valore)} € + ${vend.perc}% del nolo, paghi ${eur(mioC.valore)} € + ${mioC.perc}% — caso peggiore ${p.etichetta}${nonRichiedibile}`,
          prezzo_cliente: p.vendi, costo_tuo: p.paghi, differenza: p.differenza,
        })
      }
    }

    // ── APERTURA GIACENZA: un fisso. Senza riga il cliente paga zero.
    const costoA = costo.find((s: any) => s.tipo === 'giacenza_apertura')
    if (costoA && (Number(costoA.valore) || 0) > 0) {
      const s = cli.find((x: any) => x.tipo === 'giacenza_apertura')
      const v = s ? Number(s.valore) || 0 : 0, c = Number(costoA.valore) || 0
      if ((s || vende) && v < c - 0.005) {
        righe.push({
          ...base(listinoId, corriereId), zona: 'giacenza', tipo: 'supplemento',
          chiave: s ? `s:${s.id}` : `m:${listinoId}|${corriereId}|giacenza_apertura|`,
          ...(s ? { supplemento_id: s.id } : { manca: { tipo: 'giacenza_apertura', nome: 'Apertura dossier giacenza', valore: 0, perc: 0 } }),
          descrizione: `Apertura dossier giacenza${s ? '' : ' (manca nel listino: il cliente paga 0)'}`,
          prezzo_cliente: v, costo_tuo: c, differenza: r2(v - c),
        })
      }
    }

    // ── CONTRASSEGNO e ASSICURAZIONE: la commissione dell'addebito, sugli stessi importi e pesi.
    // Senza scaglioni nel listino del cliente il servizio non gli viene offerto: nessuna perdita.
    // Oltre il massimo di uno dei due il corriere viene escluso: si guarda solo fin dove entrambi arrivano.
    for (const tipo of ['contrassegno', 'assicurazione'] as const) {
      const vRighe = cli.filter((s: any) => s.tipo === tipo), cRighe = costo.filter((s: any) => s.tipo === tipo)
      if (!vRighe.length || !cRighe.length) continue
      const tutti = [...parseScaglioniSupp(vRighe, tipo), ...parseScaglioniSupp(cRighe, tipo)]
      const conPeso = tutti.some(x => x.peso_min != null || x.peso_max != null)
      const pesi = new Set<number>([1])
      for (const x of tutti) { if (x.peso_min != null) pesi.add(r2(x.peso_min + 0.01)); if (x.peso_max != null) pesi.add(x.peso_max) }
      const importi = new Set<number>([1])
      for (const x of tutti) if (x.valore_max > 0) { importi.add(x.valore_max); importi.add(r2(x.valore_max + 0.01)) }
      let peggio: { d: number; imp: number; peso: number; v: number; c: number } | null = null
      for (const peso of pesi) {
        const maxV = supplPresenteMax(vRighe, tipo, peso).max, maxC = supplPresenteMax(cRighe, tipo, peso).max
        for (const imp of importi) {
          if (imp > maxV || imp > maxC) continue
          const v = commissioneSupp(vRighe, tipo, imp, peso, true), c = commissioneSupp(cRighe, tipo, imp, peso)
          if (!peggio || v - c < peggio.d) peggio = { d: v - c, imp, peso, v, c }
        }
      }
      if (!peggio || peggio.d >= -0.005) continue
      // la riga del cliente che si applica in quel caso: e' quella da alzare
      type ConId = ScaglioneSupp & { _id: string }
      const scal = (scaglioniPerPeso(vRighe.map((s: any) => ({ ...parseScaglioniSupp([s], tipo)[0], _id: s.id })), peggio.peso) as ConId[])
        .filter(x => x.valore_max > 0).sort((a, b) => a.valore_max - b.valore_max)
      const sc = scal.find(x => peggio!.imp <= x.valore_max)
      if (!sc) continue
      righe.push({
        ...base(listinoId, corriereId), zona: tipo, tipo: 'supplemento',
        chiave: `s:${sc._id}`, supplemento_id: sc._id,
        descrizione: `Scaglione fino a ${eur(sc.valore_max)} € — caso peggiore: ${tipo} di ${eur(peggio.imp)} €${conPeso ? ` su un pacco di ${peggio.peso} kg` : ''}`,
        prezzo_cliente: r2(peggio.v), costo_tuo: r2(peggio.c), differenza: r2(peggio.d),
      })
    }

    // ── SERVIZI ACCESSORI: fisso + % del nolo, per nome. Se il cliente non ce l'ha, non gli viene
    // offerto (lib/tariffe-motore.ts): niente perdita.
    if (vende) {
      const nomeAcc = (s: any) => String(s.nome || jsonDi(s.descrizione)?.nome || '').trim().toLowerCase()
      const valAcc = (s: any) => { const d = jsonDi(s.descrizione); return { valore: Number(d?.prezzo ?? s.valore ?? 0) || 0, perc: Number(d?.perc ?? 0) || 0 } }
      const costoAcc = new Map<string, any>()
      for (const s of costo) if (s.tipo === 'accessorio' && nomeAcc(s) && !costoAcc.has(nomeAcc(s))) costoAcc.set(nomeAcc(s), s)
      // lato cliente con due righe dello stesso nome vale l'ULTIMA (lib/prezzo-cliente.ts riscrive la
      // mappa riga per riga), lato master la PRIMA (lib/cascata.ts): si confronta quello che si addebita
      const cliAcc = new Map<string, any>()
      for (const s of cli) if (s.tipo === 'accessorio' && nomeAcc(s)) cliAcc.set(nomeAcc(s), s)
      for (const s of cliAcc.values()) {
        const c = costoAcc.get(nomeAcc(s)); if (!c) continue
        const vend = valAcc(s), mioC = valAcc(c)
        const p = peggioreSuNolo(vend, mioC, nolo)
        if (!p || p.differenza >= -0.005) continue
        righe.push({
          ...base(listinoId, corriereId), zona: 'accessorio', tipo: 'supplemento', chiave: `s:${s.id}`, supplemento_id: s.id,
          descrizione: `${s.nome || nomeAcc(s)}: vendi ${eur(vend.valore)} € + ${vend.perc}% del nolo, paghi ${eur(mioC.valore)} € + ${mioC.perc}% — caso peggiore ${p.etichetta}`,
          prezzo_cliente: p.vendi, costo_tuo: p.paghi, differenza: p.differenza,
        })
      }
    }

    // ── SPONDA: € al kg sopra una soglia. Senza riga il cliente non la paga.
    const costoSp = costo.find((s: any) => s.tipo === 'sponda')
    const cSp = costoSp ? { kg: Number(costoSp.valore) || 0, soglia: Number(jsonDi(costoSp.descrizione)?.soglia_kg) || 0 } : null
    if (cSp && cSp.kg > 0 && cSp.soglia > 0) {
      const s = cli.find((x: any) => x.tipo === 'sponda')
      const v = s ? { kg: Number(s.valore) || 0, soglia: Number(jsonDi(s.descrizione)?.soglia_kg) || 0 } : null
      const sotto = v ? (v.kg < cSp.kg - 0.005 || !(v.soglia > 0) || v.soglia > cSp.soglia) : vende
      if (sotto) {
        righe.push({
          ...base(listinoId, corriereId), zona: 'sponda', tipo: 'supplemento',
          chiave: s ? `s:${s.id}` : `m:${listinoId}|${corriereId}|sponda|`,
          ...(s ? { supplemento_id: s.id } : { manca: { tipo: 'sponda', nome: 'Sponda', valore: 0, perc: 0, soglia_kg: cSp.soglia } }),
          descrizione: v
            ? `Sponda al kg: vendi da ${v.soglia} kg, paghi da ${cSp.soglia} kg`
            : `Sponda (manca nel listino: il cliente non la paga) — paghi ${eur(cSp.kg)} €/kg da ${cSp.soglia} kg`,
          prezzo_cliente: r4(v?.kg || 0), costo_tuo: r4(cSp.kg), differenza: r4((v?.kg || 0) - cSp.kg),
        })
      }
    }

    // ── ALTRI (ritiro…): come prima, fisso contro fisso e percentuale contro percentuale.
    for (const s of cli) {
      if (['giacenza', 'giacenza_apertura', 'contrassegno', 'assicurazione', 'accessorio', 'sponda'].includes(s.tipo)) continue
      const c = costo.find((x: any) => x.tipo === s.tipo && String(x.nome || '').toLowerCase().trim() === String(s.nome || '').toLowerCase().trim())
      if (!c) continue
      const v = Number(s.valore) || 0, p = percDi(s.descrizione), cv = Number(c.valore) || 0, cp = percDi(c.descrizione)
      if (v >= cv - 0.005 && p >= cp - 0.005) continue
      righe.push({
        ...base(listinoId, corriereId), zona: s.tipo, tipo: 'supplemento', chiave: `s:${s.id}`, supplemento_id: s.id,
        descrizione: `${s.nome || s.tipo}${p < cp - 0.005 ? ` (tu ${cp}%, lui ${p}%)` : ''}`,
        prezzo_cliente: v, costo_tuo: cv, differenza: r2(v - cv),
      })
    }
  }

  righe.sort((a, b) => a.differenza - b.differenza)
  return righe
}
