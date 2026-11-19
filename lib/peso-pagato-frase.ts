// La frase che spiega il peso su cui si paga una multicollo (lib/rettifiche-peso-pagato, PesoPagato). Pura, senza
// letture: la usano le pagine (Rettifica Costi, «Dal mio network») e i report del master e del cliente, cosi' la
// rettifica si legge uguale dappertutto e come la scrive la Conferma nel movimento («si paga sul peso fatturato: da
// … a … — 2 colli: …»). Solo chili: nessun importo, nessun nome.

const kg = (n: any) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('it-IT')

export function frasePesoPagato(pp: { prima: number; dopo: number; colli?: number[]; colliPrima?: number[] } | null | undefined): string {
  if (!pp || !(Number(pp.dopo) > 0)) return ''
  const prima = (pp.colliPrima || []).length > 1 ? ` (${(pp.colliPrima || []).map(kg).join(' + ')})` : ''
  const dopo = (pp.colli || []).length > 1 ? ` (${(pp.colli || []).map(kg).join(' + ')})` : ''
  return `Si paga collo per collo, per ognuno il maggiore fra peso e volume: da ${kg(pp.prima)} kg${prima} a ${kg(pp.dopo)} kg${dopo}`
}
