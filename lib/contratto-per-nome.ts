// TROVARE LA COPIA DI UN CONTRATTO PRESSO UN ALTRO MASTER.
//
// Ogni master ha una PROPRIA riga in `corrieri` per lo stesso contratto reale, e il legame fra
// padre e figlio e' il NOME. Il confronto va quindi fatto SEMPRE allo stesso modo, altrimenti due
// parti del sistema si trovano in disaccordo su cosa sia "lo stesso contratto".
//
// E' successo davvero: la sospensione lungo la catena normalizza il nome (minuscolo + spazi tolti,
// lib/contratti-catena.ts) e anche la propagazione dei listini (lib/copia-listino-submaster.ts),
// mentre il calcolo del costo a cascata cercava con uguaglianza esatta. In produzione c'e' un
// contratto salvato come 'SDA ' (con lo spazio finale) sotto Ecomize e come 'SDA' sotto
// MULTIEXPRESS: per la sospensione erano lo stesso contratto, per la cascata no. Effetto: il
// detentore vero del contratto non veniva riconosciuto, quindi non veniva addebitato e il suo
// credito non veniva nemmeno controllato. Un buco silenzioso, e nella direzione che costa soldi.
//
// Qui il confronto e' uno solo, e vale da entrambi i lati: si normalizza il nome cercato E quello
// salvato.

export function nomeContrattoNormalizzato(v: string | null | undefined): string {
  return String(v || '').trim().toLowerCase()
}

// Id della riga `corrieri` di quel master per quel nome contratto, oppure null.
// `adminDb` deve essere il client amministrativo: si leggono righe di master diversi dal chiamante.
export async function corriereDiMasterPerNome(
  adminDb: any, masterId: string | null | undefined, nomeContratto: string | null | undefined
): Promise<string | null> {
  const cercato = nomeContrattoNormalizzato(nomeContratto)
  if (!masterId || !cercato) return null
  const { data } = await adminDb.from('corrieri').select('id,nome_contratto').eq('master_id', masterId)
  for (const c of (data || [])) {
    if (nomeContrattoNormalizzato((c as any).nome_contratto) === cercato) return (c as any).id
  }
  return null
}
