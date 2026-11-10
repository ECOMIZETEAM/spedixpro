// CONTABILITA' CON L'ESTRATTO CONTO (Lorenzo, 10/11/2026): chi ha pagato una ricarica e come, per
// poterla ritrovare sull'estratto conto del master. In prova solo per Ecomize Solution: quando Ecomize
// da' l'ok si accende per tutti togliendo il filtro qui sotto, in un punto solo.
const MASTER_IN_PROVA = ['75b08143-26c8-4903-8091-cd03fbd635ed'] // Ecomize Solution

export function contabilitaAttiva(masterId?: string | null): boolean {
  return !!masterId && MASTER_IN_PROVA.includes(masterId)
}

// Come ha pagato. In banca si cercano solo i bonifici: contrassegni compensati e contanti sul conto
// non arrivano mai e non devono risultare "non pagati" (Ecomize LL a ottobre: 38.916,92 € di
// "Accredito credito a scalare cod …", nessun bonifico).
export const METODI_PAGAMENTO = [
  { valore: 'bonifico', etichetta: 'Bonifico' },
  { valore: 'cod_compensati', etichetta: 'Contrassegni compensati' },
  { valore: 'contanti', etichetta: 'Contanti' },
  { valore: 'altro', etichetta: 'Altro' },
] as const
export type MetodoPagamento = typeof METODI_PAGAMENTO[number]['valore']
export const metodoValido = (m: unknown): m is MetodoPagamento => METODI_PAGAMENTO.some(x => x.valore === m)
// 'giro' = la ricarica a un sotto-master pagata dai bonifici dei SUOI clienti arrivati sul conto del master
// (Ecomize LL, Dg Express). Non si sceglie nella finestra di ricarica: nasce dal pulsante dell'estratto conto,
// o si segna dall'estratto sulle ricariche fatte a mano prima che il pulsante esistesse.
export const METODI_ESTRATTO = [...METODI_PAGAMENTO, { valore: 'giro', etichetta: 'Giro dei bonifici dei suoi clienti' }] as const
export type MetodoEstratto = typeof METODI_ESTRATTO[number]['valore']
export const metodoEstrattoValido = (m: unknown): m is MetodoEstratto => METODI_ESTRATTO.some(x => x.valore === m)
export const etichettaMetodo = (m?: string | null) => METODI_ESTRATTO.find(x => x.valore === m)?.etichetta || null

export type SottoSulConto = { id: string, nome: string, giroDal: string }
/** I sotto-master i cui clienti pagano sul conto in banca di questo master (tabella conti_condivisi), e da quale
 *  giorno dei bonifici si girano dal portale. Ecomize Solution: Ecomize LL e Dg Express, dall'11/11/2026.
 *  Se la tabella non c'e' ancora (codice rilasciato prima del database) la funzione resta spenta: nessun
 *  sotto-master, l'estratto conto lavora come prima. Ogni altro errore si ferma. */
export async function sottoSulConto(admin: any, masterId: string): Promise<SottoSulConto[]> {
  const { data, error } = await admin.from('conti_condivisi').select('sotto_master_id,giro_dal').eq('master_id', masterId)
  if (error) {
    if (/conti_condivisi/.test(error.message || '') && /does not exist|Could not find|schema cache/i.test(error.message || '')) return []
    throw new Error(error.message)
  }
  if (!data?.length) return []
  const { data: m, error: e2 } = await admin.from('masters').select('id,nome').in('id', data.map((x: any) => x.sotto_master_id))
  if (e2) throw new Error(e2.message)
  const nomi = new Map((m || []).map((x: any) => [x.id, x.nome || '—']))
  return data.map((x: any) => ({ id: x.sotto_master_id, nome: String(nomi.get(x.sotto_master_id) || '—'), giroDal: String(x.giro_dal).slice(0, 10) }))
}

/** Il nome come lo si salva: spazi in fila ridotti a uno, al massimo 140 caratteri (il limite della tabella). */
export function pulisciNome(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
}

/** IBAN senza spazi e in maiuscolo; null se non e' un IBAN (paese, controllo, 10-30 caratteri). */
export function pulisciIban(s: unknown): string | null {
  const v = String(s ?? '').replace(/\s+/g, '').toUpperCase()
  return /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(v) ? v : null
}

export type Pagatore = { id: string, nome: string, iban: string | null, origine: string, ultimo_uso: string | null }

/** I pagatori di un cliente o sotto-master, l'ultimo usato per primo (e' quello da proporre). */
export async function leggiPagatori(admin: any, masterId: string, targetTipo: 'cliente' | 'master', targetId: string): Promise<Pagatore[]> {
  const { data, error } = await admin.from('pagatori_bonifico')
    .select('id,nome,iban,origine,ultimo_uso,created_at')
    .eq('master_id', masterId).eq('target_tipo', targetTipo).eq('target_id', targetId)
    .order('ultimo_uso', { ascending: false, nullsFirst: false }).order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []) as Pagatore[]
}

/** Aggiunge un pagatore, o se c'e' gia' (stesso nome, stesso IBAN) ne aggiorna l'ultimo uso. */
export async function ricordaPagatore(admin: any, p: {
  masterId: string, targetTipo: 'cliente' | 'master', targetId: string, nome: string, iban?: string | null,
  origine: 'manuale' | 'ricarica' | 'estratto', createdBy?: string | null, usato?: boolean,
}): Promise<void> {
  const nome = pulisciNome(p.nome)
  if (!nome) return
  const iban = p.iban ? pulisciIban(p.iban) : null
  const esistenti = await leggiPagatori(admin, p.masterId, p.targetTipo, p.targetId)
  const gia = esistenti.find(x => x.nome.toUpperCase() === nome.toUpperCase() && (x.iban || null) === iban)
  const ora = new Date().toISOString()
  if (gia) {
    if (p.usato) await admin.from('pagatori_bonifico').update({ ultimo_uso: ora }).eq('id', gia.id).eq('master_id', p.masterId)
    return
  }
  const { error } = await admin.from('pagatori_bonifico').insert({
    master_id: p.masterId, target_tipo: p.targetTipo, target_id: p.targetId, nome, iban,
    origine: p.origine, created_by: p.createdBy || null, ultimo_uso: p.usato ? ora : null,
  })
  // Due salvataggi contemporanei dello stesso nome: il secondo trova l'indice unico, ed e' giusto cosi'.
  if (error && !/duplicate key|23505/.test(error.message)) throw new Error(error.message)
}
