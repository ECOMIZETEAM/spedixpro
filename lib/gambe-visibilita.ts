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

// I DOPPIONI DENTRO IL PERIMETRO. La regola qui sopra guarda il viewer: nasconde le gambe di chi VENDE a lui.
// Ma chi legge piu' livelli insieme (la radice, che vede tutto l'albero) trova anche le gambe fra DUE master
// entrambi nel suo perimetro — Wave che vende a MULTI, LOGIXIA che vende a Wave — e cosi' la stessa
// spedizione compariva una volta per gamba: +49,7% di righe a ottobre 2026 nell'elenco della radice.
// Qui si prendono i ledger dei legami il cui ACQUIRENTE sta nel perimetro letto: la sua riga (o quella del
// suo cliente) e' gia' in elenco, la gamba del fornitore verso di lui e' un doppione. Per un master che
// legge solo il suo albero il risultato coincide con quello di sopra (MULTIEXPRESS: stessi due ledger).
export async function ledgerDoppioniNelPerimetro(
  admin: { from: (t: string) => any },
  perimetroMasterIds: string[] | null | undefined,
): Promise<string[]> {
  if (!perimetroMasterIds?.length) return []
  const { data } = await admin.from('corrieri_condivisi')
    .select('cliente_ledger_id').in('master_id', perimetroMasterIds).eq('stato', 'attiva')
  return Array.from(new Set(((data || []) as any[]).map(r => r.cliente_ledger_id).filter(Boolean)))
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
