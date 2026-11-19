// CODICE CONTRATTO — l'etichetta breve di ogni contratto (CT-7K3Q9X), per distinguere due contratti con lo
// stesso nome (al 30/10/2026 GTS EXPRESS ha tre "GLS CASERTA"). La crea il database alla nascita della riga
// e non cambia mai (scripts/aumenti-listino-e-codice-contratto.sql).
//
// Si legge SOLO da qui, con la chiave di servizio e SOLO per i contratti del master che guarda: la colonna
// non e' nel grant di `authenticated`, perche' la RLS fa leggere al cliente i contratti del suo master e il
// codice ai clienti non si mostra (decisione di Lorenzo, 30/10). Non e' `contratto_id`: quello punta alla
// riga di chi possiede il contratto all'origine, e a un master direbbe da chi compra.

/** id contratto → codice, per i soli contratti di `masterId` fra quelli chiesti. */
export async function codiciContratti(admin: any, masterId: string | null | undefined, ids?: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!masterId) return out
  // I contratti di un master sono qualche decina: una lettura sola, filtrata sul master, senza IN lunghi.
  const { data, error } = await admin.from('corrieri').select('id,codice').eq('master_id', masterId)
  if (error) return out
  const voluti = ids ? new Set(ids) : null
  for (const r of (data || []) as any[]) {
    if (r?.codice && (!voluti || voluti.has(r.id))) out.set(r.id, r.codice)
  }
  return out
}
