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
//   (3) ELIMINA      -> la riga del padre per quel contratto non c'e' piu' (il master l'ha cancellato).
//
// Qui si risale la catena e si raccolgono i NOMI dei contratti che il figlio ha EREDITATO ma che
// l'antenato NON gli offre piu'. Il risultato puo' solo RESTRINGERE (nascondere), mai ampliare, ed e' un
// filtro alla LETTURA: NON si cancella nulla nei dati del sotto-master (mai il rischio di cancellare un
// suo contratto proprio omonimo). Un contratto PROPRIO non entra mai nell'elenco (guardia proprio).
//
// ATTENZIONE (24/08): la prima versione nascondeva anche i contratti ATTIVI al padre ma senza fascia
// nel listino assegnato al figlio. Sbagliato: spariva "Poste PDB Internazionale" a Ecomize LL pur essendo
// attivo e spedibile. Ora si guardano SOLO le tre azioni vere (pausa/disattiva/elimina la riga), MAI il
// listino: un prezzo mancante e' un problema di tariffa (nessuna tariffa esce), non di disponibilita' —
// non deve nascondere il contratto. Il filtro puo' solo togliere cio' che il padre non ha piu' davvero.
//
// Nota sul client: service role perche' l'RLS sui corrieri (master_id IN mia_rete_master()) nasconde le
// righe dei master superiori. Uso legittimo: si legge solo nome/attivo/aggancio/flag degli ANTENATI, e il
// risultato puo' unicamente TOGLIERE contratti.
// `db` e' FACOLTATIVO: chi non lo passa usa il client di servizio di sempre. Lo passa l'anteprima
// dei prezzi (lib/anteprima-prezzi.ts) per far fare queste letture — uguali per tutte le righe di
// uno stesso cliente — una volta sola (lib/db-memoria.ts). Deve restare un client di SERVIZIO: con
// il token di un utente l'RLS nasconde i master superiori e l'elenco uscirebbe vuoto.
export async function contrattiRimossiSopra(masterId: string | null | undefined, db?: any): Promise<Set<string>> {
  return new Set((await contrattiRimossiConMotivo(masterId, db)).keys())
}

// Gli stessi nomi, col PERCHÉ di ogni blocco: 'pausa' (una riga reale del padre c'è, non disabilitata per
// il figlio, ma spenta: la pausa finisce da sola) oppure 'tolto' (disabilitato per il figlio, o il padre
// non ha più una riga reale con quel nome). Un nome può averli entrambi, presi a livelli diversi: a
// SEMPLICE SPEDIRE il GLS di spedizioni 2000 risulta in pausa (lo è la copia del padre), ma è morto perché
// a spedizioni 2000 l'ha tolto MULTIEXPRESS, un livello più su. Serve alla condivisione: un contratto
// TOLTO dall'albero un master collegato lo può vendere; uno soltanto in pausa no, perché la pausa finisce
// e il master se lo ritroverebbe da due fornitori (lib/condivisione-engine.ts, valutaContrattoPerCompratore).
//
// `stretto`: una lettura fallita LANCIA. Senza, si va avanti come sempre: nelle porte che mostrano o
// vendono, un errore al più nasconde un contratto. La condivisione invece da qui decide cosa cancellare,
// e con le righe del padre non lette ogni contratto ereditato risulterebbe "tolto".
export async function contrattiRimossiConMotivo(masterId: string | null | undefined, db?: any, opts?: { stretto?: boolean }): Promise<Map<string, Set<'pausa' | 'tolto'>>> {
  const bloccati = new Map<string, Set<'pausa' | 'tolto'>>()
  if (!masterId) return bloccati
  const segna = (nome: string, motivo: 'pausa' | 'tolto') => {
    if (!bloccati.has(nome)) bloccati.set(nome, new Set())
    bloccati.get(nome)!.add(motivo)
  }
  const verifica = (error: any, cosa: string) => {
    if (error && opts?.stretto) throw new Error(`contratti tolti da sopra: lettura ${cosa} non riuscita: ${error.message || error}`)
  }
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = db || createAdminSupabase()
  const norm = (s: any) => String(s || '').trim().toLowerCase()

  let corrente: string | null = masterId
  const visti = new Set<string>([masterId])
  // Nomi PROPRI del master che legge: non vanno MAI nascosti, nemmeno se un antenato ha tolto un
  // contratto con lo stesso nome (scenario GLS/BRT diretti). Guardia finale.
  const { data: cMio, error: eMio } = await admin.from('corrieri').select('nome_contratto').eq('master_id', masterId).eq('proprio', true)
  verifica(eMio, 'dei contratti propri')
  const nomiPropriMiei = new Set<string>((cMio || []).map((c: any) => norm(c.nome_contratto)))

  for (let i = 0; i < 20; i++) {
    const { data: mRow, error: eM }: any = await admin.from('masters').select('parent_master_id').eq('id', corrente).maybeSingle()
    verifica(eM, 'del master')
    const padre: string | null = mRow?.parent_master_id || null
    if (!padre || visti.has(padre)) break
    visti.add(padre)

    const { data: cPadre, error: eP } = await admin.from('corrieri').select('id,nome_contratto,attivo,tipo').eq('master_id', padre)
    const { data: cFiglio, error: eF } = await admin.from('corrieri').select('nome_contratto,proprio,tipo').eq('master_id', corrente)
    const { data: disab, error: eD } = await admin.from('masters_corrieri_abilitati').select('corriere_id').eq('master_id', corrente).eq('abilitato', false)
    verifica(eP || eF || eD, 'dei contratti del padre e del figlio')
    const disabIds = new Set((disab || []).map((r: any) => r.corriere_id))

    // OFFERTI dal padre = i contratti che il padre ha ANCORA, attivi e non disabilitati per il figlio.
    // PAUSA (attivo=false), DISATTIVA (in disabIds) ed ELIMINA (riga del padre assente) lo fanno uscire da
    // qui e quindi lo nascondono a valle. NIENTE listino: se il contratto e' attivo al padre spedisce.
    //
    // Solo le righe REALI del padre (non moovexpress) offrono un contratto reale al figlio. Una copia reale
    // del figlio spedisce sull'account di chi detiene il contratto, risalendo l'albero: se il padre per quel
    // nome ha soltanto un ponte (lo compra via codice da un altro master), sopra di lui l'account non è più
    // suo da dare. Caso vero del 13/10/2026: MULTIEXPRESS toglie il GLS a spedizioni 2000, che lo compra da
    // GTS; la copia reale rimasta sotto, a SEMPLICE SPEDIRE, con le credenziali di MULTIEXPRESS, sarebbe
    // tornata spedibile appena il ponte di spedizioni 2000 "offriva" il nome — saltando GTS e lo stop di
    // MULTIEXPRESS, con spedizioni 2000 addebitata verso MULTIEXPRESS al prezzo di GTS.
    // Il motivo resta PAUSA solo se una riga reale del padre c'è, non è disabilitata per il figlio ed è
    // spenta: la pausa finisce da sola. Altrimenti il contratto è TOLTO.
    const offerti = new Set<string>()
    const nonDisabilitati = new Set<string>()
    for (const c of (cPadre || [])) {
      if ((c as any).tipo === 'moovexpress' || disabIds.has((c as any).id)) continue
      const n = norm((c as any).nome_contratto)
      nonDisabilitati.add(n)
      if ((c as any).attivo !== false) offerti.add(n)
    }

    // I contratti EREDITATI dal figlio (proprio!=true) che il padre non offre piu' -> nascosti.
    for (const c of (cFiglio || [])) {
      if ((c as any).proprio === true) continue
      // CONDIVISIONE: un PONTE (tipo='moovexpress') NON è un contratto ereditato dall'ALBERO: è un contratto
      // CODICE che il master detiene via `corrieri_condivisi` (non dal padre-albero). La sua disponibilità la
      // governa il legame-codice / il suo `attivo`, non ciò che offre il padre-albero. Trattarlo come ereditato
      // lo farebbe sparire appena non è `proprio` (es. dopo il fix del flag detentore: il ponte di MULTI è
      // proprio=false e la radice non ha quel contratto → "in pausa" a torto). Lo si salta, come i proprio=true.
      if ((c as any).tipo === 'moovexpress') continue
      const nome = norm((c as any).nome_contratto)
      if (nome && !offerti.has(nome)) segna(nome, nonDisabilitati.has(nome) ? 'pausa' : 'tolto')
    }
    corrente = padre
  }

  // Guardia finale: un nome che il master che legge possiede come PROPRIO non si nasconde mai.
  for (const n of nomiPropriMiei) bloccati.delete(n)
  return bloccati
}

// Retro-compatibile: ora copre TUTTI E TRE i casi (pausa + disattiva + eliminato), non solo la pausa.
// Le ~12 porte che gia' chiamano contrattiSospesiSopra/sospesoDallaCatena beneficiano senza modifiche.
export async function contrattiSospesiSopra(masterId: string | null | undefined, db?: any): Promise<Set<string>> {
  return contrattiRimossiSopra(masterId, db)
}

// true se questo contratto e' fuori uso per colpa di un livello superiore.
export function sospesoDallaCatena(nomeContratto: string | null | undefined, sospesi: Set<string>): boolean {
  if (!sospesi.size) return false
  return sospesi.has(String(nomeContratto || '').trim().toLowerCase())
}
