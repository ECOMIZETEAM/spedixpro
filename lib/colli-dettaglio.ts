// RICOSTRUZIONE dei colli di un MULTICOLLO dal raw_response del provider, quando `colli_dettaglio`
// non e' stato salvato alla creazione (caso SpediamoPro: i colli stanno solo nei `parcels` del raw).
// Cosi' il dettaglio (occhio) e il tab Colli del tracking mostrano i colli veri invece di "singolo collo".
//
// UNITA' SpediamoPro (vedi lib/spediamopro: "weight in grams, dimensions in mm"): peso in grammi -> kg,
// misure in mm -> cm. La mappatura asse combacia col livello-spedizione (lunghezza=height, larghezza=
// length, altezza=width, verificato sui dati reali). NB: il ricalcolo costo usa il VOLUME L×W×H, che e'
// commutativo, quindi anche se un asse fosse etichettato diverso il costo non cambia.
export type ColloDett = { numero: number; peso: number; lunghezza: number; larghezza: number; altezza: number }

export function colliDaRaw(rawResponse: any): ColloDett[] {
  const r = rawResponse || {}
  const parcels = r?.raw?.data?.parcels || r?.data?.parcels || r?.parcels
  if (!Array.isArray(parcels) || parcels.length < 2) return []   // solo multicollo (>=2)
  const num = (v: any) => (v == null || v === '' ? 0 : Number(v))
  return parcels.map((p: any, i: number) => ({
    numero: i + 1,
    peso: p?.weight != null ? +(num(p.weight) / 1000).toFixed(3) : 0,   // grammi -> kg
    lunghezza: p?.height != null ? +(num(p.height) / 10).toFixed(1) : 0, // mm -> cm
    larghezza: p?.length != null ? +(num(p.length) / 10).toFixed(1) : 0,
    altezza: p?.width != null ? +(num(p.width) / 10).toFixed(1) : 0,
  }))
}

// Restituisce colli_dettaglio se gia' presente/valorizzato, altrimenti la ricostruzione dal raw.
export function colliDettaglioOEredita(colliDettaglio: any, rawResponse: any): ColloDett[] {
  if (Array.isArray(colliDettaglio) && colliDettaglio.length > 0) return colliDettaglio
  return colliDaRaw(rawResponse)
}
