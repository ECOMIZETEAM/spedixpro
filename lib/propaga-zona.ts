// Propagazione AUTOMATICA delle zone dal proprietario ai sotto-master.
// Quando un master modifica i CAP di una sua zona, i sotto-master (che hanno COPIE della stessa
// zona, per nome corriere + nome zona) devono rispecchiarla. Sincronizza UNA zona a tutta la
// discendenza (delete + insert dei CAP correnti). Usa il client ADMIN (scrive cross-master).
import { sottoAlberoMasterIds } from '@/lib/rete-masters'

export async function sincronizzaZonaAiDiscendenti(admin: any, ownerZonaId: string): Promise<void> {
  if (!ownerZonaId) return
  const { data: z } = await admin.from('zone')
    .select('id,nome,master_id,corriere_id,con_fuel, corrieri(nome_contratto)').eq('id', ownerZonaId).maybeSingle()
  const corrNome = (z as any)?.corrieri?.nome_contratto
  const zonaNome = (z as any)?.nome
  const ownerMaster = (z as any)?.master_id
  const conFuel = !!(z as any)?.con_fuel
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

  // Corrieri gemelli (stesso nome_contratto) di OGNI discendente. Per ciascuno mi assicuro che
  // esista la zona con lo stesso nome: se NON esiste la CREO (era il bug — la propagazione
  // aggiornava solo le zone già presenti, quindi i figli senza "Isole Minori"/"Zone Disagiate"
  // non le ricevevano MAI e prezzavano quelle destinazioni come "Italia").
  const { data: corrSub } = await admin.from('corrieri').select('id,master_id').eq('nome_contratto', corrNome).in('master_id', discendenti)
  if (!corrSub?.length) return

  for (const cs of corrSub) {
    const subCorrId = (cs as any).id
    // .limit(1): difensivo se il discendente ha zone duplicate con lo stesso nome (altrimenti
    // .maybeSingle() andrebbe in errore). Prende la più vecchia (id più basso), deterministico.
    let { data: zsub } = await admin.from('zone').select('id').eq('nome', zonaNome).eq('corriere_id', subCorrId).order('id', { ascending: true }).limit(1).maybeSingle()
    let subZonaId = (zsub as any)?.id
    if (!subZonaId) {
      const { data: nz } = await admin.from('zone')
        .insert({ nome: zonaNome, corriere_id: subCorrId, master_id: (cs as any).master_id, con_fuel: conFuel })
        .select('id').single()
      subZonaId = (nz as any)?.id
    }
    if (!subZonaId) continue
    // Rispecchio i CAP del proprietario (delete + insert dei correnti, paginato).
    await admin.from('zone_cap').delete().eq('zona_id', subZonaId)
    if (capsOwner.length) {
      const rows = capsOwner.map((c: any) => ({ zona_id: subZonaId, paese: c.paese, provincia: c.provincia, cap: c.cap, citta: c.citta }))
      for (let i = 0; i < rows.length; i += 1000) await admin.from('zone_cap').insert(rows.slice(i, i + 1000))
    }
  }
}
