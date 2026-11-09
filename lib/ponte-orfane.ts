// LA SENTINELLA DELLE GAMBE ORFANE DEL PONTE DI CONDIVISIONE.
//
// Una spedizione su un contratto condiviso e' fatta di righe, una per livello: quella del cliente che spedisce
// e, sotto, le gambe dei conti d'ingrosso (clienti.ledger), che ogni venditore addebita al master che gli
// compra. Se la creazione si interrompe a meta' strada, dal venditore la LDV nasce e le gambe vengono
// addebitate, ma la riga del cliente no: il cliente riprova, gli torna il credito, e le gambe restano pagate
// per una spedizione che nessuno spedira'. Dal 2 al 9/11/2026 e' successo 19 volte su SDA EXPRESS L: 28 gambe,
// 110,50 € pagati da Wave a LOGIXIA e 56,20 € da MULTI a Wave. Le ha annullate a mano la sessione LISTA
// MOVIMENTI. Il ponte ora prova a non lasciarne (lib/moovexpress), e questa sentinella chiude quelle che
// restano.
//
// Regola di Lorenzo (9/11/2026): si annullano da sole, con lo stesso giro dell'eliminazione di quel contratto,
// su tutte le gambe e con lo storno a ogni livello.
// - SDA EXPRESS L (LDV su Poste diretto): annullo solo sul portale, poi i 30 giorni di sorveglianza
//   (lib/annullo-poste). Se il pacco si muove, si riaddebita.
// - GLS diretto: DeleteSped su GLS, poi tutte le gambe (lib/annullo-gls). Se la distinta e' gia' trasmessa,
//   no.
// - Gli altri contratti (Spedisci, SpediamoPro, interno) non hanno un annullo automatico sui pacchi condivisi:
//   si segnalano soltanto. Al 9/11 nessuna orfana in 7 giorni su questi contratti.
//
// "Orfana" = TUTTE le righe con quel tracking sono gambe d'ingrosso, e la piu' giovane ha piu' di 20 minuti.
// Una creazione dura al massimo due minuti, quindi nessuna creazione in corso viene toccata. Se in un giro ne
// trova troppe non tocca niente: e' piu' probabile un guasto nella lettura che venti creazioni interrotte.

import { annullaPaccoPoste, paccoPartito } from '@/lib/annullo-poste'
import { annullaPaccoGls } from '@/lib/annullo-gls'
import { risolviGambeSpedizione } from '@/lib/condivisione-catena'
import { doppioneSenzaTesta } from '@/lib/guardia-doppione'

const ETA_MINIMA_MS = 20 * 60_000
const FINESTRA_ORE = 3
const MASSIMO_PER_GIRO = 20
const STATI_FUORI = ['annullata', 'annullamento_pending', 'annullamento_manuale']

export type EsitoOrfana = {
  tracking: string
  gambe: string[]           // i numeri delle gambe ("282343J061431-1d6ac50d", …)
  contratto: 'poste' | 'gls' | string
  esito: 'annullata' | 'partita' | 'da_gestire' | 'simulata' | 'errore'
  motivo?: string
}

export async function sentinellaOrfanePonte(
  admin: any, opz: { simula?: boolean; finestraOre?: number } = {},
): Promise<{ esaminate: number; orfane: EsitoOrfana[]; fermata?: string }> {
  const ora = Date.now()
  const da = new Date(ora - (opz.finestraOre ?? FINESTRA_ORE) * 3_600_000).toISOString()
  const a = new Date(ora - ETA_MINIMA_MS).toISOString()

  const { data: led, error: eL } = await admin.from('clienti').select('id').eq('ledger', true).limit(1000)
  if (eL) throw new Error('conti d\'ingrosso non leggibili: ' + eL.message)
  const ledger = new Set<string>((led || []).map((c: any) => c.id))
  if (!ledger.size) return { esaminate: 0, orfane: [] }

  // Le gambe d'ingrosso nella finestra: per cliente e data (idx_spedizioni_cliente_created), a pagine
  // ordinate (senza ordine le pagine si sovrappongono).
  const tracking = new Set<string>()
  for (let off = 0; ; off += 1000) {
    const { data, error } = await admin.from('spedizioni').select('id,tracking_number,stato')
      .in('cliente_id', [...ledger]).gte('created_at', da).lt('created_at', a)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(off, off + 999)
    if (error) throw new Error('gambe non leggibili: ' + error.message)
    for (const s of (data || [])) if (s.tracking_number && !STATI_FUORI.includes(s.stato)) tracking.add(s.tracking_number)
    if (!data || data.length < 1000) break
  }

  // Per ogni pacco tutte le sue righe (tracking_number e' indicizzato): orfano se sono tutte d'ingrosso.
  const elenco = [...tracking]
  const orfani: string[] = []
  for (let i = 0; i < elenco.length; i += 150) {
    const { data, error } = await admin.from('spedizioni').select('tracking_number,cliente_id,stato,created_at')
      .in('tracking_number', elenco.slice(i, i + 150))
    if (error) throw new Error('pacchi non leggibili: ' + error.message)
    const per = new Map<string, any[]>()
    for (const r of (data || [])) { const k = r.tracking_number; if (!per.has(k)) per.set(k, []); per.get(k)!.push(r) }
    for (const [k, righe] of per) {
      const tutteIngrosso = righe.every(r => r.cliente_id && ledger.has(r.cliente_id))
      const piuGiovane = Math.max(...righe.map(r => new Date(r.created_at).getTime()))
      const attive = righe.some(r => !STATI_FUORI.includes(r.stato))
      if (tutteIngrosso && attive && ora - piuGiovane >= ETA_MINIMA_MS) orfani.push(k)
    }
  }

  if (orfani.length > MASSIMO_PER_GIRO) {
    const fermata = `${orfani.length} pacchi senza la spedizione del cliente in un giro solo (massimo ${MASSIMO_PER_GIRO}): non annullo niente, va guardato a mano.`
    console.error('[PONTE][ORFANE]', fermata, orfani.slice(0, 50))
    return { esaminate: elenco.length, orfane: [], fermata }
  }

  const esiti: EsitoOrfana[] = []
  for (const trk of orfani) {
    try {
      // Si riguarda subito prima di toccarlo: e' lo stesso controllo della guardia doppione.
      if (!await doppioneSenzaTesta(admin, trk)) continue
      const gambe = await risolviGambeSpedizione(admin, trk)
      if (!gambe.length) continue
      const numeri = gambe.map(g => g.numero)
      const contratto = gambe.some(g => g.tipo === 'poste') ? 'poste' : gambe.some(g => g.tipo === 'gls') ? 'gls' : (gambe[gambe.length - 1]?.tipo || '?')

      if (contratto === 'poste') {
        const p = await paccoPartito(admin, gambe)
        if (p.partito) { esiti.push({ tracking: trk, gambe: numeri, contratto, esito: 'partita', motivo: 'il pacco risulta affidato al corriere' }); continue }
        if (opz.simula) { esiti.push({ tracking: trk, gambe: numeri, contratto, esito: 'simulata' }); continue }
        await annullaPaccoPoste(admin, gambe, { richiestoAt: new Date().toISOString(), da: null })
        esiti.push({ tracking: trk, gambe: numeri, contratto, esito: 'annullata' })
      } else if (contratto === 'gls') {
        if (opz.simula) { esiti.push({ tracking: trk, gambe: numeri, contratto, esito: 'simulata' }); continue }
        const r = await annullaPaccoGls(admin, gambe, { da: null })
        esiti.push(r.ok
          ? { tracking: trk, gambe: numeri, contratto, esito: 'annullata' }
          : { tracking: trk, gambe: numeri, contratto, esito: 'da_gestire', motivo: r.motivo })
      } else {
        esiti.push({ tracking: trk, gambe: numeri, contratto, esito: 'da_gestire', motivo: `contratto ${contratto}: nessun annullo automatico sui pacchi condivisi` })
      }
    } catch (e: any) {
      esiti.push({ tracking: trk, gambe: [], contratto: '?', esito: 'errore', motivo: e?.message || String(e) })
    }
  }

  for (const e of esiti) {
    const riga = `[PONTE][ORFANE] ${e.tracking} (${e.contratto}) ${e.esito}${e.motivo ? ': ' + e.motivo : ''} — gambe ${e.gambe.join(', ')}`
    if (e.esito === 'annullata' || e.esito === 'simulata') console.warn(riga)
    else console.error(riga)
  }
  return { esaminate: elenco.length, orfane: esiti }
}
