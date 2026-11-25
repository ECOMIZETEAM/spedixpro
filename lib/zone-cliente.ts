// ELENCO ZONE IN SOLA LETTURA PER IL CLIENTE (25/11/2026).
//
// PERCHE'. Il cliente vede nel suo listino le colonne "Zone Disagiate", "Isole Minori", "SCS"… ma non
// sa quali CAP ci sono dentro, e lo chiede al master. Caso vero: Pedana click (integrazione via API)
// ha chiesto a mano gli elenchi di sette zone su tre contratti, e prepararli ha portato a galla un
// buco di zona sul Lido di Venezia. Qui il cliente legge da solo, per ogni contratto del suo listino,
// le zone che paga e le localita' che contengono, e puo' verificare un indirizzo preciso.
//
// DUE COSE DIVERSE, E LA DIFFERENZA CONTA:
//  - l'ELENCO e' la configurazione cosi' com'e' scritta (righe di zone_cap). Non dice da solo quale
//    zona vince quando un CAP compare in due zone, o quando una zona non ha prezzo nel listino: quella
//    decisione la prende il motore (lib/zone-match), con regole che un elenco non puo' riassumere
//    senza rischiare di dire il falso;
//  - la VERIFICA fa lo stesso calcolo della creazione (stesso controllo della citta' di
//    lib/citta-spedizione, poi calcolaPrezzoListino, la funzione con cui si ADDEBITA): la zona che
//    risponde e' quella che verra' fatta pagare. Per un indirizzo preciso fa fede lei.
//
// PERIMETRO: gli stessi contratti che il cliente vede nella pagina Listino Prezzi
// (app/api/cliente/listino-prezzi): nel suo listino, non disattivati dal master per lui, attivi e non
// sospesi piu' su nella catena. Le letture del perimetro passano dal client dell'utente (RLS); le righe
// di zona dal client di servizio, solo DOPO il controllo.
import { contrattiSospesiSopra, sospesoDallaCatena } from '@/lib/contratti-catena'
import { nomiArchivioPerCap } from '@/lib/valida-citta'
import { CAP_PROVINCIA } from '@/lib/provincia-da-cap'

export type ContrattoCliente = { clienteId: string; listinoId: string; corriereId: string; nomeContratto: string }

// Il contratto e' uno di quelli che QUESTO utente cliente vede nel suo listino? null = no.
export async function contrattoDelCliente(supabase: any, userId: string, corriereId: string): Promise<ContrattoCliente | null> {
  if (!corriereId) return null
  const { data: u } = await supabase.from('utenti').select('cliente_id').eq('id', userId).single()
  const clienteId = (u as any)?.cliente_id
  if (!clienteId) return null
  const { data: cli } = await supabase.from('clienti').select('listino_cliente_id').eq('id', clienteId).single()
  const listinoId = (cli as any)?.listino_cliente_id
  if (!listinoId) return null
  const { data: f } = await supabase.from('listini_clienti_fasce')
    .select('corrieri(nome_contratto,attivo,master_id)')
    .eq('listino_id', listinoId).eq('corriere_id', corriereId).limit(1).maybeSingle()
  const corr = (f as any)?.corrieri
  if (!corr || corr.attivo === false) return null
  const { data: ab } = await supabase.from('clienti_corrieri_abilitati')
    .select('abilitato').eq('cliente_id', clienteId).eq('corriere_id', corriereId).maybeSingle()
  if ((ab as any)?.abilitato === false) return null
  if (sospesoDallaCatena(corr.nome_contratto, await contrattiSospesiSopra(corr.master_id))) return null
  return { clienteId, listinoId, corriereId, nomeContratto: corr.nome_contratto || 'Corriere' }
}

// Come si legge una riga di zona. `tipo` decide la frase nella pagina.
export type RigaZonaCliente = {
  paese: string
  provincia: string | null
  cap: string | null
  citta: string | null
  tipo: 'tutto_paese' | 'provincia' | 'localita_provincia' | 'cap' | 'localita'
  localita?: string[]   // per "tutto il CAP" in Italia: comuni e frazioni dell'archivio con quel CAP
}
export type ZonaCliente = { nome: string; partenza: boolean; multicollo: boolean; righe: RigaZonaCliente[] }

const jolly = (v: any) => v == null || String(v).trim() === '' || String(v).trim() === '*'

// null = riga che il motore non aggancia mai, e che quindi non va mostrata come se valesse.
// Caso vero (25/11/2026): 18 righe per contratto in "Zone Disagiate" di 17 contratti col CAP senza lo
// zero iniziale ("4020 SPIGNO SATURNIA" per 04020). Il motore confronta il CAP come testo: quelle righe
// non scattano mai (su POSTE DELIVERY EXPRESS D Spigno Saturnia esce "Italia"). Mostrarle al cliente
// come zona disagiata sarebbe dirgli una cosa che il calcolo non fa.
function leggiRiga(r: any): RigaZonaCliente | null {
  const paese = String(r.paese || 'IT').toUpperCase()
  const provincia = jolly(r.provincia) ? null : String(r.provincia).trim().toUpperCase()
  const cap = jolly(r.cap) ? null : String(r.cap).trim()
  const citta = jolly(r.citta) ? null : String(r.citta).trim()
  if (paese === 'IT' && cap && !/^\d{5}$/.test(cap)) return null
  if (!cap) {
    if (!provincia) return { paese, provincia, cap, citta, tipo: 'tutto_paese' }
    return { paese, provincia, cap, citta, tipo: citta ? 'localita_provincia' : 'provincia' }
  }
  if (citta) return { paese, provincia, cap, citta, tipo: 'localita' }
  return { paese, provincia, cap, citta, tipo: 'cap', ...(paese === 'IT' ? { localita: nomiArchivioPerCap(cap) } : {}) }
}

// Le zone che il cliente PAGA su questo contratto (quelle con una fascia nel suo listino, cioe' le
// colonne che vede nella griglia prezzi), con le loro righe.
export async function zoneDelContrattoCliente(supabase: any, admin: any, c: ContrattoCliente): Promise<ZonaCliente[]> {
  const zone = new Map<string, any>()
  for (let da = 0; ; da += 1000) {
    const { data, error } = await supabase.from('listini_clienti_fasce')
      .select('id,zona_id,zone(id,nome,su_mittente,multicollo)')
      .eq('listino_id', c.listinoId).eq('corriere_id', c.corriereId)
      .order('id', { ascending: true }).range(da, da + 999)
    if (error) throw new Error('lettura fasce: ' + error.message)
    for (const f of (data || [])) { const z = (f as any).zone; if (z?.id) zone.set(z.id, z) }
    if (!data || data.length < 1000) break
  }
  const ids = Array.from(zone.keys())
  const righePer = new Map<string, any[]>()
  // Una zona alla volta e in pagine da 1000 con ordine fisso: SCS ha 692 righe, ma una zona di
  // contratto puo' superare le mille, e senza ordine le pagine si accavallano (vedi lib/propaga-zona).
  for (const zid of ids) {
    const tutte: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await admin.from('zone_cap').select('paese,provincia,cap,citta')
        .eq('zona_id', zid).order('id', { ascending: true }).range(da, da + 999)
      if (error) throw new Error('lettura righe di zona: ' + error.message)
      tutte.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    righePer.set(zid, tutte)
  }
  const ordRiga = (a: RigaZonaCliente, b: RigaZonaCliente) =>
    (a.paese === 'IT' ? 0 : 1) - (b.paese === 'IT' ? 0 : 1) || a.paese.localeCompare(b.paese) ||
    (a.cap || '').localeCompare(b.cap || '') || (a.provincia || '').localeCompare(b.provincia || '') ||
    (a.citta || '').localeCompare(b.citta || '')
  const out: ZonaCliente[] = ids.map((zid) => {
    const z = zone.get(zid)
    const righe = (righePer.get(zid) || []).map(leggiRiga).filter(Boolean) as RigaZonaCliente[]
    return { nome: z.nome || '—', partenza: !!z.su_mittente, multicollo: !!z.multicollo, righe: righe.sort(ordRiga) }
  })
  // Prima le destinazioni, poi multicollo e partenza; fra le destinazioni prima quella "di base"
  // (tutto il paese), poi le altre per nome — l'ordine in cui le si legge nella griglia prezzi.
  const peso = (z: ZonaCliente) => (z.partenza ? 2 : z.multicollo ? 1 : 0)
  const base = (z: ZonaCliente) => (z.righe.some((r) => r.tipo === 'tutto_paese') ? 0 : 1)
  return out.sort((a, b) => peso(a) - peso(b) || base(a) - base(b) || a.nome.localeCompare(b.nome))
}

// La provincia che la creazione ricava da sola dal CAP (lib/provincia-da-cap). Estero: la sigla del
// paese, come la manda il modulo Nuova spedizione.
export function provinciaPerVerifica(paese: string, cap: string, provinciaScritta?: string | null): string {
  if (paese !== 'IT') return paese
  const p = String(provinciaScritta || '').trim().toUpperCase()
  return p || CAP_PROVINCIA.get(cap) || ''
}
