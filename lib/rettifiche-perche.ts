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
  | { tipo: 'stesso_prezzo' }

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
    out.set(r.id, senzaPeso && !String(r.supplementi_nomi || '').trim() ? { tipo: 'senza_voce' } : { tipo: 'stesso_prezzo' })
  }
  return out
}
