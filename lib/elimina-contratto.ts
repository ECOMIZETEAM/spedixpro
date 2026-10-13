import { fetchAllStretto } from '@/lib/fetch-all'

// ELIMINARE UN CONTRATTO (una o più righe `corrieri`): un punto solo.
//
// Lo storico non si cancella (REGOLE.md): spedizioni, ritiri e distinte puntano al contratto con vincoli
// NO ACTION, quindi nel database il DELETE di un contratto usato fallisce intero. Tutta la configurazione
// (zone e CAP, listini di costo e di vendita, supplementi, agganci, abilitazioni) cade da sola con i
// vincoli ON DELETE CASCADE, nella stessa istruzione. Prima la si cancellava a mano, tabella per tabella,
// prima della riga: se il DELETE finale falliva il contratto restava in piedi senza zone né prezzi.
// La stessa cosa era scritta in tre posti (rotta DELETE dei corrieri, disabilitazione di un contratto
// condiviso, sostituzione di una copia morta), e la seconda guardava solo le spedizioni senza controllare
// l'esito del DELETE.
// Chi chiama controlla che il contratto sia suo da eliminare: qui non si guarda il proprietario.

export type Storico = { spedizioni: number; ritiri: number; distinte: number; nonVerificato: boolean }

export async function storicoContratti(admin: any, ids: string[]): Promise<Storico> {
  const out: Storico = { spedizioni: 0, ritiri: 0, distinte: 0, nonVerificato: false }
  if (!ids.length) return out
  for (const tab of ['spedizioni', 'ritiri', 'distinte'] as const) {
    const { count, error } = await admin.from(tab).select('id', { count: 'exact', head: true }).in('corriere_id', ids)
    // Se il conteggio non riesce non si elimina: meglio fermarsi che perdere lo storico. Chi chiama lo
    // dice per quello che è ("non verificato"), non come "usato".
    if (error) out.nonVerificato = true
    else out[tab] = count || 0
  }
  return out
}

export async function eliminaContrattiSenzaStorico(
  admin: any, ids: string[],
): Promise<{ ok: true } | { ok: false; reason: string; storico?: Storico }> {
  if (!ids.length) return { ok: true }
  const storico = await storicoContratti(admin, ids)
  if (storico.nonVerificato) return { ok: false, reason: 'Non sono riuscito a verificare lo storico del contratto: riprova.', storico }
  if (storico.spedizioni + storico.ritiri + storico.distinte > 0) {
    return { ok: false, reason: 'Contratto usato da spedizioni, ritiri o distinte: lo storico non si cancella.', storico }
  }
  const { error } = await admin.from('corrieri').delete().in('id', ids)
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

export type Attaccato = {
  zone: number; cap: number
  fasceCosto: number; supplementiCosto: number
  fasceVendita: number; supplementiVendita: number; listiniVendita: number
  clientiToccati: number; masterToccati: number; agentiToccati: number
  chiaviApi: number; condivisioni: number; pontiAValle: number
  webhooks: number; podPrezzi: number; corrieriCliente: number; articoli: number; autisti: number
}

// Cosa porta via l'eliminazione, contato prima di farla: lo si mostra a chi conferma, resta scritto nel
// registro e decide se si può procedere senza un intervento a mano. Tutto ciò che il DELETE cancella in
// cascata o azzera (articoli col corriere predefinito, autisti assegnati alle sue zone), più quello che
// resterebbe orfano senza vincoli (chiavi API, condivisioni, ponti che rivendono il contratto).
// Una lettura fallita lancia: un conteggio mancato non deve mai passare per "niente di attaccato".
export async function cosaCeAttaccato(admin: any, ids: string[]): Promise<Attaccato> {
  const vuoto: Attaccato = {
    zone: 0, cap: 0, fasceCosto: 0, supplementiCosto: 0, fasceVendita: 0, supplementiVendita: 0, listiniVendita: 0,
    clientiToccati: 0, masterToccati: 0, agentiToccati: 0, chiaviApi: 0, condivisioni: 0, pontiAValle: 0,
    webhooks: 0, podPrezzi: 0, corrieriCliente: 0, articoli: 0, autisti: 0,
  }
  if (!ids.length) return vuoto
  const testa = { count: 'exact' as const, head: true }
  const conta = async (q: any, cosa: string) => {
    const { count, error } = await q
    if (error) throw new Error(`conteggio di ${cosa} non riuscito: ${error.message}`)
    return count || 0
  }
  const lista = ids.join(',')
  const { data: zone, error: eZ } = await admin.from('zone').select('id').in('corriere_id', ids)
  if (eZ) throw new Error('lettura zone non riuscita: ' + eZ.message)
  const vendita = await fetchAllStretto(() => admin.from('listini_clienti_fasce').select('listino_id').in('corriere_id', ids).order('id', { ascending: true }))
  const listini = Array.from(new Set(vendita.map((f: any) => f.listino_id).filter(Boolean)))
  const zoneIds = (zone || []).map((z: any) => z.id)
  const [cap, autisti, fasceCosto, supplementiCosto, supplementiVendita, chiaviApi, condivisioni, pontiAValle,
    webhooks, podPrezzi, corrieriCliente, articoli, clientiToccati, masterToccati, agentiToccati] = await Promise.all([
    zoneIds.length ? conta(admin.from('zone_cap').select('id', testa).in('zona_id', zoneIds), 'CAP') : Promise.resolve(0),
    zoneIds.length ? conta(admin.from('autisti').select('id', testa).in('zona_id', zoneIds), 'autisti') : Promise.resolve(0),
    conta(admin.from('listini_corrieri_fasce').select('id', testa).in('corriere_id', ids), 'prezzi di costo'),
    conta(admin.from('listini_corrieri_supplementi').select('id', testa).in('corriere_id', ids), 'supplementi di costo'),
    conta(admin.from('listini_clienti_supplementi').select('id', testa).in('corriere_id', ids), 'supplementi di vendita'),
    conta(admin.from('api_keys').select('id', testa).in('corriere_id', ids), 'chiavi API'),
    conta(admin.from('corrieri_condivisi').select('id', testa).or(`corriere_id.in.(${lista}),corriere_acquirente_id.in.(${lista})`), 'condivisioni'),
    conta(admin.from('corrieri').select('id', testa).eq('tipo', 'moovexpress').in('credenziali->>corriere_origine_id', ids), 'ponti a valle'),
    conta(admin.from('webhooks').select('id', testa).in('corriere_id', ids), 'webhook'),
    conta(admin.from('pod_prezzi').select('id', testa).in('corriere_id', ids), 'prezzi POD'),
    conta(admin.from('corrieri_cliente').select('id', testa).in('corriere_id', ids), 'contratti dei clienti'),
    conta(admin.from('articoli_cliente').select('id', testa).or(`corriere_id.in.(${lista}),corriere_estero_id.in.(${lista})`), 'articoli'),
    listini.length ? conta(admin.from('clienti').select('id', testa).in('listino_cliente_id', listini), 'clienti') : Promise.resolve(0),
    listini.length ? conta(admin.from('masters').select('id', testa).in('parent_listino_id', listini), 'master') : Promise.resolve(0),
    listini.length ? conta(admin.from('utenti').select('id', testa).in('listino_agente_id', listini), 'agenti') : Promise.resolve(0),
  ])
  return {
    zone: zoneIds.length, cap, fasceCosto, supplementiCosto,
    fasceVendita: vendita.length, supplementiVendita, listiniVendita: listini.length,
    clientiToccati, masterToccati, agentiToccati, chiaviApi, condivisioni, pontiAValle,
    webhooks, podPrezzi, corrieriCliente, articoli, autisti,
  }
}
