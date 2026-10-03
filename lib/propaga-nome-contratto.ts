// Propagazione del NOME di un contratto condiviso a TUTTE le sue copie.
// Gemella di sincronizzaCredenzialiAiDiscendenti (propaga-credenziali), ma per nome_contratto.
//
// PERCHE' ESISTE: la catena-condivisione aggancia le copie per NOME (lib/condivisione-catena
// corrieriPerNome -> normNome(nome_contratto)). Ogni master ha la SUA copia del corriere (ponte
// moovexpress o copia reale), legate solo dal nome identico. Se il proprietario rinomina SOLO la
// propria copia (com'era: salvaCorriere aggiornava .eq('proprio',true)), i discendenti restano col
// vecchio nome -> la risalita non trova piu' l'owner -> costo/COD/reso/rettifiche non arrivano in
// cima. Un contratto condiviso a 8 master si spezzava al primo cambio nome dal pannello.
//
// SCOPE/SICUREZZA: a differenza delle CREDENZIALI (segreto, solo discendenza + mai sui ponti), il nome
// NON e' un segreto e DEVE restare identico su OGNI copia, ponti compresi. Il proprietario puo' essere
// a meta' albero e condividere VERSO L'ALTO/di lato (LOGIXIA figlia di MULTI rivende a Wave e sale in
// MULTI): le copie stanno fuori dal suo sotto-albero, quindi NON si puo' limitare a sottoAlbero(owner).
// La chiave e' il nome stesso, con due guardie che rendono il rename inequivocabile:
//   G1) UN SOLO proprietario reale: nel cluster del vecchio nome deve esserci un solo corriere
//       proprio=true NON-ponte (questo). Due proprietari reali = due contratti diversi con lo stesso
//       nome -> ambiguo -> NON si tocca niente (meglio fermarsi che rinominare il contratto altrui).
//   G2) NIENTE collisione: il nuovo nome non deve gia' esistere su un corriere FUORI dal cluster, o si
//       fonderebbero due contratti distinti.
// Ponte proprio=true (alcuni ponti lo sono) NON conta come proprietario reale: la guardia filtra per
// tipo!='moovexpress'. Rinomina comunque TUTTE le copie, ponti inclusi.

const normNome = (s: any) => String(s || '').trim().toLowerCase()

export interface EsitoPropagaNome {
  ok: boolean
  rinominati: number
  motivo?: string   // perche' NON ho rinominato (per avvisare chi salva, senza nomi tecnici)
}

// `oldNome` esplicito: il chiamante lo cattura PRIMA di toccare la copia dell'owner, cosi' il cluster
// si trova ancora tutto sotto il vecchio nome (owner incluso) e le guardie leggono lo stato coerente.
export async function propagaNomeContrattoAlleCopie(
  admin: any,
  p: { oldNome: string; nuovoNome: string; ownerMaster: string },
): Promise<EsitoPropagaNome> {
  const oldNome = (p.oldNome || '').trim()
  const nuovoNome = (p.nuovoNome || '').trim()
  if (!oldNome || !nuovoNome || !p.ownerMaster) return { ok: false, rinominati: 0, motivo: 'parametri' }
  if (normNome(oldNome) === normNome(nuovoNome)) return { ok: true, rinominati: 0 }   // nessun cambio reale

  // Cluster = tutte le copie col VECCHIO nome (ilike = confronto case-insensitive; poi normNome esatto,
  // identico a corrieriPerNome, per non mancare/eccedere per spazi o maiuscole).
  const { data: cand } = await admin.from('corrieri')
    .select('id,proprio,tipo,master_id,nome_contratto').ilike('nome_contratto', oldNome)
  const copie = (cand || []).filter((c: any) => normNome(c.nome_contratto) === normNome(oldNome))
  if (!copie.length) return { ok: true, rinominati: 0 }

  // G1: un solo proprietario reale, ed e' questo master. Un ALTRO proprietario reale (proprio + non-ponte)
  // con lo stesso nome = contratto diverso -> rename ambiguo -> fermo tutto.
  const altriProprietariReali = copie.filter((c: any) =>
    c.proprio && c.tipo !== 'moovexpress' && c.master_id !== p.ownerMaster)
  if (altriProprietariReali.length) return { ok: false, rinominati: 0, motivo: 'nome usato da piu\' proprietari' }

  // G2: il nuovo nome non deve gia' esistere FUORI dal cluster (fonderebbe due contratti).
  const { data: giaCand } = await admin.from('corrieri')
    .select('id,nome_contratto').ilike('nome_contratto', nuovoNome)
  const idsCluster = new Set(copie.map((c: any) => c.id))
  const collisione = (giaCand || []).some((c: any) =>
    normNome(c.nome_contratto) === normNome(nuovoNome) && !idsCluster.has(c.id))
  if (collisione) return { ok: false, rinominati: 0, motivo: 'nome gia\' in uso' }

  const ids = copie.map((c: any) => c.id)
  const { error } = await admin.from('corrieri').update({ nome_contratto: nuovoNome }).in('id', ids)
  if (error) return { ok: false, rinominati: 0, motivo: error.message }
  return { ok: true, rinominati: ids.length }
}
