// Propagazione AUTOMATICA delle zone dal proprietario ai sotto-master.
// Quando un master modifica i CAP di una sua zona, i sotto-master (che hanno COPIE della stessa
// zona, per nome corriere + nome zona) devono rispecchiarla. Sincronizza UNA zona a tutta la
// discendenza (delete + insert dei CAP correnti). Usa il client ADMIN (scrive cross-master).
import { sottoAlberoMasterIds } from '@/lib/rete-masters'

export async function sincronizzaZonaAiDiscendenti(admin: any, ownerZonaId: string): Promise<void> {
  if (!ownerZonaId) return
  const { data: z } = await admin.from('zone')
    .select('id,nome,master_id,corriere_id, corrieri(nome_contratto)').eq('id', ownerZonaId).maybeSingle()
  const corrNome = (z as any)?.corrieri?.nome_contratto
  const zonaNome = (z as any)?.nome
  const ownerMaster = (z as any)?.master_id
  if (!corrNome || !zonaNome || !ownerMaster) return

  // CAP correnti del proprietario (paginati: possono superare i 1000)
  const capsOwner: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('zone_cap').select('paese,provincia,cap,citta').eq('zona_id', ownerZonaId).range(from, from + 999)
    if (!data?.length) break
    capsOwner.push(...data)
    if (data.length < 1000) break
  }

  // Discendenti (sotto-albero, escluso il proprietario)
  const discendenti = (await sottoAlberoMasterIds(admin, ownerMaster)).filter((m: string) => m !== ownerMaster)
  if (!discendenti.length) return

  // Corrieri gemelli (stesso nome_contratto) dei discendenti → loro zone con lo stesso nome
  const { data: corrSub } = await admin.from('corrieri').select('id').eq('nome_contratto', corrNome).in('master_id', discendenti)
  const corrIds = (corrSub || []).map((c: any) => c.id)
  if (!corrIds.length) return
  const { data: zoneSub } = await admin.from('zone').select('id').eq('nome', zonaNome).in('corriere_id', corrIds)

  for (const zs of (zoneSub || [])) {
    const subId = (zs as any).id
    await admin.from('zone_cap').delete().eq('zona_id', subId)
    if (capsOwner.length) {
      const rows = capsOwner.map((c: any) => ({ zona_id: subId, paese: c.paese, provincia: c.provincia, cap: c.cap, citta: c.citta }))
      for (let i = 0; i < rows.length; i += 1000) await admin.from('zone_cap').insert(rows.slice(i, i + 1000))
    }
  }
}
