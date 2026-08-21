// UN CONTRATTO TOLTO DA UN LIVELLO SUPERIORE DEVE SPARIRE ANCHE A VALLE.
//
// Ogni master ha una PROPRIA riga in `corrieri` per ciascun contratto: quando un contratto viene
// propagato a un sotto-master ne nasce una copia con lo stesso `nome_contratto`. Il legame fra padre
// e figlio e' quindi il NOME del contratto, non un id (come in lib/cascata.ts).
//
// Un master non puo' vendere un servizio che un ANTENATO gli ha tolto: la merce non partirebbe. Ci sono
// tre modi in cui un antenato "toglie" un corriere al figlio, e vanno coperti TUTTI:
//   (1) PAUSA        -> la riga del padre ha attivo=false;
//   (2) DISATTIVA    -> masters_corrieri_abilitati(master_id=figlio, corriere_id=riga-padre, abilitato=false);
//   (3) ELIMINA      -> il padre non offre piu' quel contratto nel listino ASSEGNATO al figlio
//                       (nessuna fascia/aggancio in parent_listino_id) oppure la riga del padre non c'e' piu'.
//
// Qui si risale la catena e si raccolgono i NOMI dei contratti che il figlio ha EREDITATO ma che
// l'antenato NON gli offre piu'. Il risultato puo' solo RESTRINGERE (nascondere), mai ampliare, ed e' un
// filtro alla LETTURA: NON si cancella nulla nei dati del sotto-master (mai il rischio di cancellare un
// suo contratto proprio omonimo). Un contratto PROPRIO non entra mai nell'elenco (guardia proprio).
//
// Verificato sui dati veri prima del rilascio: dei contratti che questo filtro nasconde, uno solo aveva
// spedizioni negli ultimi 7 giorni (il contratto Poste internazionale inattivo, che deve sparire); tutti
// gli altri erano gia' fermi da una pausa. Zero collisioni fra un contratto proprio del sub e un antenato.
//
// Nota sul client: service role perche' l'RLS sui corrieri (master_id IN mia_rete_master()) nasconde le
// righe dei master superiori. Uso legittimo: si legge solo nome/attivo/aggancio/flag degli ANTENATI, e il
// risultato puo' unicamente TOGLIERE contratti.
export async function contrattiRimossiSopra(masterId: string | null | undefined): Promise<Set<string>> {
  const bloccati = new Set<string>()
  if (!masterId) return bloccati
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  const norm = (s: any) => String(s || '').trim().toLowerCase()

  let corrente: string | null = masterId
  const visti = new Set<string>([masterId])
  // Nomi PROPRI del master che legge: non vanno MAI nascosti, nemmeno se un antenato ha tolto un
  // contratto con lo stesso nome (scenario GLS/BRT diretti). Guardia finale.
  const { data: cMio } = await admin.from('corrieri').select('nome_contratto').eq('master_id', masterId).eq('proprio', true)
  const nomiPropriMiei = new Set<string>((cMio || []).map((c: any) => norm(c.nome_contratto)))

  for (let i = 0; i < 20; i++) {
    const mRow: any = (await admin.from('masters').select('parent_master_id,parent_listino_id').eq('id', corrente).maybeSingle()).data
    const padre: string | null = mRow?.parent_master_id || null
    const listino: string | null = mRow?.parent_listino_id || null
    if (!padre || visti.has(padre)) break
    visti.add(padre)

    const { data: cPadre } = await admin.from('corrieri').select('id,nome_contratto,attivo').eq('master_id', padre)
    const { data: cFiglio } = await admin.from('corrieri').select('nome_contratto,proprio').eq('master_id', corrente)
    const { data: disab } = await admin.from('masters_corrieri_abilitati').select('corriere_id').eq('master_id', corrente).eq('abilitato', false)
    const disabIds = new Set((disab || []).map((r: any) => r.corriere_id))

    // OFFERTI dal padre = attivo=true, non disabilitati per il figlio, e presenti nel listino assegnato
    // (una fascia o un aggancio). Se il figlio non ha un listino assegnato (difensivo): basta attivo+non-disab.
    const candidati = (cPadre || []).filter((c: any) => c.attivo !== false && !disabIds.has(c.id))
    const offerti = new Set<string>()
    if (listino && candidati.length) {
      const ids = candidati.map((c: any) => c.id)
      const [{ data: fasceP }, { data: aggP }] = await Promise.all([
        admin.from('listini_clienti_fasce').select('corriere_id').eq('listino_id', listino).in('corriere_id', ids),
        admin.from('listini_clienti_corrieri').select('corriere_id').eq('listino_id', listino).in('corriere_id', ids),
      ])
      const conPrezzo = new Set<string>([...(fasceP || []).map((r: any) => r.corriere_id), ...(aggP || []).map((r: any) => r.corriere_id)])
      for (const c of candidati) if (conPrezzo.has(c.id)) offerti.add(norm(c.nome_contratto))
    } else {
      for (const c of candidati) offerti.add(norm(c.nome_contratto))
    }

    // I contratti EREDITATI dal figlio (proprio!=true) che il padre non offre piu' -> nascosti.
    for (const c of (cFiglio || [])) {
      if ((c as any).proprio === true) continue
      const nome = norm((c as any).nome_contratto)
      if (nome && !offerti.has(nome)) bloccati.add(nome)
    }
    corrente = padre
  }

  // Guardia finale: un nome che il master che legge possiede come PROPRIO non si nasconde mai.
  for (const n of nomiPropriMiei) bloccati.delete(n)
  return bloccati
}

// Retro-compatibile: ora copre TUTTI E TRE i casi (pausa + disattiva + eliminato), non solo la pausa.
// Le ~12 porte che gia' chiamano contrattiSospesiSopra/sospesoDallaCatena beneficiano senza modifiche.
export async function contrattiSospesiSopra(masterId: string | null | undefined): Promise<Set<string>> {
  return contrattiRimossiSopra(masterId)
}

// true se questo contratto e' fuori uso per colpa di un livello superiore.
export function sospesoDallaCatena(nomeContratto: string | null | undefined, sospesi: Set<string>): boolean {
  if (!sospesi.size) return false
  return sospesi.has(String(nomeContratto || '').trim().toLowerCase())
}
