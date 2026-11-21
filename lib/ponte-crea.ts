import { after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autenticaChiave, rispostaBlocco } from '@/lib/api-auth'
import { valutaLivelloV1 } from '@/lib/v1-livello'
import { ldvPosteV1 } from '@/lib/v1-poste'
import { filaDelPonte } from '@/lib/ponte-unico'
import {
  richiesteDellaFila, pianoDellaFila, prenotazioniDellaFila, vaPrenotato, completaPiano,
  SEGNO_LDV, type LivelloDaScrivere, type OpPonte,
} from '@/lib/ponte-scrittura'
import { erroreCorrierePulito, MSG_PONTE_NON_CONCLUSO } from '@/lib/errore-corriere'
import { MINIMO_CREAZIONE_MS } from '@/lib/moovexpress'

// IL PONTE UNICO DAL VIVO (fase 3 di PONTE-UNICO.md, acceso per contratto nella fase 4).
//
// Al posto della staffetta (la creazione chiama /api/v1/shipments del primo venditore, che chiama quella del
// secondo...), tutto in questo processo:
//   1. la fila dei venditori e la richiesta che ognuno riceverebbe;
//   2. per ogni livello, INSIEME: la chiave del ponte (autenticaChiave: ultimo uso, pacchetto, freno, come la
//      staffetta) e i controlli col prezzo (valutaLivelloV1, guardia doppioni compresa);
//   3. il piano di tutte le scritture, col numero in sospeso, e la riga del cliente dalla creazione;
//   4. ponte_prenota: registro "in corso" e credito di ogni conto d'ingrosso, tutto o niente;
//   5. la LDV dal corriere vero (ldvPosteV1, lo stesso ramo della staffetta), annotata subito (ponte_ldv);
//   6. ponte_scrivi: righe e movimenti in una transazione. Se non riesce dopo qualche tentativo, il giro di
//      recupero (/api/cron/ponte-recupero) la scrive dal registro: il credito e' gia' prenotato.
//
// Un rifiuto (controlli, chiave, credito, corriere) arriva a chi crea con lo stesso messaggio della staffetta:
// quello del livello che rifiuta, ripulito da ogni livello sopra come farebbe la catena di richieste.
// Tutto cio' che il ponte unico non sa riprodurre esce PRIMA di prenotare e di comprare con 'ripiego': si fa con
// la staffetta, come oggi. Dopo la LDV non c'e' ripiego possibile: si scrive, o si lascia al recupero.

type Admin = ReturnType<typeof createAdminSupabase>

// Acceso per contratto (PONTE_UNICO_CONTRATTI, nomi separati da virgola) e, se indicato, solo per i master
// d'origine elencati (PONTE_UNICO_MASTER): la fase 4 parte da un contratto di una rete sola.
export function ponteUnicoAcceso(nomeContratto: string, masterOrigine: string): boolean {
  const contratti = String(process.env.PONTE_UNICO_CONTRATTI || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!contratti.includes(String(nomeContratto || '').trim().toLowerCase())) return false
  const master = String(process.env.PONTE_UNICO_MASTER || '').split(',').map(s => s.trim()).filter(Boolean)
  return !master.length || master.includes(masterOrigine)
}

// Il messaggio che arriva a chi crea quando rifiuta il livello `k` (0 = il primo venditore): ogni livello sopra lo
// ripulisce con erroreCorrierePulito quando lo riceve dal suo venditore, e la creazione lo ripulisce un'ultima volta.
function messaggioDalLivello(k: number, messaggio: string): string {
  let m = messaggio
  for (let i = 0; i <= k; i++) m = erroreCorrierePulito(m)
  return m
}

// La riga del cliente e i suoi addebiti, dalla creazione. Gli addebiti non dipendono dalla risposta del primo
// venditore (il numero e' in sospeso): si calcolano insieme al piano della fila. La riga si compone dopo.
export type OrigineDelPonte = {
  addebiti: (p: { idOrigine: string; numero: string }) => Promise<{ ops: OpPonte[]; nonAddebitati: string[] }>
  riga: (p: {
    idOrigine: string
    risposta: { id: string; tracking: string; prezzo: number; label_url: string; ritiro?: any; codMode?: string }
    etichettaUrl: string | null
  }) => Record<string, any>
}

export type EsitoPonte =
  | { tipo: 'fatta'; numero: string; spedizioneId: string; costoCorrente: number; ms: Record<string, number> }
  | { tipo: 'rifiuto'; messaggio: string }
  | { tipo: 'in_ritardo'; numero: string; spedizioneId: string }
  | { tipo: 'ripiego'; motivo: string }

type ParametriPonte = {
  masterOrigine: string; corriereOrigine: string; nomeContratto: string
  dati: any                       // la richiesta che la creazione manderebbe al primo venditore
  scadenza: number                // fino a quando la creazione puo' lavorare
  origine: OrigineDelPonte        // la riga del cliente e i suoi addebiti, dalla creazione
  // Solo per la prova in locale: una LDV finta al posto del corriere, e niente email ne' webhook (la creazione non
  // lo passa mai).
  compraLdv?: typeof ldvPosteV1
}

// Fin dove e' arrivato: decide cosa fare di un errore imprevisto.
type Fase = { punto: 'prima' | 'prenotata' | 'ldv'; idOrigine?: string; numero?: string }

// Un errore imprevisto non deve mai diventare un rifiuto per chi crea ne' lasciare credito appeso. Prima della
// prenotazione si torna alla staffetta; dopo, si storna la fila e si torna alla staffetta (niente e' comprato); dopo
// la LDV la spedizione c'e' e la scrive il recupero.
export async function creaConPonteUnico(admin: Admin, p: ParametriPonte): Promise<EsitoPonte> {
  const fase: Fase = { punto: 'prima' }
  try {
    return await creaConPonteUnicoDentro(admin, p, fase)
  } catch (e: any) {
    const motivo = String(e?.message || e).slice(0, 300)
    console.error('[PONTE][IMPREVISTO]', fase.punto, motivo)
    if (fase.punto === 'ldv' && fase.idOrigine && fase.numero) return { tipo: 'in_ritardo', numero: fase.numero, spedizioneId: fase.idOrigine }
    if (fase.punto === 'prenotata' && fase.idOrigine) {
      const { error } = await admin.rpc('ponte_storna', { p_id: fase.idOrigine, p_errore: 'imprevisto: ' + motivo })
      if (error) console.error('[PONTE][STORNO]', fase.idOrigine, error.message)
    }
    return { tipo: 'ripiego', motivo: 'imprevisto: ' + motivo }
  }
}

async function creaConPonteUnicoDentro(admin: Admin, p: ParametriPonte, fase: Fase): Promise<EsitoPonte> {
  const t0 = Date.now()
  const ms: Record<string, number> = {}
  const segna = (k: string) => { ms[k] = Date.now() - t0 }

  // 1. La fila e le richieste.
  const { fila, errore } = await filaDelPonte(admin, p.masterOrigine, p.nomeContratto, p.corriereOrigine)
  if (errore || !fila.length) return { tipo: 'ripiego', motivo: 'fila: ' + (errore || 'vuota') }
  const corpi = richiesteDellaFila(p.dati, fila.length)
  segna('fila')

  // 2. Chiave e controlli di ogni livello, tutti insieme. La guardia doppioni di ogni livello segna l'ordine "in
  // creazione": se poi si ripiega sulla staffetta va liberato subito, o lei lo troverebbe occupato.
  const libere: Array<() => Promise<void>> = []
  const ripiega = async (motivo: string): Promise<EsitoPonte> => {
    await Promise.all(libere.map(l => l().catch(() => {})))
    return { tipo: 'ripiego', motivo }
  }
  // La chiave e i controlli partono insieme (i controlli usano cliente e contratto della fila, gia' verificati), ma
  // il rifiuto della chiave vince, come nella staffetta dove la chiave si controlla per prima.
  const livelliValutati = await Promise.all(fila.map(async (l, k) => {
    const [ctx, v] = await Promise.all([
      autenticaChiave(l.chiave),
      valutaLivelloV1(admin, { clienteId: l.clienteId, corriereId: l.corriereId }, corpi[k], { libere }),
    ])
    if (!ctx) return { k, rifiuto: { stato: 401, errore: 'API key non valida o mancante' } }
    const blocco = rispostaBlocco(ctx)
    if (blocco) { const j: any = await blocco.json().catch(() => ({})); return { k, rifiuto: { stato: blocco.status, errore: String(j?.error || '') } } }
    if (ctx.clienteId !== l.clienteId || ctx.corriereId !== l.corriereId) return { k, diversa: true }
    if (v instanceof Response) { const j: any = await v.json().catch(() => ({})); return { k, rifiuto: { stato: v.status, errore: String(j?.error || '') } } }
    return { k, v }
  }))
  segna('controlli')
  for (const r of livelliValutati) {
    if ('diversa' in r) return ripiega(`livello ${r.k + 1}: la chiave non porta dove dice la fila`)
    if ('rifiuto' in r && r.rifiuto) {
      // Un 5xx la staffetta non lo legge come rifiuto: meglio farlo fare a lei, come oggi (non e' prenotato niente).
      if (r.rifiuto.stato >= 500) return ripiega(`livello ${r.k + 1}: ${r.rifiuto.stato}`)
      return { tipo: 'rifiuto', messaggio: messaggioDalLivello(r.k, r.rifiuto.errore || `Errore dal fornitore (${r.rifiuto.stato})`) }
    }
  }
  const nuovoId = () => crypto.randomUUID()
  const livelli: LivelloDaScrivere[] = livelliValutati.map((r: any) => ({
    l: fila[r.k], body: corpi[r.k], v: r.v, id: nuovoId(), prenotazione: vaPrenotato(r.v) ? `PRE:${nuovoId()}` : null,
  }))

  // 3. Il piano, col numero in sospeso, e la riga del cliente.
  let piano: Awaited<ReturnType<typeof pianoDellaFila>>
  let origine: Awaited<ReturnType<OrigineDelPonte['addebiti']>> & { riga: Record<string, any> }
  const idOrigine = nuovoId()
  try {
    const [pf, add] = await Promise.all([pianoDellaFila(admin, livelli), p.origine.addebiti({ idOrigine, numero: SEGNO_LDV })])
    piano = pf
    origine = { ...add, riga: p.origine.riga({ idOrigine, risposta: piano.risposta, etichettaUrl: piano.etichettaPerOrigine }) }
  } catch (e: any) {
    return ripiega('piano: ' + String(e?.message || e))
  }
  const modello = {
    id: idOrigine,
    ops: [...piano.ops, { op: 'spedizione', riga: JSON.parse(JSON.stringify({ id: idOrigine, ...origine.riga })) }, ...origine.ops] as OpPonte[],
  }
  segna('piano')

  // 4. Registro e credito della fila, tutto o niente.
  const prenotazioni = prenotazioniDellaFila(livelli)
  {
    const { error } = await admin.rpc('ponte_prenota', {
      p_id: idOrigine, p_contratto: p.nomeContratto, p_master_id: p.masterOrigine, p_piano: modello, p_prenota: prenotazioni,
    })
    if (error) {
      const m = /CREDITO_INSUFFICIENTE:(\d+)/.exec(String(error.message || ''))
      if (!m) return ripiega('prenotazione: ' + error.message)
      const k = Number(m[1]) - 1
      const L = livelli[k]
      const { data: cAgg } = await admin.from('clienti').select('credito').eq('id', L.l.clienteId).maybeSingle()
      return { tipo: 'rifiuto', messaggio: messaggioDalLivello(k, `Credito insufficiente: disponibili € ${Number((cAgg as any)?.credito || 0).toFixed(2)}, spedizione € ${L.v.costoCliente.toFixed(2)}`) }
    }
  }
  segna('prenotazione')
  fase.punto = 'prenotata'; fase.idOrigine = idOrigine

  // 5. La LDV, dal detentore. Da qui il credito e' prenotato: ogni uscita senza LDV storna la fila.
  const n = livelli.length, det = livelli[n - 1]
  const rifiutaDalDetentore = async (messaggio: string) => {
    await admin.rpc('ponte_storna', { p_id: idOrigine, p_errore: messaggio }).then(({ error }) => { if (error) console.error('[PONTE][STORNO]', idOrigine, error.message) })
    return { tipo: 'rifiuto' as const, messaggio: messaggioDalLivello(n - 1, messaggio) }
  }
  if (p.scadenza - Date.now() < MINIMO_CREAZIONE_MS) return rifiutaDalDetentore(MSG_PONTE_NON_CONCLUSO)
  const ldv = await (p.compraLdv || ldvPosteV1)({
    corriere: det.v.corriere, cred: det.v.cred, body: det.body, packages: det.v.packages,
    conPresso: det.v.conPresso, pressoFrom: det.v.pressoFrom, pressoTo: det.v.pressoTo,
  }).catch((e: any) => ({ errore: erroreCorrierePulito(e?.message) }))
  if ('errore' in ldv) return rifiutaDalDetentore(ldv.errore)
  segna('ldv')
  fase.punto = 'ldv'; fase.numero = ldv.numero
  {
    const { error } = await admin.rpc('ponte_ldv', { p_id: idOrigine, p_ldv: ldv.numero, p_dati: ldv.raw })
    if (error) console.error('[PONTE][LDV NON ANNOTATA]', idOrigine, ldv.numero, error.message)
  }

  // 6. La scrittura unica. Ripetibile: se un tentativo e' passato ma la risposta si e' persa, il successivo lo vede.
  // Da qui la LDV c'e': nessun errore deve far cadere la creazione, al massimo si lascia al recupero.
  let scritta = false, ultimoErrore = ''
  try {
    const completo = completaPiano(modello, { numero: ldv.numero, etichettaUrl: ldv.etichettaUrl, raw: ldv.raw })
    for (const attesa of [0, 400, 1200]) {
      if (attesa) await new Promise(r => setTimeout(r, attesa))
      const { error } = await admin.rpc('ponte_scrivi', { p_piano: completo, p_prova: false })
      if (!error) { scritta = true; break }
      ultimoErrore = error.message
    }
  } catch (e: any) {
    ultimoErrore = String(e?.message || e)
  }
  segna('scrittura')
  if (!scritta) {
    // Il giro di recupero la scrive dal registro (stato 'ldv'). Chi crea non deve rifarla: la LDV c'e'.
    console.error('[PONTE][SCRITTURA RIMANDATA AL RECUPERO]', idOrigine, ldv.numero, ultimoErrore)
    return { tipo: 'in_ritardo', numero: ldv.numero, spedizioneId: idOrigine }
  }

  // Dopo, come la staffetta: il log dei livelli d'albero senza addebito (uno per livello), e per ogni gamba quello
  // che la sua /api/v1/shipments fa dopo aver scritto (email e webhook del conto d'ingrosso). Il ritiro sulle gambe
  // non si prenota (conti d'ingrosso), e ponte_richieste non serve: non ci sono richieste HTTP da ritrovare.
  for (const r of [...piano.nonAddebitati, ...origine.nonAddebitati]) console.error(r.split(SEGNO_LDV).join(ldv.numero))
  // In prova (LDV finta) niente email ne' webhook: andrebbero a destinatari veri.
  if (!p.compraLdv) dopoLeGambe(admin, livelli, ldv.numero)
  console.log('[PONTE][FATTA]', JSON.stringify({ numero: ldv.numero, livelli: n, ms: { ...ms, tutto: Date.now() - t0 } }))
  return { tipo: 'fatta', numero: ldv.numero, spedizioneId: idOrigine, costoCorrente: piano.risposta.prezzo, ms: { ...ms, tutto: Date.now() - t0 } }
}

// Quello che /api/v1/shipments fa per ogni gamba dopo averla scritta, in background come li': l'email al mittente e
// al destinatario e il webhook 'shipment.created' del conto d'ingrosso.
function dopoLeGambe(admin: Admin, livelli: LivelloDaScrivere[], numero: string) {
  after(async () => {
    const [{ inviaEmailSpedizioneCreata }, { inviaWebhook }] = await Promise.all([import('@/lib/email'), import('@/lib/webhooks')])
    await Promise.all(livelli.map(async L => {
      const body = L.body
      try {
        const { data: cli } = await admin.from('clienti').select('impostazioni').eq('id', L.l.clienteId).maybeSingle()
        await inviaEmailSpedizioneCreata({
          mittEmail: body.shipFrom?.email, destEmail: body.shipTo?.email,
          mittNome: body.shipFrom?.name, destNome: body.shipTo?.name, destCitta: body.shipTo?.city,
          numero, corriere: L.v.corriere.nome_contratto, notificaDest: (cli?.impostazioni as any)?.notifica_email_dest !== false,
          spedizioneId: L.id,
        })
      } catch { /* best-effort, come nella rotta */ }
      inviaWebhook({
        clienteId: L.l.clienteId, corriereId: L.v.corriere.id, evento: 'shipment.created',
        data: { tracking_number: numero, carrier: L.v.corriere.nome_contratto, status: 'in_lavorazione', location: body.shipTo?.city || '', events: [] },
      }).catch(() => {})
    }))
  })
}
