// Usato da «Dal mio network» (app/dashboard/network): solo calcolo sui dati di /api/network/ricevuti.
// COSA SUCCEDE SOTTO A UNA RETTIFICA RICEVUTA (Lorenzo, 16/11/2026: «quando arrivano, ci sia il valore che paga e il
// numero spedizioni, quelle che deve recuperare e il prezzo»). Prima di «Carica» lo dice la stima fatta all'arrivo
// (rettifiche.perche.stima, lib/network-stima, stessa regola di «Carica»); dopo, la rettifica nata per chi sta sotto
// (figlia: quanto chiede, se e' gia' confermata) o il perche' scritto sulla riga.
export const pagata = (r: any) => -((Number(r.differenza) || 0) - (Number(r.fuori_sagoma) || 0))   // quanto ti e' stato scalato
export function sottoDi(r: any): { euro: number | null; testo: string } {
  const eu = (n: number) => `€ ${n.toFixed(2)}`
  if (r.propagazione === 'propagata') return r.figlia
    ? { euro: r.figlia.euro, testo: `${eu(r.figlia.euro)} ${r.figlia.confermata ? 'incassati' : 'da confermare in Rettifica Costi'}` }
    : { euro: null, testo: 'Girata e poi cancellata' }
  if (r.propagazione === 'assorbita') return { euro: null, testo: r.perche?.tipo === 'paga_uguale' ? 'Sotto paga uguale' : 'Assorbita da te' }
  if (r.propagazione) return { euro: null, testo: '' }
  if (r.propria) return { euro: null, testo: 'Tua spedizione: nessuno sotto' }
  const s = r.perche?.stima
  if (!s) return { euro: null, testo: 'In calcolo…' }
  if (s.esito === 'recupera') return { euro: Number(s.chiede) || 0, testo: `${eu(Number(s.chiede) || 0)} da ${s.chi || 'chi sta sotto'}` }
  if (s.esito === 'uguale') return { euro: null, testo: `${s.chi || 'Sotto'} paga uguale: niente da chiedere` }
  return { euro: null, testo: s.motivo || 'Ferma' }
}
export function sintesi(righe: any[], proprie: any[]) {
  const voce = () => ({ n: 0, euro: 0, chiede: 0, incassato: 0, daConfermare: 0 })
  const s = { recupera: voce(), ugualeStima: voce(), ferme: voce(), inCalcolo: voce(), girate: voce(), uguale: voce(), assorbite: voce(), cancellate: voce(), proprie: voce() }
  const ldv = new Set<string>()
  for (const r of righe) {
    ldv.add(r.numero_spedizione)
    const p = pagata(r)
    const v = !r.propagazione
      ? (!r.perche?.stima ? s.inCalcolo : r.perche.stima.esito === 'recupera' ? s.recupera : r.perche.stima.esito === 'uguale' ? s.ugualeStima : s.ferme)
      : r.propagazione === 'propagata' ? (r.figlia ? s.girate : s.cancellate)
      : r.propagazione === 'assorbita' ? (r.perche?.tipo === 'paga_uguale' ? s.uguale : s.assorbite) : null
    if (!v) continue
    v.n++; v.euro += p
    if (v === s.recupera) v.chiede += Number(r.perche.stima.chiede) || 0
    if (v === s.girate) { v.chiede += r.figlia.euro; if (r.figlia.confermata) v.incassato += r.figlia.euro; else v.daConfermare += r.figlia.euro }
  }
  for (const r of proprie) { ldv.add(r.numero_spedizione); s.proprie.n++; s.proprie.euro += pagata(r) }
  return { ...s, spedizioni: ldv.size }
}
