// PERCHE' UNA RETTIFICA RESTA A CARICO DI CHI L'HA (Lorenzo, 05/11/2026: «ci stanno tante eliminate e tante a suo
// carico che non si capisce bene il perchè»).
//
// Il caricamento fa nascere una riga «solo a tuo carico» per tre motivi diversi — il pacco era gia' stato fatto pagare
// sotto, e' un reso, oppure per chi sta sotto il peso nuovo costa uguale — ma non scrive quale, e la pagina li metteva
// tutti nello stesso mucchio. Lo stesso per le rettifiche ricevute da sopra e non girate (assorbite, o caricate e poi
// cancellate): sembravano soldi persi. Rifatto il conto pacco per pacco sulle righe di MULTI il 05/11/2026: delle 2.675
// «eliminate» degli ultimi 90 giorni, 2.635 erano pacchi gia' fatti pagare sotto con un'altra rettifica (5.002 €
// incassati contro 4.480 € di costo); davvero perse 40. Delle 2.010 «solo a tuo carico» in attesa, 1.932 gia' fatte
// pagare sotto e 77 sovrapprezzi senza una voce che il portale conosca (UPS Europa da 15-27 € l'uno).
// Qui si ricostruisce il motivo alla lettura, dai dati che ci sono gia': niente da scrivere, niente che cambi coi soldi.

// costo = quello che il fornitore aveva gia' addebitato con QUELLA riga (0 se nata dalle misure del portale): il conto di
// quanto manca si fa sul pacco intero, non sulla riga arrivata dopo da sola.
// stima = la riga di prima era una stima del portale (riferimento = LDV), che alla Conferma cede alla fattura del fornitore.
export type GiaFattaPagare = { a: string; il: string; euro: number; confermata: boolean; costo: number; stima: boolean }
export type PercheMio =
  | { tipo: 'gia_fatta_pagare'; gia: GiaFattaPagare }
  | { tipo: 'reso' }
  | { tipo: 'senza_voce' }
  | { tipo: 'stesso_prezzo'; conto?: ContoStessoPrezzo }

// I numeri con cui il caricamento ha deciso «niente da chiedere sotto» (colonna rettifiche.perche).
export type ContoStessoPrezzo = { chi?: string; pagato?: number; dovuto?: number | null; zona?: string | null; peso_prima?: number | null; peso_dopo?: number | null }

const eur = (n: any) => `€ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')}`
const kg = (n: any) => `${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('it-IT')} kg`

// LA FRASE, CON I NUMERI (Lorenzo, 05/11/2026: «che significa costa uguale.. non si capisce.. modifichiamo la voce»).
// «GENIUS DELIVERY ha pagato € 12,60 per 5 kg. Col peso del fornitore, 9,5 kg, il suo listino (zona Calabria) fa
// € 14,18…»: chi legge vede subito se il conto torna — come non tornava su 1ZF4328R6814924086, fatto su «Italia».
// Senza i numeri (righe nate prima del 05/11) resta la spiegazione, detta per intero.
export function descriviStessoPrezzo(c?: ContoStessoPrezzo | null): string {
  if (!c || c.pagato == null || c.dovuto == null) {
    return 'Chi sta sotto ha già pagato quanto costa il pacco col peso nuovo: col suo listino il peso del fornitore sta nella stessa fascia di prezzo di quello dichiarato, quindi non gli si chiede niente'
  }
  const chi = c.chi || 'Chi sta sotto'
  const prima = c.peso_prima ? ` per ${kg(c.peso_prima)}` : ''
  const dopo = c.peso_dopo ? `, ${kg(c.peso_dopo)}` : ''
  const zona = c.zona ? ` (zona ${c.zona})` : ''
  const esito = Number(c.dovuto) < Number(c.pagato) - 0.005 ? 'ha già pagato di più' : 'è la stessa cifra'
  return `${chi} ha pagato ${eur(c.pagato)}${prima}. Col peso del fornitore${dopo}, il suo listino${zona} fa ${eur(c.dovuto)}: ${esito}, quindi non gli si chiede niente`
}

const importo = (x: any) => Math.round((-Number(x.differenza || 0) + Number(x.fuori_sagoma || 0)) * 100) / 100

// Per ogni pacco: la prima rettifica viva con cui `masterId` l'ha fatto pagare a qualcuno sotto (un suo sotto-master o un
// suo cliente). Non contano il suo costo (riga intestata a se' stesso) e le annullate (addebito restituito).
export async function giaFattePagareSotto(admin: any, masterId: string, spedizioneIds: string[]): Promise<Map<string, GiaFattaPagare>> {
  const out = new Map<string, GiaFattaPagare>()
  const ids = [...new Set(spedizioneIds.filter(Boolean))]
  const prime = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from('rettifiche')
      .select('spedizione_id,numero_spedizione,rif_fornitore,target_master_id,cliente_id,differenza,fuori_sagoma,costo_fornitore,created_at,confermata,stato,propagazione')
      .in('spedizione_id', ids.slice(i, i + 200)).eq('master_id', masterId)
    if (error) throw new Error('rettifiche gia\' fatte pagare: ' + error.message)
    for (const x of (data || []) as any[]) {
      if (x.target_master_id && x.target_master_id === masterId) continue
      if (x.propagazione === 'annullata' || x.stato === 'annullata') continue
      if (!x.confermata && x.stato !== 'da_rettificare') continue
      const p = prime.get(x.spedizione_id)
      if (!p || String(x.created_at) < String(p.created_at)) prime.set(x.spedizione_id, x)
    }
  }
  if (!prime.size) return out
  const nomi = new Map<string, string>()
  const ms = [...new Set([...prime.values()].map(x => x.target_master_id).filter(Boolean))]
  const cs = [...new Set([...prime.values()].map(x => x.cliente_id).filter(Boolean))]
  for (let i = 0; i < ms.length; i += 200) {
    const { data } = await admin.from('masters').select('id,nome').in('id', ms.slice(i, i + 200))
    for (const m of (data || []) as any[]) nomi.set(m.id, m.nome)
  }
  for (let i = 0; i < cs.length; i += 200) {
    const { data } = await admin.from('clienti').select('id,ragione_sociale').in('id', cs.slice(i, i + 200))
    for (const c of (data || []) as any[]) nomi.set(c.id, String(c.ragione_sociale || '').trim())
  }
  for (const [sp, x] of prime) {
    out.set(sp, { a: nomi.get(x.target_master_id || x.cliente_id) || (x.target_master_id ? 'un tuo sotto-master' : 'un tuo cliente'), il: x.created_at, euro: importo(x), confermata: !!x.confermata, costo: Math.round(Number(x.costo_fornitore || 0) * 100) / 100,
      stima: !!x.rif_fornitore && x.rif_fornitore === x.numero_spedizione })
  }
  return out
}

// Una stima del portale (riferimento = LDV) su un pacco che ha gia' la fattura del fornitore alla Conferma non si
// registra (vedi pacchiConCostoGia in lib/ripesature-crea): il costo vero e' quello della fattura.
export const eStima = (r: any) => !!r?.rif_fornitore && r.rif_fornitore === r.numero_spedizione

// SENZA CHILI: una rettifica ricevuta che al livello di chi l'ha pagata non conteneva un chilo in piu'. Prima della regola
// del 02/11 («la rettifica conta i chili», lib/ripesature-calcolo) il motore sulle misure di Poste contava il prezzo di
// oggi meno quello pagato alla spedizione, e il controllo «il collo e' diventato piu' grande» guardava il volume anche
// quando valeva l'agevolazione sul peso reale. 2UW07WF015754 (Poste Delivery Business S, Edit Shop): dichiarato 1 kg,
// Poste 0,85 kg in 27×19,5×14,5 — nella scatola 50×32×28, si paga sul reale, stessa fascia — e a Ecomize Solution e'
// arrivata una rettifica di 1,05 €, che era solo l'aumento del listino da luglio. Lorenzo, 13/11/2026: quello che e' stato
// pagato e fatto pagare resta com'e', ma queste righe si tolgono da Rettifica Costi di chi le ha ricevute: non le gira
// e non le vede. Il segno sta sulla riga (perche.tipo = 'senza_chili'); i soldi non si toccano.
export const senzaChili = (r: any) => r?.perche?.tipo === 'senza_chili'

// ── PERCHE' UNA RICEVUTA NON E' SCESA, COI NUMERI (colonna rettifiche.perche sulla riga ricevuta) ──
// Lorenzo, 15/11/2026, sulle rettifiche non girate di Ecomize Solution: «ci perdi non deve esistere.. pensano che stanno
// perdendo soldi» e «ci guadagni comunque sembra che non ha recuperato la rettifica». Il conto del pacco (incassato meno
// pagato) non diceva il perche', e spingeva a leggere una perdita dove c'era una scelta o un listino. La riga ora dice
// cosa e' successo sotto, col listino di chi sta sotto: MB POSTE (282343J061744, SDA EXPRESS L) a 5000 sta nella fascia
// 30–50 sia sul dichiarato (33,6 kg) sia sul collo rimisurato (43,4 kg), 16,70 €; Ecomize a 6000 passa da 20–30 a 30–50.
// I numeri si scrivono quando succede (Carica, Assorbi, cancellazione della figlia): rifarli a ogni apertura della pagina
// vorrebbe dire riprezzare ogni pacco a ogni livello. Le righe di prima del 16/11 di Ecomize Solution sono state
// ricostruite a mano (tipo 'assorbita': chi l'abbia deciso, se il master col bottone o il portale, prima non si scriveva).
//   pagato = quello che chi sta sotto ha pagato; dovuto = il suo listino sul collo rimisurato; dovuto_dich = sul dichiarato
//   peso_prima / peso_dopo = i chili su cui paga (il maggiore fra reale e volume, col SUO divisore)
export type ContoSotto = {
  chi?: string | null; pagato?: number | null; dovuto?: number | null; dovuto_dich?: number | null
  zona?: string | null; peso_prima?: number | null; peso_dopo?: number | null
}
export type PercheRicevuta = ContoSotto & {
  tipo: 'paga_uguale' | 'assorbita_a_mano' | 'assorbita' | 'cancellata_sotto' | 'listino_non_arriva' | 'senza_chili'
  il?: string
  chiedeva?: number | null                                      // cancellata_sotto: quanto chiedeva la figlia cancellata
  listino?: string | null; contratto?: string | null           // listino_non_arriva: quale listino, su che contratto,
  destinazione?: string | null; arriva_a?: number | null        // fin dove arriva, quanti chili servivano (peso_dopo)
  nota?: string | null                                         // una riga in piu', scritta a mano (es. il listino che salta)
}

// I gruppi di «Rettifiche non girate sotto» (app/dashboard/spedizioni/rettifica): uguale, assorbite, listino, cancellate.
// Gia' fatte pagare sotto e spedizioni senza cliente si decidono prima, dal pacco (lib/rettifiche-non-girate).
export function gruppoRicevuta(r: any): 'uguale' | 'assorbite' | 'listino' | 'cancellate' {
  if (r?.propagazione === 'propagata') return 'cancellate'
  const t = r?.perche?.tipo
  return t === 'paga_uguale' ? 'uguale' : t === 'listino_non_arriva' ? 'listino' : 'assorbite'
}

const kgDi = (n: any) => n != null && Number(n) > 0 ? ` (${kg(n)})` : ''

// La frase di una ricevuta non girata. `chi` di ripiego (dal conto del pacco) quando la riga non lo porta.
export function descriviNonGirata(r: any, chiDiRipiego?: string | null): string {
  const p: PercheRicevuta | null = r?.perche || null
  const chi = p?.chi || chiDiRipiego || 'chi sta sotto'
  const nota = p?.nota ? ' ' + p.nota : ''
  const haConto = p?.pagato != null && p?.dovuto != null
  if (r?.propagazione === 'propagata') {
    const base = `L'avevi girata a ${chi} e poi l'hai cancellata in Rettifica Costi senza confermarla.`
    if (p?.tipo !== 'cancellata_sotto' || p.chiedeva == null) return base + nota
    return `${base} Gli si chiedeva ${eur(p.chiedeva)}${haConto ? `: col tuo listino il collo rimisurato${kgDi(p.peso_dopo)} costa ${eur(p.dovuto)} e ne aveva pagati ${eur(p.pagato)}.` : '.'}${nota}`
  }
  if (p?.tipo === 'listino_non_arriva') {
    const dove = [p.contratto, p.zona ? `zona ${p.zona}` : null].filter(Boolean).join(', ')
    return `Il tuo listino${p.listino ? ` «${p.listino}»` : ''} di ${chi}${dove ? ` su ${dove}` : ''} arriva a ${kg(p.arriva_a)}. `
      + `Il pacco${p.destinazione ? ` per ${p.destinazione}` : ''} rimisurato fa ${kg(p.peso_dopo)}: quel peso non ha un prezzo. Aggiungi la fascia sopra i ${kg(p.arriva_a)} per poter girare le prossime.${nota}`
  }
  if (p?.tipo === 'paga_uguale') {
    if (haConto && p.dovuto_dich != null) {
      const d = Number(p.dovuto), dd = Number(p.dovuto_dich)
      if (Math.abs(d - dd) < 0.005) return `Col tuo listino ${chi} paga ${eur(d)} sia sul dichiarato${kgDi(p.peso_prima)} sia sul collo rimisurato${kgDi(p.peso_dopo)}: stessa fascia, non c'era niente da chiedergli.${nota}`
      if (d < dd) return `Col tuo listino ${chi} paga ${eur(d)} sul collo rimisurato${kgDi(p.peso_dopo)}, meno dei ${eur(dd)} sul dichiarato${kgDi(p.peso_prima)}: non c'era niente da chiedergli.${nota}`
    }
    if (haConto) return `Col tuo listino, sul collo rimisurato${kgDi(p.peso_dopo)}, ${chi} paga ${eur(p.dovuto)} e ne aveva già pagati ${eur(p.pagato)}: non c'era niente da chiedergli.${nota}`
    return `Non girata: col tuo listino ${chi} paga uguale anche col peso nuovo, quindi non c'era niente da chiedergli.${nota}`
  }
  if (p?.tipo === 'assorbita_a_mano') return `L'hai assorbita tu, col bottone «Assorbi»: non l'hai girata a ${chi}.${nota}`
  if (p?.tipo === 'assorbita' && haConto) {
    return `Non l'hai girata a ${chi}. Col tuo listino di oggi, sul collo rimisurato${kgDi(p.peso_dopo)}, ${chi} pagherebbe ${eur(p.dovuto)} invece dei ${eur(p.pagato)} pagati.${nota}`
  }
  return `Assorbita: non l'hai girata a ${chi}.${nota}`
}

export function stimaCedeAllaFattura(r: any, p: PercheMio | undefined): boolean {
  return !!p && p.tipo === 'gia_fatta_pagare' && eStima(r) && !p.gia.stima && p.gia.costo > 0.005
}

// Il motivo delle righe «solo a tuo carico» (master_id = target_master_id = chi guarda), nell'ordine del caricamento:
// pacco gia' fatto pagare sotto, reso, importo senza una voce (ne' chili ne' supplemento conosciuto), stesso prezzo sotto.
export async function perchePropri(admin: any, masterId: string, righe: any[]): Promise<Map<string, PercheMio>> {
  const out = new Map<string, PercheMio>()
  const gia = await giaFattePagareSotto(admin, masterId, righe.map(r => r.spedizione_id))
  const resto = righe.filter(r => !(r.spedizione_id && gia.has(r.spedizione_id)))
  const resi = new Set<string>()
  const sp = [...new Set(resto.map(r => r.spedizione_id).filter(Boolean))]
  for (let i = 0; i < sp.length; i += 200) {
    const { data } = await admin.from('spedizioni').select('id,stato,reso_il').in('id', sp.slice(i, i + 200))
    for (const s of (data || []) as any[]) if (s.reso_il || /reso/i.test(String(s.stato || ''))) resi.add(s.id)
  }
  for (const r of righe) {
    const g = r.spedizione_id ? gia.get(r.spedizione_id) : undefined
    if (g) { out.set(r.id, { tipo: 'gia_fatta_pagare', gia: g }); continue }
    if (r.spedizione_id && resi.has(r.spedizione_id)) { out.set(r.id, { tipo: 'reso' }); continue }
    const senzaPeso = !(Number(r.peso_reale) > 0) && !(Number(r.peso_volume_reale) > 0)
    out.set(r.id, senzaPeso && !String(r.supplementi_nomi || '').trim() ? { tipo: 'senza_voce' }
      : { tipo: 'stesso_prezzo', ...(r.perche?.tipo === 'stesso_prezzo' ? { conto: r.perche } : {}) })
  }
  return out
}
