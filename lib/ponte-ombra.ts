import { createAdminSupabase } from '@/lib/supabase-admin'
import { conMemoRichiesta } from '@/lib/memo-richiesta'
import { valutaPonteUnico, movimentiDelDetentore, type ContestoPonte, type MovimentoAtteso } from '@/lib/ponte-unico'

// IL PONTE UNICO IN OMBRA (fase 2 di PONTE-UNICO.md).
// Per un condiviso gia' nato con la staffetta, si rifa' il lavoro di tutta la fila col ponte unico SENZA scrivere
// niente, e si confronta voce per voce con quello che la staffetta ha scritto davvero: quali gambe, a quale conto
// d'ingrosso, a che prezzo, e ogni movimento (importo, chi incassa, chi paga, su quale riga). Si passa alla
// transazione unica solo dopo giorni di traffico vero senza differenze.
//
// La richiesta di partenza non si conserva: si ricompone dalla riga d'origine (destinazione, mittente, colli,
// contrassegno, assicurazione, valore merce, accessori). Sui 400 passaggi veri della fase 1 la ricomposizione dava
// gli stessi prezzi in tutti; se un giorno non bastasse, la differenza si vede qui e non nei soldi.

type Admin = ReturnType<typeof createAdminSupabase>

// Le colonne della riga d'origine che servono. Mai etichetta_url (circa 270 KB di PDF per riga).
export const COLONNE_ORIGINE = 'id,numero,tracking_number,master_id,cliente_id,corriere_id,created_at,stato,'
  + 'dest_nome,dest_indirizzo,dest_presso,dest_citta,dest_provincia,dest_cap,dest_paese,dest_email,dest_telefono,'
  + 'mitt_nome,mitt_indirizzo,mitt_citta,mitt_provincia,mitt_cap,colli,peso_reale,lunghezza,larghezza,altezza,'
  + 'contrassegno,assicurazione,valore_merce,servizi_accessori,costo_spedizione'

export type Differenza = { cosa: string; livello?: number; atteso?: any; vero?: any }

export type EsitoOmbra = {
  tracking: string
  spedizione_origine_id: string
  contratto: string
  creata_il: string
  livelli: number
  esito: 'uguale' | 'diverso' | 'errore'
  differenze: Differenza[]
  ms_ombra: number | null
  ms_fila: number | null
  dettaglio: any
}

const cent = (x: any) => Math.round(Number(x || 0) * 100) / 100
const num = (x: any) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : undefined }

// I colli come li ha mandati chi ha creato: collo per collo se la riga d'origine ne ha il dettaglio, altrimenti
// colli uguali col peso diviso in parti uguali e le misure salvate sulla riga (quelle del primo collo).
async function colliDellOrigine(admin: Admin, o: any): Promise<any[]> {
  const n = Math.max(1, Number(o.colli) || 1)
  if (n > 1) {
    const { data } = await admin.from('spedizioni').select('colli_dettaglio').eq('id', o.id).maybeSingle()
    const d = Array.isArray((data as any)?.colli_dettaglio) ? (data as any).colli_dettaglio : null
    if (d && d.length === n) {
      return d.map((c: any) => ({ weight: Number(c.weight ?? c.peso) || 1, length: num(c.length ?? c.lunghezza), width: num(c.width ?? c.larghezza), height: num(c.height ?? c.altezza) }))
    }
  }
  const peso = Number(o.peso_reale) || 1
  return Array.from({ length: n }, () => ({ weight: Math.round(peso / n * 1000) / 1000, length: num(o.lunghezza), width: num(o.larghezza), height: num(o.altezza) }))
}

const chiaveMov = (m: { riga: number; owner: string; target: string | null; cliente: string | null; importo: number }) =>
  // Sui movimenti del cliente d'ingrosso il pagante e' il cliente: master_target_id non conta.
  `${m.riga}|${m.owner}|${m.cliente ? '' : (m.target || '')}|${m.cliente || ''}|${cent(m.importo).toFixed(2)}`

export async function confrontaInOmbra(admin: Admin, o: any, nomeContratto: string): Promise<EsitoOmbra> {
  const base = {
    tracking: String(o.tracking_number), spedizione_origine_id: String(o.id), contratto: nomeContratto,
    creata_il: String(o.created_at),
  }
  try {
    return await conMemoRichiesta(async () => {
      const packages = await colliDellOrigine(admin, o)
      const serviziAccessori = Array.isArray(o.servizi_accessori)
        ? o.servizi_accessori.map((a: any) => ({ nome: typeof a === 'string' ? a : a?.nome })) : []
      const contesto: ContestoPonte = {
        dest: { cap: String(o.dest_cap || ''), provincia: String(o.dest_provincia || ''), citta: String(o.dest_citta || ''), paese: String(o.dest_paese || 'IT') },
        packages, contrassegno: Number(o.contrassegno) || 0, assicurazione: Number(o.assicurazione) || 0, serviziAccessori,
        mittCap: String(o.mitt_cap || ''), mittProvincia: String(o.mitt_provincia || ''), mittPaese: 'IT',
      }
      // La richiesta al primo venditore, come la compone la creazione: i campi che contano per controlli e prezzo.
      const body = {
        shipTo: { name: o.dest_nome, street1: o.dest_indirizzo, presso: o.dest_presso || undefined, city: o.dest_citta, state: o.dest_provincia, postalCode: o.dest_cap, country: o.dest_paese || 'IT', email: o.dest_email || undefined, phone: o.dest_telefono || undefined },
        shipFrom: { name: o.mitt_nome, street1: o.mitt_indirizzo, city: o.mitt_citta, state: o.mitt_provincia, postalCode: o.mitt_cap },
        packages, codValue: num(o.contrassegno), insuranceValue: num(o.assicurazione), valoreMerce: num(o.valore_merce),
      }

      // Quello che la staffetta ha scritto: tutte le righe col tracking, e i loro addebiti.
      const [vp, { data: righeVere, error: eRighe }] = await Promise.all([
        valutaPonteUnico(admin, { masterOrigine: o.master_id, nomeContratto, corriereOrigine: o.corriere_id, body, contesto }),
        admin.from('spedizioni').select('id,numero,cliente_id,corriere_id,master_id,costo_totale,costo_spedizione,stato')
          .eq('tracking_number', o.tracking_number),
      ])
      if (eRighe) throw new Error('righe: ' + eRighe.message)
      const gambe = (righeVere || []).filter((r: any) => r.id !== o.id)
      const differenze: Differenza[] = []
      if (vp.errore) differenze.push({ cosa: 'ombra non conclusa', vero: vp.errore })

      // Le gambe: una per livello, presso il venditore giusto, al conto d'ingrosso giusto, al prezzo giusto.
      const rigaDi: string[] = [o.id]
      const usate = new Set<string>()
      vp.livelli.forEach((l, i) => {
        const r: any = gambe.find((g: any) => !usate.has(g.id) && g.cliente_id === l.clienteId && g.corriere_id === l.corriereId)
        if (!r) { differenze.push({ cosa: 'gamba mancante', livello: i + 1, atteso: { cliente: l.clienteId, corriere: l.corriereId } }); rigaDi.push(''); return }
        usate.add(r.id); rigaDi.push(r.id)
        if (r.master_id !== l.venditoreId) differenze.push({ cosa: 'venditore', livello: i + 1, atteso: l.venditoreId, vero: r.master_id })
        if (!l.ok) { differenze.push({ cosa: 'livello rifiutato in ombra', livello: i + 1, atteso: `${l.stato} ${l.errore}` }); return }
        if (cent(r.costo_totale) !== l.costoCliente) differenze.push({ cosa: 'prezzo al livello', livello: i + 1, atteso: l.costoCliente, vero: cent(r.costo_totale) })
      })
      for (const g of gambe) if (!usate.has((g as any).id)) differenze.push({ cosa: 'gamba in piu', vero: { cliente: (g as any).cliente_id, corriere: (g as any).corriere_id, numero: (g as any).numero } })

      // Il costo di ogni riga e' il prezzo del livello sopra: l'origine paga il primo venditore, e cosi' via.
      const okL = vp.livelli.map(l => (l.ok ? l.costoCliente : null))
      if (okL[0] != null && cent(o.costo_spedizione) !== okL[0]) differenze.push({ cosa: 'costo della riga', livello: 0, atteso: okL[0], vero: cent(o.costo_spedizione) })
      for (let i = 1; i < vp.livelli.length; i++) {
        const r: any = gambe.find((g: any) => g.id === rigaDi[i])
        if (r && okL[i] != null && cent(r.costo_spedizione) !== okL[i]) differenze.push({ cosa: 'costo della riga', livello: i, atteso: okL[i], vero: cent(r.costo_spedizione) })
      }

      // Il conto del detentore, col costo del corriere che la staffetta ha registrato sulla sua gamba.
      const ultimaRiga: any = gambe.find((g: any) => g.id === rigaDi[vp.livelli.length])
      let attesi: MovimentoAtteso[] = vp.movimenti
      if (vp.fila.length && ultimaRiga) {
        const det = await movimentiDelDetentore(admin, vp.fila[vp.fila.length - 1], contesto, Number(ultimaRiga.costo_spedizione) || 0, vp.livelli.length)
        if (det.errore) differenze.push({ cosa: 'catena del detentore', vero: det.errore })
        attesi = [...attesi, ...det.movimenti]
      }

      // I movimenti veri sulle righe della fila: gli addebiti di spedizione, tranne quello del cliente d'origine
      // (lo decide la creazione, non il ponte). Sulle spedizioni che il master fa per se' il cliente non c'e':
      // allora non si toglie niente (i movimenti fra master hanno anch'essi cliente_id vuoto).
      const ids = rigaDi.filter(Boolean)
      const { data: mov, error: eMov } = await admin.from('movimenti')
        .select('spedizione_id,master_id,master_target_id,cliente_id,importo,conto,tipo')
        .in('spedizione_id', ids).eq('tipo', 'spedizione').lt('importo', 0)
      if (eMov) throw new Error('movimenti: ' + eMov.message)
      const veri = (mov || [])
        .filter((m: any) => !(o.cliente_id && m.spedizione_id === o.id && m.cliente_id === o.cliente_id))
        .map((m: any) => ({ riga: rigaDi.indexOf(m.spedizione_id), owner: m.master_id, target: m.master_target_id, cliente: m.cliente_id, importo: Number(m.importo), conto: m.conto }))
      const restanti = new Map<string, number>()
      for (const m of veri) { const k = chiaveMov(m); restanti.set(k, (restanti.get(k) || 0) + 1) }
      for (const a of attesi) {
        const k = chiaveMov(a), n = restanti.get(k) || 0
        if (n > 0) restanti.set(k, n - 1)
        else differenze.push({ cosa: 'movimento mancante', livello: a.riga, atteso: { perche: a.perche, owner: a.owner, target: a.target, cliente: a.cliente, importo: a.importo } })
      }
      for (const m of veri) {
        const k = chiaveMov(m), n = restanti.get(k) || 0
        if (n > 0) { restanti.set(k, n - 1); differenze.push({ cosa: 'movimento in piu', livello: m.riga, vero: { owner: m.owner, target: m.target, cliente: m.cliente, importo: cent(m.importo), conto: m.conto } }) }
      }

      return {
        ...base,
        livelli: vp.fila.length,
        esito: differenze.length ? 'diverso' : 'uguale',
        differenze,
        ms_ombra: vp.ms.tutto, ms_fila: vp.ms.fila,
        // Solo identificativi e importi: nessun dato di chi spedisce o riceve.
        dettaglio: {
          fila: vp.livelli.map(l => ({ venditore: l.venditoreId, cliente: l.clienteId, corriere: l.corriereId, tipo: l.tipo, prezzo: l.ok ? l.costoCliente : null })),
          movimenti: { attesi: attesi.length, veri: veri.length }, strada: vp.strada,
          colli: packages.length, contrassegno: contesto.contrassegno > 0,
        },
      } satisfies EsitoOmbra
    })
  } catch (e: any) {
    return { ...base, livelli: 0, esito: 'errore', differenze: [{ cosa: 'eccezione', vero: String(e?.message || e).slice(0, 300) }], ms_ombra: null, ms_fila: null, dettaglio: null }
  }
}
