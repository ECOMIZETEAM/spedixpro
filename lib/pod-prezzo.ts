// Prezzo che il MASTER addebita al cliente per una richiesta di POD (prova di consegna).
// Regole in `pod_prezzi`, a PRIORITA' (dal piu' specifico al piu' generico):
//   1) cliente + corriere   2) cliente (tutti i corrieri)   3) corriere (tutti i clienti)   4) default
// La chiave "corriere" e' `corriere_id`: la spedizione del cliente usa il CONTRATTO del master
// (corrieri.master_id == owner_master_id, verificato in prod), quindi l'id combacia sempre.
// Nessuna regola applicabile => 0 (POD gratuita). Le regole disattivate non contano.
export async function risolviPrezzoPod(
  admin: any,
  p: { masterId: string; clienteId?: string | null; corriereId?: string | null }
): Promise<number> {
  if (!p.masterId) return 0
  const { data: regole } = await admin.from('pod_prezzi')
    .select('cliente_id,corriere_id,prezzo')
    .eq('master_id', p.masterId)
    .eq('attivo', true)
  if (!regole || !regole.length) return 0
  const cli = p.clienteId || null
  const cor = p.corriereId || null
  // La prima regola che combacia, scendendo dalla piu' specifica, vince.
  const livelli: Array<(r: any) => boolean> = [
    r => !!cli && !!cor && r.cliente_id === cli && r.corriere_id === cor,
    r => !!cli && r.cliente_id === cli && r.corriere_id == null,
    r => !!cor && r.cliente_id == null && r.corriere_id === cor,
    r => r.cliente_id == null && r.corriere_id == null,
  ]
  for (const test of livelli) {
    const m = regole.find(test)
    if (m) return Number(m.prezzo) || 0
  }
  return 0
}
