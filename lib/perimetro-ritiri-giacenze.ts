// CHI VEDE QUALI RITIRI E QUALI GIACENZE. Una regola sola per l'Elenco Ritiri (/api/ritiri), la pagina Giacenze
// (/api/giacenze) e il calendario (/api/calendario/automatici). Prima stava dentro le due rotte, e il calendario
// (25/11/2026) l'avrebbe copiata una terza volta: una stretta messa in una porta e dimenticata nelle altre è proprio
// il guasto che CLAUDE.md chiede di non ripetere.
//
// Qui si decide SOLO il perimetro (quali master, quali clienti, quali contratti). Cosa mostrare, in che ordine e con
// quali filtri di pagina resta nelle rotte. Le rotte scelgono anche il client: quello dell'utente quando basta la RLS,
// quello di servizio quando si guarda dentro la rete (la RLS mostra solo la rete a valle del proprio master).
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'
import { ledgerGambeInterne } from '@/lib/gambe-visibilita'

export const NESSUN_MASTER = '00000000-0000-0000-0000-000000000000'

type Utente = { master_id?: string | null; ruolo?: string | null; cliente_id?: string | null; nome?: string | null; cognome?: string | null } | null | undefined

export type Perimetro =
  | { nessuno: true }
  | {
      nessuno: false
      masterIds: string[]
      // il portale cliente: le righe di un cliente solo (anche null, come prima: nessuna riga)
      cliente?: { id: string | null }
      // l'agente: le righe dei suoi clienti
      clienteIds: string[] | null
      // dentro la rete: solo i contratti che possiedo o rivendo, non i privati dei sotto-master
      contratti: string[] | null
      // giacenze: i ledger d'acquisto delle gambe interne, che non sono clienti di nessuno
      nascosti: string[]
      // più di un master: serve il client di servizio (e l'elenco scrive il nome del sotto-master)
      rete: boolean
    }

// ── RITIRI ──
// Cliente: i propri. Agente: quelli dei suoi clienti (cadeva nel ramo del master e leggeva i ritiri di tutto il master,
// con ragioni sociali e indirizzi). Staff: la rete visibile (masterIdsVisibili), e dei sotto-master solo i ritiri sui
// contratti che possiedo o rivendo (MULTI vedeva 1.891 ritiri di Velox, GTS e altri sui contratti loro, 14/10/2026).
// «m:<masterId>» nell'elenco = un sotto-master scelto: il suo sotto-albero, se è davvero sotto di me.
// L'autista lavora solo da /api/autista: qui finiva nel ramo del master e leggeva i ritiri di tutta la rete.
export async function perimetroRitiri(supabase: any, admin: any, utente: Utente, masterSel?: string | null): Promise<Perimetro> {
  if ((utente?.ruolo || '').toLowerCase() === 'autista') return { nessuno: true }
  if (utente?.ruolo === 'cliente') {
    return { nessuno: false, masterIds: [utente.master_id as string], cliente: { id: utente.cliente_id ?? null }, clienteIds: null, contratti: null, nascosti: [], rete: false }
  }
  if (isAgente(utente)) {
    const ids = idClientiPerFiltro(await clientiAgente(supabase, utente))
    return { nessuno: false, masterIds: [utente!.master_id as string], clienteIds: ids, contratti: null, nascosti: [], rete: false }
  }
  const { sottoAlberoMasterIds, masterIdsVisibili, contrattiPossedutiNomi } = await import('@/lib/rete-masters')
  let masterIds: string[] = [NESSUN_MASTER]
  if (utente?.master_id) {
    if (masterSel) {
      const mieiDiscendenti = await masterIdsVisibili(admin, utente.master_id)
      masterIds = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(admin, masterSel) : [NESSUN_MASTER]
    } else {
      masterIds = await masterIdsVisibili(admin, utente.master_id)
    }
  }
  // Le mie righe stanno sempre sui miei contratti, quindi il filtro serve (e si mette) solo se guardo anche altri.
  let contratti: string[] | null = null
  if (utente?.master_id && masterIds.some((id) => id !== utente.master_id)) {
    const nn = await contrattiPossedutiNomi(admin, utente.master_id)
    contratti = nn.length ? nn : null
  }
  return { nessuno: false, masterIds, clienteIds: null, contratti, nascosti: [], rete: masterIds.length > 1 }
}

// ── GIACENZE (portale master: staff e agenti) ──
// Staff: il sotto-albero intero (come Elenco Spedizioni), solo sui contratti posseduti, senza le gambe interne
// (fn_ledger_nascosti). Agente: il proprio master, solo i suoi clienti. Gli altri ruoli (cliente, autista) qui non
// passano: il cliente ha /api/cliente/giacenze, l'autista nessuna.
export async function perimetroGiacenze(supabase: any, admin: any, utente: Utente, masterSel?: string | null): Promise<Perimetro> {
  if (!utente?.master_id || (!vedeLaRete(utente) && !isAgente(utente))) return { nessuno: true }
  const { sottoAlberoMasterIds, masterIdsVisibili, contrattiPossedutiNomi } = await import('@/lib/rete-masters')
  let masterIds: string[] = [utente.master_id]
  let contratti: string[] | null = null
  let rete = false
  if (masterSel && vedeLaRete(utente)) {
    const mieiDiscendenti = await masterIdsVisibili(admin, utente.master_id)
    masterIds = mieiDiscendenti.includes(masterSel) ? await sottoAlberoMasterIds(admin, masterSel) : [NESSUN_MASTER]
    rete = true
    const nn = await contrattiPossedutiNomi(admin, utente.master_id)
    contratti = nn.length ? nn : null
  } else if (vedeLaRete(utente)) {
    masterIds = await sottoAlberoMasterIds(admin, utente.master_id)
    rete = masterIds.length > 1
    const nn = await contrattiPossedutiNomi(admin, utente.master_id)
    contratti = nn.length ? nn : null
  }
  const nascosti = isAgente(utente) ? [] : await ledgerGambeInterne(admin, utente.master_id)
  const clienteIds = isAgente(utente) ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  return { nessuno: false, masterIds, clienteIds, contratti, nascosti, rete }
}

// ── GIACENZE (portale cliente) ──
// Le sue, come /api/cliente/giacenze (che le legge col client dell'utente: la RLS e cliente_id = il suo).
export function perimetroGiacenzeCliente(utente: Utente): Perimetro {
  if (utente?.ruolo !== 'cliente' || !utente.master_id || !utente.cliente_id) return { nessuno: true }
  return { nessuno: false, masterIds: [utente.master_id], cliente: { id: utente.cliente_id }, clienteIds: null, contratti: null, nascosti: [], rete: false }
}

// la riga dei corrieri nella select: col filtro sui contratti il collegamento deve essere «inner»
export function corrieriDelPerimetro(p: Perimetro, campi: string): string {
  return !p.nessuno && p.contratti ? `corrieri!inner(${campi})` : `corrieri(${campi})`
}

// applica il perimetro a una query su ritiri o spedizioni (che hanno master_id, cliente_id e corrieri)
export function applicaPerimetro<Q extends { eq: any; in: any; or: any }>(q: Q, p: Perimetro): Q {
  if (p.nessuno) return q.in('master_id', [NESSUN_MASTER])
  q = p.masterIds.length === 1 ? q.eq('master_id', p.masterIds[0]) : q.in('master_id', p.masterIds)
  if (p.cliente) q = q.eq('cliente_id', p.cliente.id)
  if (p.clienteIds) q = q.in('cliente_id', p.clienteIds)
  if (p.nascosti.length) q = q.or(`cliente_id.is.null,cliente_id.not.in.(${p.nascosti.join(',')})`)
  if (p.contratti) q = q.in('corrieri.nome_contratto', p.contratti)
  return q
}

// il calendario guarda solo il proprio master (nell'Elenco Ritiri di MULTIEXPRESS la rete fa ~950 ritiri al giorno):
// è lo stesso perimetro, ristretto. Non può mai mostrare una riga che le pagine di ogni giorno non mostrano.
export function soloIlMioMaster(p: Perimetro, masterId: string): Perimetro {
  if (p.nessuno) return p
  const masterIds = p.masterIds.filter((id) => id === masterId)
  return masterIds.length ? { ...p, masterIds, rete: false } : { nessuno: true }
}
