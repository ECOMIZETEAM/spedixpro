// Propagazione AUTOMATICA delle credenziali dal proprietario di un contratto alle sue COPIE rivendute.
// Gemella di sincronizzaZonaAiDiscendenti (lib/propaga-zona), ma per le API key.
//
// Un contratto con proprio=true tiene l'account vero (client_id/secret/account). I sotto-master che lo
// RIVENDONO hanno una COPIA (proprio=false, stesso nome_contratto) e usano LO STESSO account: e' il
// medesimo contratto, non un altro. Quando il proprietario rinnova le chiavi, le copie devono seguirlo,
// altrimenti spediscono con credenziali scadute (bug FedEx 21/09/2026: il segreto nuovo era solo su
// MULTIEXPRESS, i sotto-master davano 401 e i loro CLIENTI non riuscivano a creare la spedizione, mentre
// la "propria" del master passava perche' usa le chiavi del detentore).
//
// Scope di SICUREZZA: si scrive SOLO sulle copie proprio=false dello STESSO nome_contratto nella
// discendenza. Mai su un contratto proprio=true di un altro master (quello ha un account suo).
import { sottoAlberoMasterIds } from '@/lib/rete-masters'

export async function sincronizzaCredenzialiAiDiscendenti(admin: any, ownerCorriereId: string): Promise<number> {
  if (!ownerCorriereId) return 0
  const { data: c } = await admin.from('corrieri')
    .select('id,nome_contratto,master_id,credenziali,proprio').eq('id', ownerCorriereId).maybeSingle()
  // Propaga SOLO dal proprietario del contratto.
  if (!c || !(c as any).proprio) return 0
  const nome = (c as any).nome_contratto
  const ownerMaster = (c as any).master_id
  const cred = (c as any).credenziali
  if (!nome || !ownerMaster || !cred) return 0

  const discendenti = (await sottoAlberoMasterIds(admin, ownerMaster)).filter((m: string) => m !== ownerMaster)
  if (!discendenti.length) return 0

  // Solo le COPIE RIVENDUTE (proprio=false) dello STESSO contratto: e' lo stesso account.
  const { data: copie } = await admin.from('corrieri')
    .select('id').eq('nome_contratto', nome).eq('proprio', false).in('master_id', discendenti)
  if (!copie?.length) return 0

  const ids = copie.map((x: any) => x.id)
  const { error } = await admin.from('corrieri').update({ credenziali: cred }).in('id', ids)
  if (error) throw error
  return ids.length
}
