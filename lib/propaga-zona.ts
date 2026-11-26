// Propagazione AUTOMATICA delle zone dal proprietario ai sotto-master.
// Quando un master modifica i CAP di una sua zona, i sotto-master (che hanno COPIE della stessa
// zona, per nome corriere + nome zona) devono rispecchiarla. Sincronizza UNA zona a tutta la
// discendenza (delete + insert dei CAP correnti). Usa il client ADMIN (scrive cross-master).
import { sottoAlberoMasterIds } from '@/lib/rete-masters'

export async function sincronizzaZonaAiDiscendenti(admin: any, ownerZonaId: string): Promise<void> {
  if (!ownerZonaId) return
  const { data: z } = await admin.from('zone')
    .select('id,nome,master_id,corriere_id,con_fuel,su_mittente,multicollo, corrieri(nome_contratto)').eq('id', ownerZonaId).maybeSingle()
  const corrNome = (z as any)?.corrieri?.nome_contratto
  const zonaNome = (z as any)?.nome
  const ownerMaster = (z as any)?.master_id
  const conFuel = !!(z as any)?.con_fuel
  // Una zona di PARTENZA (su_mittente) deve restare tale anche nelle copie dei sub: senza, il figlio
  // la vedrebbe come zona DESTINAZIONE e prezzerebbe i CAP di partenza come arrivo. Propaghiamo il flag.
  const suMitt = !!(z as any)?.su_mittente
  // Lo stesso per il MULTICOLLO: una copia senza il segno sarebbe una destinazione del collo singolo con
  // righe "tutto il paese", che vincerebbe sulle zone vere (lib/multicollo-zone).
  const multicollo = !!(z as any)?.multicollo
  if (!corrNome || !zonaNome || !ownerMaster) return

  // CAP correnti del proprietario (paginati: possono superare i 1000)
  const capsOwner: any[] = []
  for (let from = 0; ; from += 1000) {
    // ORDINE FISSO, o le pagine si accavallano: questo elenco SOSTITUISCE i CAP della zona in ogni
    // sotto-master (delete + insert qui sotto), quindi un CAP perso qui sparirebbe da tutta la rete e
    // quella destinazione verrebbe prezzata con un'altra zona. Verificato il 27/10: copie ancora intatte.
    const { data } = await admin.from('zone_cap').select('paese,provincia,cap,citta').eq('zona_id', ownerZonaId).order('id', { ascending: true }).range(from, from + 999)
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
  // Le righe STACCATE (26/11/2026) restano con le zone di quando i loro pacchi sono partiti: i resi e le rettifiche
  // di quei pacchi si prezzano su quelle zone.
  const { data: corrSub } = await admin.from('corrieri').select('id,master_id').eq('nome_contratto', corrNome).in('master_id', discendenti)
    .is('staccato_il', null)
  if (!corrSub?.length) return

  // RICOMPRATO ALTROVE (26/11/2026). Un master che si è staccato da questo contratto e lo ha ricomprato da un altro
  // fornitore (via codice, o con un contratto suo) ha una riga col nome uguale ma le zone del SUO fornitore; e così
  // i suoi sotto-master, le cui copie d'albero ora scendono da lui. Le zone di qui gliele riscriverebbero, e
  // venderebbero un CAP a un prezzo mentre lo pagano a un altro. Quando sotto chi propaga c'è anche una sola riga
  // STACCATA con questo nome, ogni riga riceve le zone di qui solo se questo contratto sta davvero sulla sua fila
  // (catena_contratto). Senza righe staccate non cambia niente: oggi 8 righe a codice ricevono queste zone per nome,
  // e 3 di loro non comprano da chi propaga (decisione a parte, non di questo rilascio).
  const escluse = new Set<string>()
  const { data: staccate, error: eSt } = await admin.from('corrieri').select('id,nome_contratto')
    .in('master_id', discendenti).not('staccato_il', 'is', null)
  if (eSt) console.error('[ZONE] righe staccate non lette: si propaga per nome come prima', eSt.message)
  const nomeNorm = String(corrNome).trim().toLowerCase()
  if ((staccate || []).some((r: any) => String(r.nome_contratto || '').trim().toLowerCase() === nomeNorm)) {
    for (const c of corrSub) {
      const { data: fila, error: eF } = await admin.rpc('catena_contratto', { p_corriere_id: (c as any).id })
      // Fila non leggibile: non si riscrive (le zone giuste gliele porta il suo fornitore), e lo si dice.
      if (eF) console.error('[ZONE] fila non leggibile, zone non riscritte:', (c as any).id, eF.message)
      if (eF || !(fila || []).some((f: any) => f.corriere_id === (z as any).corriere_id)) escluse.add((c as any).id)
    }
  }

  for (const cs of corrSub) {
    const subCorrId = (cs as any).id
    if (escluse.has(subCorrId)) continue
    // .limit(1): difensivo se il discendente ha zone duplicate con lo stesso nome (altrimenti
    // .maybeSingle() andrebbe in errore). Prende la più vecchia (id più basso), deterministico.
    let { data: zsub } = await admin.from('zone').select('id').eq('nome', zonaNome).eq('corriere_id', subCorrId).order('id', { ascending: true }).limit(1).maybeSingle()
    let subZonaId = (zsub as any)?.id
    if (!subZonaId) {
      const { data: nz } = await admin.from('zone')
        .insert({ nome: zonaNome, corriere_id: subCorrId, master_id: (cs as any).master_id, con_fuel: conFuel, su_mittente: suMitt, multicollo })
        .select('id').single()
      subZonaId = (nz as any)?.id
    } else {
      // La copia esiste già: riallineo i flag al proprietario (una zona che diventa/torna di partenza
      // deve aggiornarsi anche sui figli, altrimenti resta destinazione e prezza male).
      await admin.from('zone').update({ con_fuel: conFuel, su_mittente: suMitt, multicollo }).eq('id', subZonaId)
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
