// I DUE GRAFI, sulla VISIBILITÀ delle gambe di una spedizione condivisa.
//
// Una spedizione condivisa "esplode" in N gambe (una per livello), che condividono il tracking. Un master
// vede le spedizioni del suo SOTTO-ALBERO (parent_master_id). Ma nella rivendita (corrieri_condivisi) i
// legami sono spesso INVERTITI rispetto all'albero: LOGIXIA e Wave sono figli-ALBERO di MULTI, però gli
// VENDONO (LOGIXIA→Wave→MULTI). Così MULTI, guardando il suo albero, vedeva anche le gambe dei suoi
// FORNITORI (Wave, LOGIXIA) → sembrava che lui vendesse a loro, mentre li COMPRA.
//
// Regola: un master non vede MAI, su una spedizione condivisa, le gambe di chi gli vende (a monte). Quelle
// gambe hanno come CLIENTE un ledger "(ingrosso)" d'acquisto — il conto su cui quel livello compra. Risalendo
// corrieri_condivisi dal master verso i suoi fornitori raccolgo quei ledger: le gambe il cui cliente_id è uno
// di quelli vanno NASCOSTE. Le gambe con cliente REALE (il cliente finale) non si toccano mai.
//
// Nota: per un master che NON compra via codice (nessun corrieri_condivisi come acquirente) torna [] → non
// cambia niente, vede il suo albero come prima. Verità dei legami = corrieri_condivisi, non parent_master_id.

// LE GAMBE INTERNE ALLA RETE — la regola per CONTARE e ELENCARE i pacchi della rete di un master.
//
// Una gamba e' un doppione per chi guarda la rete di un master quando il master che l'ha COMPRATA sta in
// quella rete: il pacco e' gia' li', dove e' nato. Se il compratore sta fuori, e' traffico che la rete
// rivende, e si vede. La regola vive nel database (fn_ledger_nascosti, scripts/gambe-interne-ovunque.sql)
// ed e' la stessa del contatore del piano, della home e delle statistiche: qui la si chiede, non la si
// ricalcola, cosi' elenco, report e home non possono piu' dire due numeri diversi.
//
// La catena dei fornitori qui sotto non bastava: lasciava doppi i pacchi venduti fra due master della
// stessa rete (il 19/11/2026, per MULTIEXPRESS: GTS a spedizioni 2000, SEMPLICE SPEDIRE ad Atlantik,
// Velox a SEMPLICE SPEDIRE), guardava solo le condivisioni attive (una revoca avrebbe fatto ricomparire
// le gambe vecchie), e quando un fornitore e' anche il padre avrebbe nascosto a SPEDIZIONI EXPRESS le sue
// stesse vendite a Velox.
//
// Se il database non risponde si torna []: i numeri escono gonfiati, ma la pagina si apre, e l'errore
// resta nei log.
export async function ledgerGambeInterne(
  admin: { rpc: (fn: string, args: any) => any },
  masterId: string | null | undefined,
): Promise<string[]> {
  if (!masterId) return []
  const { data, error } = await admin.rpc('fn_ledger_nascosti', { p_master: masterId })
  if (error) {
    console.error('[GAMBE] fn_ledger_nascosti non letta', masterId, error.message)
    return []
  }
  return (data || []) as string[]
}

// Resta per le DISTINTE (dettaglio e singola distinta): li' non si conta la rete, si mostra un documento —
// il borderò consegnato al corriere — e deve contenere tutti i suoi colli. Per contare ed elencare le
// spedizioni si usa ledgerGambeInterne.
export async function ledgerFornitoriDaNascondere(
  admin: { from: (t: string) => any },
  viewerMasterId: string | null | undefined,
): Promise<string[]> {
  if (!viewerMasterId) return []
  const nascosti = new Set<string>()
  const visti = new Set<string>([viewerMasterId])
  let frontier: string[] = [viewerMasterId]
  // Risalgo la catena-fornitore: i legami dove io (o un mio fornitore già trovato) sono l'acquirente.
  for (let i = 0; i < 20 && frontier.length; i++) {
    const { data } = await admin.from('corrieri_condivisi')
      .select('cliente_ledger_id,fornitore_master_id')
      .in('master_id', frontier).eq('stato', 'attiva')
    const next: string[] = []
    for (const r of (data || []) as any[]) {
      if (r.cliente_ledger_id) nascosti.add(r.cliente_ledger_id)
      if (r.fornitore_master_id && !visti.has(r.fornitore_master_id)) {
        visti.add(r.fornitore_master_id)
        next.push(r.fornitore_master_id)
      }
    }
    frontier = next
  }
  return [...nascosti]
}

// I MASTER-FORNITORI del viewer (chi gli vende, risalendo corrieri_condivisi). Serve dove la cosa da
// nascondere è un DOCUMENTO del master senza cliente proprio — le DISTINTE: le distinte dei fornitori
// (Wave, LOGIXIA per MULTI) non vanno mostrate al compratore. Si escludono dai master visibili.
// NOTA: oggi i fornitori non hanno distinte con gambe REALI proprie (verificato), quindi escludere il
// master = nascondere solo le distinte "pure fornitore", coerente con la lista spedizioni. Se un domani
// un fornitore avesse un business proprio in distinta, servirebbe l'esclusione per-distinta (RPC).
export async function masterFornitoriDaNascondere(
  admin: { from: (t: string) => any },
  viewerMasterId: string | null | undefined,
): Promise<string[]> {
  if (!viewerMasterId) return []
  const fornitori = new Set<string>()
  const visti = new Set<string>([viewerMasterId])
  let frontier: string[] = [viewerMasterId]
  for (let i = 0; i < 20 && frontier.length; i++) {
    const { data } = await admin.from('corrieri_condivisi')
      .select('fornitore_master_id').in('master_id', frontier).eq('stato', 'attiva')
    const next: string[] = []
    for (const r of (data || []) as any[]) {
      const f = r.fornitore_master_id
      if (f && !visti.has(f)) { visti.add(f); fornitori.add(f); next.push(f) }
    }
    frontier = next
  }
  return [...fornitori]
}
