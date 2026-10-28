// ORDINI GIA' IMPORTATI: quali ordini del file ci sono gia', e in che stato sono.
//
// L'import non ricarica un ordine che il cliente ha gia' importato (stesso numero d'ordine): Amazon,
// Shopify e Temu esportano sempre anche gli ordini gia' spediti, e senza questo controllo si
// spedirebbe due volte lo stesso pacco. Ma dire soltanto "Gia' importato in precedenza" non basta:
// l'elenco dell'import si apre su "Da spedire", gli ordini gia' spediti non si vedono, e il cliente
// pensa che l'import non abbia funzionato. E' successo il 27/10/2026: SOLONATURA ha ricaricato tre
// volte lo stesso file di Amazon, con cinque ordini importati e spediti quella mattina, convinta che
// non fossero mai entrati. Il motivo dice quindi QUANDO l'ordine e' entrato e DOVE e' adesso: con
// quale spedizione e' partito, oppure che aspetta nell'elenco.

const ROMA = 'Europe/Rome'
const giorno = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('it-IT', { timeZone: ROMA, day: '2-digit', month: '2-digit' }) : ''

type Riga = {
  order_id: string | null
  stato: string | null
  created_at: string | null
  spedizioni: { numero: string | null; created_at: string | null; stato: string | null; cancellata_il: string | null } | null
}

// Il motivo per UN ordine gia' presente. Le righe sono quelle trovate per quel numero d'ordine
// (di solito una sola; se per un import vecchio ce ne fossero piu' d'una, conta quella spedita).
export function motivoGiaImportato(righe: Riga[]): string {
  const spedita = righe.find(r => r.spedizioni && !r.spedizioni.cancellata_il && r.spedizioni.stato !== 'annullata')
  const r = spedita || [...righe].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  if (!r) return 'Già importato in precedenza'
  const quando = giorno(r.created_at)
  const importato = quando ? `Già importato il ${quando}` : 'Già importato in precedenza'
  const sp = spedita?.spedizioni
  // L'elenco dell'import filtra per stato esatto: si dice anche quale filtro mostra l'ordine.
  if (sp?.numero) return `${importato} e già spedito il ${giorno(sp.created_at)} con ${sp.numero} (filtro "Spedito")`
  switch (r.stato) {
    case 'da_spedire': return `${importato}: è nell'elenco, filtro "Da spedire"`
    case 'errore': return `${importato}: è nell'elenco, filtro "Errore"`
    case 'unito': return `${importato} e unito a un altro ordine (filtro "Unito")`
    case 'archiviato': return `${importato} e archiviato (filtro "Archiviato")`
    case 'spedito': return `${importato} e segnato come spedito (filtro "Spedito")`
    default: return importato
  }
}

// Per i numeri d'ordine dati, quelli gia' presenti per QUESTO cliente, ciascuno col suo motivo.
// `db` e' il client di chi importa: legge solo le proprie righe.
export async function ordiniGiaImportati(db: any, clienteId: string, orderIds: string[]): Promise<Map<string, string>> {
  const perOrdine = new Map<string, Riga[]>()
  for (let i = 0; i < orderIds.length; i += 300) {
    const { data, error } = await db.from('ordini_importati')
      .select('order_id, stato, created_at, spedizioni(numero, created_at, stato, cancellata_il)')
      .eq('cliente_id', clienteId).in('order_id', orderIds.slice(i, i + 300))
    // Una lettura fallita non deve far reimportare gli ordini: meglio fermare l'import che spedire due volte.
    if (error) throw new Error('controllo ordini già importati: ' + error.message)
    for (const r of (data || []) as Riga[]) {
      if (!r.order_id) continue
      const v = perOrdine.get(r.order_id) || []
      v.push(r); perOrdine.set(r.order_id, v)
    }
  }
  const out = new Map<string, string>()
  for (const [oid, righe] of perOrdine) out.set(oid, motivoGiaImportato(righe))
  return out
}
