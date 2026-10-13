import { nomeContrattoNormalizzato } from '@/lib/contratto-per-nome'

// I CONTRATTI CHE UN MASTER COMPRA DA UN ALTRO MASTER (PONTI CODICE).
//
// Un ponte codice è una riga `corrieri` tipo='moovexpress' il cui fornitore
// (credenziali.fornitore_master_id) ha con questo master un collegamento `corrieri_condivisi` ATTIVO
// (master_id = il compratore). È la stessa condizione con cui risolviCatenaCondivisione
// (lib/condivisione-catena.ts) riconosce un salto CODICE. Non sono ponti codice:
//  - le copie-albero di un ponte (credenziali {}): il padre gliele dà come ogni altra copia e, come ogni
//    copia, obbediscono al padre;
//  - le copie con la chiave di un altro master ma senza collegamento (Ecomize LL e altre tre, colate giù
//    per l'albero prima della guardia sulle credenziali): spediscono per albero, le governa il padre.
//
// Su un ponte codice il padre-albero NON ha voce: il master quel contratto lo compra da un altro.
// Il padre non lo spegne, non gli riscrive prezzi e zone col suo listino e non lo nasconde per nome.
// Il prezzo lo decide il fornitore del collegamento, la disponibilità il collegamento stesso.
//
// Prima si guardava solo corrieri_condivisi.corriere_acquirente_id, che esiste nei collegamenti del
// vecchio modello (uno per contratto) ed è NULL in quello attuale: il ponte GTS → spedizioni 2000 non
// veniva riconosciuto, e il primo salvataggio del listino di MULTIEXPRESS lo avrebbe spento e svuotato
// (13/10/2026). corriere_acquirente_id resta valido come segno in più, per i collegamenti vecchi.

// La regola, su una riga già letta: `riga` con id, tipo e fornitore (credenziali.fornitore_master_id),
// `links` i collegamenti ATTIVI in cui il master di quella riga è il compratore.
export function ePonteCodice(
  riga: { id: string; tipo?: string | null; fornitore?: string | null },
  links: { fornitore_master_id?: string | null; corriere_acquirente_id?: string | null }[],
): boolean {
  if (riga.tipo !== 'moovexpress') return false
  return links.some(l => l.corriere_acquirente_id === riga.id || (!!riga.fornitore && l.fornitore_master_id === riga.fornitore))
}

export async function pontiCodiceDi(
  admin: any, masterId: string | null | undefined,
): Promise<{ ids: Set<string>; nomi: Set<string> }> {
  const ids = new Set<string>()
  const nomi = new Set<string>()
  if (!masterId) return { ids, nomi }
  // Una lettura fallita NON vale "nessun ponte": chi chiama spegnerebbe o riprezzerebbe il ponte come
  // una copia qualsiasi. Si lancia, e chi chiama lascia stare quel master.
  const { data: links, error: eL } = await admin.from('corrieri_condivisi')
    .select('fornitore_master_id,corriere_acquirente_id').eq('master_id', masterId).eq('stato', 'attiva')
  if (eL) throw new Error('ponti codice: lettura collegamenti non riuscita: ' + eL.message)
  if (!links?.length) return { ids, nomi }
  // Dal JSON delle credenziali serve solo il fornitore: la chiave non si legge.
  const { data: righe, error: eR } = await admin.from('corrieri')
    .select('id,tipo,nome_contratto,fornitore:credenziali->>fornitore_master_id')
    .eq('master_id', masterId).eq('tipo', 'moovexpress')
  if (eR) throw new Error('ponti codice: lettura contratti non riuscita: ' + eR.message)
  for (const r of (righe || []) as any[]) {
    if (ePonteCodice(r, links)) {
      ids.add(r.id)
      nomi.add(nomeContrattoNormalizzato(r.nome_contratto))
    }
  }
  return { ids, nomi }
}
