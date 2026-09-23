import { normalizzaMarkup, creaApplicaMarkup } from '@/lib/markup-fasce'

/* Genera il LISTINO D'INGROSSO di una condivisione: prende il COSTO del venditore per un contratto
 * (listini_corrieri_fasce/supplementi) e ne fa un listino_clienti col RICARICO applicato alle fasce
 * peso/zona (i supplementi si copiano tali e quali, come in /api/listini/costo-in-cliente). È il prezzo
 * che il compratore pagherà; all'Accetta (Fase 3) diventa il `listino_cliente_id` del cliente-ledger.
 *
 * Stessa orchestrazione di app/api/listini/costo-in-cliente/route.ts, ma come funzione lib invocabile dal
 * SERVICE ROLE (il venditore la innesca, non un cliente loggato). La matematica del ricarico sta tutta in
 * lib/markup-fasce (nessuna duplicazione). NON propaga a cascata: questo listino non è assegnato a una
 * rete, è l'ingrosso di un singolo compratore. Vedi CONDIVISIONE-CONTRATTI.md.
 */

export class ListinoIngrossoError extends Error {}

export async function generaListinoIngrosso(admin: any, opts: {
  fornitoreMasterId: string
  corriereId: string
  markup: any
  nome: string
}): Promise<{ listinoId: string }> {
  const { fornitoreMasterId, corriereId, markup, nome } = opts
  const applicaMarkup = creaApplicaMarkup(normalizzaMarkup(markup))

  // Il contratto dev'essere del venditore (perimetro: il service role bypassa la RLS).
  const { data: corr } = await admin.from('corrieri').select('id,nome_contratto')
    .eq('id', corriereId).eq('master_id', fornitoreMasterId).maybeSingle()
  if (!corr) throw new ListinoIngrossoError('Contratto non trovato tra i tuoi.')

  // SORGENTE = il COSTO del venditore per quel contratto.
  const { data: listiniCosto } = await admin.from('listini_corrieri')
    .select('id,corriere_id,fattore_volume,solo_peso_reale').eq('master_id', fornitoreMasterId)
  const costoIds = (listiniCosto || []).map((l: any) => l.id)
  if (!costoIds.length) throw new ListinoIngrossoError('Non hai un listino di costo da cui partire.')
  const { data: fasceCosto } = await admin.from('listini_corrieri_fasce')
    .select('zona_id,peso_min,peso_max,prezzo,tipo,fuel').in('listino_id', costoIds).eq('corriere_id', corriereId)
  if (!fasceCosto?.length) throw new ListinoIngrossoError(`Nessun prezzo di costo per "${corr.nome_contratto}" da cui partire.`)
  const { data: suppCosto } = await admin.from('listini_corrieri_supplementi')
    .select('tipo,descrizione,valore,tipo_calcolo,nome').in('listino_id', costoIds).eq('corriere_id', corriereId)
  const rigaCosto = ((listiniCosto || []).find((l: any) => l.corriere_id === corriereId) || (listiniCosto || [])[0]) as any
  const fattoreCosto = rigaCosto?.fattore_volume ?? null

  // DESTINAZIONE = un nuovo listino_clienti del venditore (l'ingrosso).
  const { data: nuovo, error: e1 } = await admin.from('listini_clienti').insert({
    master_id: fornitoreMasterId, nome, attivo: true,
    fattore_volume: fattoreCosto, solo_peso_reale: rigaCosto?.solo_peso_reale ?? false,
  }).select('id').single()
  if (e1 || !nuovo) throw new ListinoIngrossoError(e1?.message || 'Creazione listino non riuscita.')
  const listinoId = nuovo.id as string

  await admin.from('listini_clienti_corrieri').insert({
    listino_id: listinoId, corriere_id: corriereId, fattore_volume: fattoreCosto, abilitato: true,
  })
  await admin.from('listini_clienti_fasce').insert((fasceCosto || []).map((f: any) => ({
    listino_id: listinoId, corriere_id: corriereId, zona_id: f.zona_id,
    peso_min: f.peso_min, peso_max: f.peso_max, tipo: f.tipo, fuel: f.fuel,
    prezzo: applicaMarkup(f.prezzo, f.tipo, f.peso_max),
  })))
  if (suppCosto?.length) await admin.from('listini_clienti_supplementi').insert(suppCosto.map((s: any) => ({
    listino_id: listinoId, corriere_id: corriereId, tipo: s.tipo, descrizione: s.descrizione, valore: s.valore, tipo_calcolo: s.tipo_calcolo, nome: s.nome,
  })))

  return { listinoId }
}
