import { calcolaPrezzoListino } from '@/lib/pricing'
import { costruisciCatena } from '@/lib/cascata'
import type { Ripesatura } from '@/lib/ripesature'

// COSA DEVE PAGARE OGNUNO, DOPO CHE IL FORNITORE HA RIMISURATO IL COLLO.
//
// L'importo del file NON scende lungo la catena. Quello e' il costo del DETENTORE del contratto:
// se al detentore la ripesatura costa 1 euro, al cliente finale puo' costarne 2,70, perche' ogni
// livello ha il suo listino e le sue fasce. Quindi non si passa una cifra, si RIPREZZA il collo
// vero a ogni livello.
//
// SI RIPREZZA CON LE MISURE, NON COL SOLO PESO. Il supplemento lo fa il VOLUME: verificato
// chiedendo al fornitore due preventivi sulla stessa spedizione, 106 casi su 106 al centesimo, e su
// 45 di quei 106 il pacco pesava MENO di quanto avevamo fatturato e pagava lo stesso, perche'
// misurava di piu'. Il caricamento rettifiche esistente passa il solo peso — c'e' scritto
// "senza misure: nessun volumetrico" — e con quello la meta' delle righe verrebbe fuori NEGATIVA.
//
// IL "PRIMA" E' QUELLO PAGATO ALLORA, non un prezzo rifatto oggi. Le tariffe si muovono: su una
// spedizione del 1 agosto il preventivo rifatto il giorno 6 dava 4,81, ma allora era stata pagata
// 5,97, e solo col valore storico la differenza tornava esatta. Quindi il confronto e'
// "prezzo nuovo col collo vero" meno "quello che risulta addebitato nei movimenti".

export type LivelloRettifica = {
  chi: string                  // nome del master, o ragione sociale del cliente
  clienteId: string | null
  masterId: string | null
  pagato: number               // quanto risulta addebitato nei movimenti
  dovuto: number | null        // quanto sarebbe col collo ripesato (null = non calcolabile)
  differenza: number | null
}

export type EsitoRipesatura = {
  ldv: string
  idOrdine: string
  trovata: boolean
  motivo?: string
  spedizioneId?: string
  destinatario: string
  colli: number
  pesoPrima: number
  pesoDopo: number
  misure: string
  addebitoFornitore: number
  livelli: LivelloRettifica[]
  // I master della catena, dal piu' basso al detentore del contratto. Serve a capire a chi va
  // indirizzata la rettifica: al FIGLIO DIRETTO di chi la sta caricando, non al fondo della catena.
  catenaDalBasso?: string[]
}

const arrotonda = (n: number) => Math.round(n * 100) / 100

export async function calcolaRipesature(admin: any, righe: Ripesatura[]): Promise<EsitoRipesatura[]> {
  const out: EsitoRipesatura[] = []

  for (const r of righe) {
    const base: EsitoRipesatura = {
      ldv: r.ldv, idOrdine: r.idOrdine, trovata: false, destinatario: r.destinatario,
      colli: r.colli.length,
      pesoPrima: 0,
      pesoDopo: arrotonda(r.colli.reduce((s, c) => s + c.peso, 0)),
      misure: r.colli.map(c => `${c.lunghezza}x${c.larghezza}x${c.altezza}`).join(' + '),
      addebitoFornitore: r.addebitoFornitore,
      livelli: [],
    }

    const { data: s } = await admin.from('spedizioni')
      .select('id,cliente_id,master_id,corriere_id,stato,peso_fatturato,dest_provincia,dest_cap,dest_citta,dest_paese,contrassegno,assicurazione')
      .eq('tracking_number', r.ldv).maybeSingle()
    if (!s) { out.push({ ...base, motivo: 'spedizione non trovata' }); continue }
    if (s.stato === 'annullata') { out.push({ ...base, spedizioneId: s.id, motivo: 'spedizione annullata' }); continue }

    base.trovata = true
    base.spedizioneId = s.id
    base.pesoPrima = Number(s.peso_fatturato || 0)

    // Il collo come lo ha misurato il fornitore, nella forma che vuole il motore dei prezzi.
    const packages = r.colli.map(c => ({
      weight: c.peso, length: c.lunghezza, width: c.larghezza, height: c.altezza,
    }))
    const dest = {
      provincia: s.dest_provincia || '', cap: s.dest_cap || '',
      citta: s.dest_citta || '', paese: s.dest_paese || 'IT',
    }

    // Quanto risulta addebitato: dai MOVIMENTI, che sono l'unico posto dove c'e' scritto davvero.
    const { data: mov } = await admin.from('movimenti')
      .select('importo,cliente_id,master_id').eq('spedizione_id', s.id).eq('tipo', 'spedizione')
    const pagatoCliente = (mov || []).filter((m: any) => m.cliente_id)
      .reduce((a: number, m: any) => a + Math.abs(Number(m.importo || 0)), 0)
    const pagatoMaster = new Map<string, number>()
    for (const m of (mov || [])) {
      if (m.cliente_id || !m.master_id) continue
      pagatoMaster.set(m.master_id, (pagatoMaster.get(m.master_id) || 0) + Math.abs(Number(m.importo || 0)))
    }

    const { data: corr } = await admin.from('corrieri')
      .select('id,nome_contratto,master_id').eq('id', s.corriere_id).maybeSingle()

    // ── IL CLIENTE ──
    if (s.cliente_id) {
      const { data: cl } = await admin.from('clienti')
        .select('ragione_sociale,listino_cliente_id').eq('id', s.cliente_id).maybeSingle()
      let dovuto: number | null = null
      if (cl?.listino_cliente_id) {
        const ris = await calcolaPrezzoListino(admin, {
          listinoId: cl.listino_cliente_id, corriereId: s.corriere_id, packages, ...dest,
        })
        dovuto = ris ? arrotonda(ris.prezzo) : null
      }
      base.livelli.push({
        chi: cl?.ragione_sociale || 'cliente', clienteId: s.cliente_id, masterId: null,
        pagato: arrotonda(pagatoCliente), dovuto,
        differenza: dovuto == null ? null : arrotonda(dovuto - pagatoCliente),
      })
    }

    // ── I MASTER DELLA CATENA ──
    // Stessa funzione che ha fatto l'addebito, con il collo ripesato al posto di quello dichiarato.
    if (corr) {
      const { catena, errore } = await costruisciCatena(admin, {
        masterDirettoId: s.master_id, corriereOwnerId: corr.master_id,
        costoSpedizione: 0, provincia: dest.provincia, packages,
        cap: dest.cap, citta: dest.citta, paese: dest.paese,
        corriereNome: corr.nome_contratto,
        contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0),
      })
      if (errore) base.motivo = errore
      // L'ordine della catena e' dal master della spedizione IN SU, fino al detentore. Serve per
      // sapere chi e' il figlio DIRETTO di chi carica: e' a lui che va indirizzata la rettifica.
      base.catenaDalBasso = catena.map(l => l.masterId)
      for (const liv of catena) {
        const pagato = arrotonda(pagatoMaster.get(liv.masterId) || 0)
        // Il detentore del contratto paga il costo reale del fornitore, non un listino: per lui la
        // differenza e' quella che ci ha addebitato il fornitore, che sta nel file.
        const dovuto = liv.isProprietario ? arrotonda(pagato + r.addebitoFornitore) : arrotonda(liv.prezzo)
        base.livelli.push({
          chi: liv.nome, clienteId: null, masterId: liv.masterId,
          pagato, dovuto, differenza: arrotonda(dovuto - pagato),
        })
      }
    }

    out.push(base)
  }

  return out
}
