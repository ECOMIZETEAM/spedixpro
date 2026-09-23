import { vettoreFisico } from '@/lib/vettore'

// Prezzo che il MASTER addebita al cliente per una richiesta di POD (prova di consegna).
// Regole in `pod_prezzi`, a PRIORITA' (dal piu' specifico al piu' generico):
//   1) cliente + contratto   2) cliente + vettore   3) cliente (tutti i corrieri)
//   4) contratto             5) vettore             6) predefinito
// La chiave "contratto" e' `corriere_id`: la spedizione del cliente usa il CONTRATTO del master
// (corrieri.master_id == owner_master_id, verificato in prod), quindi l'id combacia sempre.
// Il VETTORE (23/09) e' quello FISICO — lib/vettore.ts — non la prima parola del nome: i contratti
// GLS/BRT diretti possono chiamarsi in tutt'altro modo (es. "PF CE LIGHT" di Quick e' GLS), e una
// regola "tutti i GLS" deve prenderli lo stesso. Copre anche i contratti che nasceranno domani.
// Nessuna regola applicabile => 0 (POD gratuita). Le regole disattivate non contano.
export async function risolviPrezzoPod(
  admin: any,
  p: { masterId: string; clienteId?: string | null; corriereId?: string | null }
): Promise<number> {
  if (!p.masterId) return 0
  const { data: regole } = await admin.from('pod_prezzi')
    .select('cliente_id,corriere_id,vettore,prezzo')
    .eq('master_id', p.masterId)
    .eq('attivo', true)
  if (!regole || !regole.length) return 0
  const cli = p.clienteId || null
  const cor = p.corriereId || null
  // Il vettore del contratto si legge SOLO se c'e' almeno una regola che lo usa: sulle reti che non
  // le usano questa funzione resta a una query sola (gira a ogni apertura di richiesta POD).
  let vet: string | null = null
  if (cor && regole.some((r: any) => r.vettore)) {
    const { data: c } = await admin.from('corrieri').select('tipo,nome_contratto').eq('id', cor).maybeSingle()
    if (c) vet = vettoreFisico(c as any)
  }
  // La prima regola che combacia, scendendo dalla piu' specifica, vince.
  const livelli: Array<(r: any) => boolean> = [
    r => !!cli && !!cor && r.cliente_id === cli && r.corriere_id === cor,
    r => !!cli && !!vet && r.cliente_id === cli && r.vettore === vet,
    r => !!cli && r.cliente_id === cli && r.corriere_id == null && r.vettore == null,
    r => !!cor && r.cliente_id == null && r.corriere_id === cor,
    r => !!vet && r.cliente_id == null && r.vettore === vet,
    r => r.cliente_id == null && r.corriere_id == null && r.vettore == null,
  ]
  for (const test of livelli) {
    const m = regole.find(test)
    if (m) return Number(m.prezzo) || 0
  }
  return 0
}
