import { calcolaPrezzoListino, calcolaPesoFatturato, zonaDaProvincia } from '@/lib/pricing'
import { fetchAll } from '@/lib/fetch-all'

// COSA DEVE FARE UN MASTER PERCHE' LE RETTIFICHE RICEVUTE SCENDANO (Lorenzo, 12/11/2026: «sarebbe bene creare una
// soluzione dove ogni master veda a schermo cosa deve fare»).
//
// Il 12/11 alle 09:55 Ecomize Solution ha premuto «Carica» sul blocco di MULTIEXPRESS: 48 passate, e 3UW1UHA334029 no.
// Il pacco, dichiarato 3 kg 50×30×20, Poste l'ha misurato 8,9 kg 84×37,5×31,5 (19,85 kg di volume); il listino della
// cliente, Scifo Giuseppina Sandra, su Poste Express M zona Italia arrivava a 5 kg. Il motivo glielo avevamo scritto, ma
// in un messaggio in cima alla pagina che il «Carica» dopo sostituiva — e in quell'ora ne ha premuti per 849 righe.
// Il riquadro «clienti col listino da alzare» non lo segnalava: guardava la fascia piu' alta di TUTTE le zone, e quel
// listino in Venezia/Laguna arriva a 100 kg con la regola «oltre». E leggeva al massimo mille righe.
//
// Qui il motivo si trova PRIMA di premere «Carica» e resta a schermo finche' non e' sistemato. Il conto e' quello di
// «Carica» (calcolaPrezzoListino sul collo ripesato, nella zona vera della spedizione, con lo stesso ripiego su
// regione e «Italia» del motore): se qui una riga passa, passa anche li'.

export type CodiceDaSistemare =
  | 'listino_corto'     // il listino del cliente si ferma prima del peso ripesato
  | 'zona'              // il listino del cliente non prezza la destinazione
  | 'senza_listino'     // il cliente non ha un listino
  | 'accessori'         // il listino non prezza contrassegno/assicurazione su quel contratto
  | 'livello_sotto'     // il listino del sotto-master non copre il pacco (si sa solo dopo «Carica»)
  | 'misure'            // la rettifica non ha le misure del pacco
  | 'catena'            // catena dei listini incompleta
  | 'fuori_catena'      // chi riceve non e' nella catena della spedizione
  | 'spedizione'        // spedizione non trovata / non collegata / annullata
  | 'riprova'           // errore momentaneo

export type DaSistemare = {
  codice: CodiceDaSistemare
  testo: string                 // la frase completa: cosa non va e cosa fare
  breve: string                 // la stessa cosa in una riga, accanto alla rettifica
  chi?: string | null
  cliente_id?: string | null
  master_id?: string | null
  listino_id?: string | null
  contratto?: string | null
  zona?: string | null
  arriva_a?: number | null
  serve?: number | null
  quando?: string
}

const kg = (x: number) => (Math.round(x * 100) / 100).toLocaleString('it-IT')
// Il peso che serve si dice in chili interi verso l'alto: «serve almeno 20 kg», non «19,85».
const serveKg = (x: number) => Math.ceil(x - 1e-9)

/**
 * Per ogni rettifica ricevuta che scende a un MIO CLIENTE (la spedizione e' mia e ha un cliente), dice se il listino del
 * cliente sa prezzare il collo ripesato. Torna solo quelle che NON passerebbero, col motivo. Le righe che scendono a un
 * sotto-master non si guardano qui: il loro listino e' fatto di altro, e il motivo lo scrive «Carica» (da_sistemare).
 * `admin` va creato con createAdminSupabaseConMemoria: le fasce di un listino si leggono una volta sola.
 */
export async function controllaListiniClienti(
  admin: any, mio: string,
  righe: { id: string; spedizione_id: string | null; colli_ripesati?: any }[],
): Promise<Map<string, DaSistemare>> {
  const out = new Map<string, DaSistemare>()
  const conColli = righe.filter(r => r.spedizione_id && Array.isArray(r.colli_ripesati) && r.colli_ripesati.length)
  if (!conColli.length) return out

  const sped = new Map<string, any>()
  const idS = [...new Set(conColli.map(r => r.spedizione_id as string))]
  for (let i = 0; i < idS.length; i += 200) {
    const { data, error } = await admin.from('spedizioni')
      .select('id,master_id,cliente_id,corriere_id,dest_provincia,dest_cap,dest_citta,dest_paese,mitt_cap,mitt_provincia,colli_dettaglio,peso_reale')
      .in('id', idS.slice(i, i + 200))
    if (error) throw new Error('spedizioni: ' + error.message)
    for (const s of (data || []) as any[]) sped.set(s.id, s)
  }
  // Solo le spedizioni dei MIEI clienti: sotto di me c'e' un cliente, il suo listino decide.
  const mie = conColli.filter(r => { const s = sped.get(r.spedizione_id as string); return s && s.master_id === mio && s.cliente_id && s.corriere_id })
  if (!mie.length) return out

  const clienti = new Map<string, { nome: string; listino: string | null }>()
  const idC = [...new Set(mie.map(r => sped.get(r.spedizione_id as string).cliente_id as string))]
  for (let i = 0; i < idC.length; i += 200) {
    const { data } = await admin.from('clienti').select('id,ragione_sociale,listino_cliente_id').in('id', idC.slice(i, i + 200))
    for (const c of (data || []) as any[]) clienti.set(c.id, { nome: c.ragione_sociale || 'cliente', listino: c.listino_cliente_id || null })
  }
  const idCorr = [...new Set(mie.map(r => sped.get(r.spedizione_id as string).corriere_id as string))]
  const nomeContratto = new Map<string, string>()
  {
    const { data } = await admin.from('corrieri').select('id,nome_contratto').in('id', idCorr)
    for (const c of (data || []) as any[]) nomeContratto.set(c.id, c.nome_contratto || 'contratto')
  }
  const idL = [...new Set([...clienti.values()].map(c => c.listino).filter(Boolean))] as string[]

  // Divisore e «solo peso reale» del listino, e il divisore per contratto se c'e': come calcolaPrezzoListino.
  const listini = new Map<string, { fattore: number; solo: boolean }>()
  const fattoreCorr = new Map<string, number>()   // listino|corriere
  // Fasce per listino|corriere, zona per zona: la piu' alta e se c'e' la regola «oltre».
  const zoneDi = new Map<string, Map<string, { max: number; oltre: boolean }>>()
  for (let i = 0; i < idL.length; i += 20) {
    const fetta = idL.slice(i, i + 20)
    const [{ data: ll }, { data: lc }, ff] = await Promise.all([
      admin.from('listini_clienti').select('id,fattore_volume,solo_peso_reale').in('id', fetta),
      admin.from('listini_clienti_corrieri').select('listino_id,corriere_id,fattore_volume').in('listino_id', fetta).in('corriere_id', idCorr),
      fetchAll(() => admin.from('listini_clienti_fasce').select('id,listino_id,corriere_id,peso_max,tipo,zone(nome,su_mittente)')
        .in('listino_id', fetta).in('corriere_id', idCorr).order('id', { ascending: true })),
    ])
    for (const l of (ll || []) as any[]) listini.set(l.id, { fattore: parseFloat(l.fattore_volume) || 5000, solo: !!l.solo_peso_reale })
    for (const x of (lc || []) as any[]) { const fv = parseFloat(x.fattore_volume); if (fv > 0) fattoreCorr.set(x.listino_id + '|' + x.corriere_id, fv) }
    for (const f of (ff || []) as any[]) {
      const z = (f.zone as any)
      if (!z?.nome || z.su_mittente) continue
      const k = f.listino_id + '|' + f.corriere_id
      if (!zoneDi.has(k)) zoneDi.set(k, new Map())
      const m = zoneDi.get(k)!
      const cur = m.get(z.nome) || { max: 0, oltre: false }
      if (f.tipo === 'oltre') cur.oltre = true
      else cur.max = Math.max(cur.max, parseFloat(f.peso_max) || 0)
      m.set(z.nome, cur)
    }
  }

  // Quelle che la scorciatoia non scarta si riprezzano per intero, piu' d'una alla volta.
  const daRifare: (() => Promise<void>)[] = []
  for (const r of mie) {
    const s = sped.get(r.spedizione_id as string)
    const cl = clienti.get(s.cliente_id)!
    const contratto = nomeContratto.get(s.corriere_id) || 'contratto'
    const base = { chi: cl.nome, cliente_id: s.cliente_id, listino_id: cl.listino, contratto }
    if (!cl.listino) {
      out.set(r.id, { ...base, codice: 'senza_listino',
        testo: `${cl.nome} non ha un listino: assegnagliene uno dalla sua scheda, poi ripremi «Carica».`,
        breve: `${cl.nome} non ha un listino` })
      continue
    }
    const zone = zoneDi.get(cl.listino + '|' + s.corriere_id)
    const pk = (r.colli_ripesati as any[]).map((c: any) => ({ weight: Number(c.weight) || 0, length: Number(c.length) || 0, width: Number(c.width) || 0, height: Number(c.height) || 0 }))
    const lst = listini.get(cl.listino) || { fattore: 5000, solo: false }
    const fattore = fattoreCorr.get(cl.listino + '|' + s.corriere_id) || lst.fattore
    const peso = calcolaPesoFatturato(pk, fattore, lst.solo).pesoFatturato
    // SCORCIATOIA SICURA: se il peso sta sotto la fascia piu' alta di OGNI zona del contratto, qualunque sia la zona
    // della spedizione il listino lo prezza (l'agevolazione puo' solo abbassarlo). Solo le altre si rifanno per intero.
    if (zone && zone.size) {
      const minimo = Math.min(...[...zone.values()].map(z => (z.oltre ? Infinity : z.max)))
      if (peso <= minimo + 1e-9) continue
    }
    daRifare.push(async () => {
      const dest = {
        provincia: s.dest_provincia || '', cap: s.dest_cap || '', citta: s.dest_citta || '', paese: s.dest_paese || 'IT',
        mittCap: s.mitt_cap || '', mittProvincia: s.mitt_provincia || '', mittPaese: 'IT',
      }
      const prezza = (packages: any[], zonaForzata?: string) =>
        calcolaPrezzoListino(admin, { listinoId: cl.listino as string, corriereId: s.corriere_id, packages, ...dest, ...(zonaForzata ? { zonaForzata } : {}) })
      // Lo stesso ripiego del motore (lib/ripesature-calcolo): prima la zona del pacco, poi la regione, poi «Italia».
      let ris = await prezza(pk)
      const regionale = zonaDaProvincia(dest.provincia)
      if (!ris && regionale !== 'Italia' && String(dest.paese).toUpperCase().trim() === 'IT') ris = await prezza(pk, regionale)
      if (!ris) ris = await prezza(pk, 'Italia')
      if (ris) return

      // Non passa. In che zona e' la spedizione: quella in cui il cliente l'ha pagata, col collo dichiarato.
      const dichiarati = Array.isArray(s.colli_dettaglio) && s.colli_dettaglio.length
        ? s.colli_dettaglio.map((c: any) => ({ weight: Number(c.peso) || 0, length: Number(c.lunghezza) || 0, width: Number(c.larghezza) || 0, height: Number(c.altezza) || 0 }))
        : [{ weight: Number(s.peso_reale) || 1 }]
      const allora = await prezza(dichiarati)
      const zona = allora?.zona || null
      const zz = zona && zone ? (zone.get(zona) || [...zone.entries()].find(([n]) => n.toLowerCase() === zona.toLowerCase())?.[1]) : undefined
      if (!zz || zz.oltre || !(zz.max > 0) || peso <= zz.max + 1e-9) {
        // Il peso ci starebbe: e' la destinazione (o il contratto) che il listino non prezza piu'.
        out.set(r.id, { ...base, codice: 'zona', zona,
          testo: `Il listino di ${cl.nome} su ${contratto} non prezza piu' la destinazione di questa spedizione (CAP ${s.dest_cap || '—'}): controlla zone e contratto nel suo listino, poi ripremi «Carica».`,
          breve: `Listino di ${cl.nome}: destinazione non prezzata` })
        return
      }
      out.set(r.id, { ...base, codice: 'listino_corto', zona, arriva_a: zz.max, serve: Math.round(peso * 100) / 100,
        testo: `Alza il listino di ${cl.nome} su ${contratto}${zona ? ` (zona ${zona})` : ''}: oggi arriva a ${kg(zz.max)} kg, serve almeno ${serveKg(peso)} kg. Poi ripremi «Carica».`,
        breve: `Listino di ${cl.nome} fino a ${kg(zz.max)} kg: serve ${serveKg(peso)} kg` })
    })
  }
  // OTTO ALLA VOLTA: ogni riprezzo sono letture una dopo l'altra (zone, CAP, supplementi). In fila, i 1.235 da decidere
  // di Ecomize Solution il 12/11/2026 chiedevano 42 secondi.
  let prossimo = 0
  await Promise.all(Array.from({ length: Math.min(8, daRifare.length) }, async () => {
    while (prossimo < daRifare.length) await daRifare[prossimo++]()
  }))
  return out
}

/**
 * Il motivo, scritto per chi deve agire, di una riga che «Carica» non ha potuto girare. `perche` e' la frase del motore
 * (app/api/network/rettifiche); `chi` il cliente o sotto-master sotto. Le righe dei clienti col listino corto si
 * riscrivono poi con controllaListiniClienti, che sa anche fin dove arriva il listino.
 */
export function daSistemareDaMotivo(perche: string, extra: { chi?: string | null; cliente_id?: string | null; master_id?: string | null; serve?: number | null } = {}): DaSistemare {
  const p = perche.toLowerCase()
  const chi = extra.chi || null
  if (p.includes('misure ripesate')) return { codice: 'misure', ...extra, testo: 'Rettifiche senza le misure del pacco: non si possono riprezzare sul listino di chi sta sotto. Se non arrivano le misure, l\'unica strada è assorbirle.', breve: 'Senza le misure del pacco' }
  if (p.includes('catena dei listini incompleta')) return { codice: 'catena', ...extra, testo: 'La catena dei listini di queste spedizioni è incompleta: scrivi all\'assistenza, non le puoi sistemare tu.', breve: 'Catena dei listini incompleta' }
  if (p.includes('non sei nella catena')) return { codice: 'fuori_catena', ...extra, testo: 'Queste spedizioni non risultano della tua rete: scrivi all\'assistenza.', breve: 'Spedizione non della tua rete' }
  if (p.includes('contrassegno') || p.includes('assicurazione')) return { codice: 'accessori', ...extra, testo: `Il listino di ${chi || 'chi sta sotto'} non ha il prezzo del contrassegno o dell'assicurazione su questo contratto: aggiungilo, poi ripremi «Carica».`, breve: `Listino di ${chi || 'chi sta sotto'}: manca il prezzo di contrassegno/assicurazione` }
  if (p.includes('si ferma prima')) {
    const serve = extra.serve ? ` serve almeno ${serveKg(extra.serve)} kg` : ''
    return { codice: extra.master_id ? 'livello_sotto' : 'listino_corto', ...extra, testo: `Alza il listino di ${chi || 'chi sta sotto'}:${serve || ' il pacco ripesato supera la sua ultima fascia'}. Poi ripremi «Carica».`, breve: `Listino di ${chi || 'chi sta sotto'} troppo corto${serve ? ':' + serve : ''}` }
  }
  if (p.includes('livello sotto non ricostruito')) return { codice: 'livello_sotto', ...extra, testo: `Il listino di ${chi || 'chi sta sotto'} per questo contratto non si trova: controlla che glielo abbia assegnato, poi ripremi «Carica».`, breve: 'Listino del livello sotto mancante' }
  if (p.includes('spedizione') || p.includes('annullata')) return { codice: 'spedizione', ...extra, testo: `Spedizione non trovata o annullata (${perche}): scrivi all'assistenza.`, breve: 'Spedizione non trovata' }
  return { codice: 'riprova', ...extra, testo: `Non riuscita (${perche}): ripremi «Carica».`, breve: 'Non riuscita: riprova' }
}
