// Peso da mostrare nelle liste spedizioni = peso "fatturato" = il MAGGIORE tra
// peso reale e peso volumetrico. Il volumetrico (L×W×H / 5000, fattore standard)
// non è salvato sulle spedizioni, quindi si calcola dalle misure.
// - Colli voluminosi (cliente sottodichiara): mostra il volumetrico (più alto).
// - Colli piccoli/densi: resta il reale (corretto, è quello su cui si fattura).
export function pesoFatturato(s: any): number {
  const f = Number(s?.peso_fatturato)
  if (f > 0) return f                       // se già salvato (col fattore giusto), usalo
  const reale = Number(s?.peso_reale) || 0
  const vol = Number(s?.peso_volume) || 0   // volumetrico già calcolato col fattore corretto
  if (vol > 0) return Math.max(reale, vol)
  // Fallback (spedizioni vecchie senza volumetrico salvato): stima col fattore standard 5000.
  const L = Number(s?.lunghezza) || 0, W = Number(s?.larghezza) || 0, H = Number(s?.altezza) || 0
  if (!L || !W || !H) return reale
  return Math.max(reale, (L * W * H) / 5000)
}

export function fmtPeso(s: any): string {
  return (Math.round(pesoFatturato(s) * 10) / 10) + 'kg'
}
