// DISTINTE DEI CLIENTI RIMASTE SENZA CHIUSURA AL CORRIERE: si segnalano, non si chiudono.
//
// Dal 20/11/2026 la distinta del cliente risponde subito e la chiusura al corriere (CloseWorkDay GLS,
// conferma BRT, borderò) parte a risposta data (app/api/cliente/distinte/crea). Se quella chiusura
// fallisce o non arriva, nessuno la riprende: il giro serale chiude solo le distinte che crea lui. Per
// un GLS o un BRT diretto senza chiusura il corriere non passa a ritirare, e oggi ce ne si accorgeva
// solo quando il furgone non arrivava. Lorenzo, 20/11: «si fai l'avviso automatico».
//
// Quando una distinta e' da segnalare:
//  - e' di un CLIENTE (cliente_id), nata negli ultimi GIORNI_FINESTRA giorni e da piu' di MINUTI_ATTESA;
//  - il corriere non l'ha confermata (confermata_vettore non vero), per errore o perche' la chiusura
//    non e' mai partita;
//  - dentro c'e' almeno una spedizione FERMA (in lavorazione o spedita). Senza questo filtro, nei 7
//    giorni fino al 20/11 sarebbero uscite 6 distinte e nessuna era un problema: 3 avevano tutte le
//    spedizioni annullate, 3 avevano i pacchi gia' in viaggio o consegnati (il corriere li aveva presi
//    lo stesso).
// Qui solo letture: chi chiama decide cosa farne (registro, avviso al master).

export const GIORNI_FINESTRA = 3
export const MINUTI_ATTESA = 30
const STATI_FERMI = ['in_lavorazione', 'spedita']

export type DistintaNonChiusa = {
  id: string; numero: string; master_id: string; cliente_id: string
  master: string; cliente: string; contratto: string
  creata_il: string; errore: string | null; ferme: number; totale: number
}

export async function distinteClientiNonChiuse(db: any, ora = new Date()): Promise<DistintaNonChiusa[]> {
  const dal = new Date(ora.getTime() - GIORNI_FINESTRA * 864e5).toISOString()
  const finoA = new Date(ora.getTime() - MINUTI_ATTESA * 60e3).toISOString()
  const { data: distinte, error } = await db.from('distinte')
    .select('id,numero,master_id,cliente_id,corriere_id,bordero_id,created_at')
    .not('cliente_id', 'is', null)
    .or('confermata_vettore.is.null,confermata_vettore.eq.false')
    .gte('created_at', dal).lt('created_at', finoA)
    .order('created_at', { ascending: true }).limit(1000)
  if (error) throw new Error('distinte non lette: ' + error.message)
  if (!distinte?.length) return []

  // Spedizioni ferme per distinta.
  const ids = distinte.map((d: any) => d.id)
  const ferme = new Map<string, number>(), totali = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: e2 } = await db.from('spedizioni').select('distinta_id,stato').in('distinta_id', ids.slice(i, i + 200))
    if (e2) throw new Error('spedizioni delle distinte non lette: ' + e2.message)
    for (const s of data || []) {
      totali.set(s.distinta_id, (totali.get(s.distinta_id) || 0) + 1)
      if (STATI_FERMI.includes(s.stato)) ferme.set(s.distinta_id, (ferme.get(s.distinta_id) || 0) + 1)
    }
  }
  const daSegnalare = distinte.filter((d: any) => (ferme.get(d.id) || 0) > 0)
  if (!daSegnalare.length) return []

  // Nomi per chi legge il registro e l'avviso.
  const uniq = (k: string) => Array.from(new Set(daSegnalare.map((d: any) => d[k]).filter(Boolean)))
  const [{ data: mm }, { data: cc }, { data: co }] = await Promise.all([
    db.from('masters').select('id,nome').in('id', uniq('master_id')),
    db.from('clienti').select('id,ragione_sociale').in('id', uniq('cliente_id')),
    db.from('corrieri').select('id,nome_contratto').in('id', uniq('corriere_id')),
  ])
  const nome = (lista: any[] | null, id: string, campo: string) => (lista || []).find((x: any) => x.id === id)?.[campo] || ''
  return daSegnalare.map((d: any) => ({
    id: d.id, numero: String(d.numero || ''), master_id: d.master_id, cliente_id: d.cliente_id,
    master: nome(mm, d.master_id, 'nome'), cliente: nome(cc, d.cliente_id, 'ragione_sociale'),
    contratto: d.corriere_id ? nome(co, d.corriere_id, 'nome_contratto') : 'più contratti',
    creata_il: d.created_at,
    // Il testo del corriere come l'ha salvato la chiusura. Per GLS dice quante spedizioni sono state chiuse e
    // l'esito di quelle rifiutate (lib/gls, chiudiSpedizioniGls); prima del rilascio GLS c'era solo "ERRORE: OK".
    errore: d.bordero_id && String(d.bordero_id).startsWith('ERRORE') ? String(d.bordero_id) : null,
    ferme: ferme.get(d.id) || 0, totale: totali.get(d.id) || 0,
  }))
}
