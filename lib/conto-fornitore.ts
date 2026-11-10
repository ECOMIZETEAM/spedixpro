// IL CONTO DEL CORRIERE, RICONCILIATO DA SOLO.
//
// Oltre alle ripesature — che arrivano col file e hanno gia' la loro strada — il corriere addebita
// due cose che finora non registrava nessuno: il RESO (una riga per ogni ritorno) e l'APERTURA
// GIACENZA. Quei soldi escono davvero dal conto di chi detiene il contratto.
//
// Il guasto che questo file ripara: chi apre una giacenza incassava dalla rete senza mai pagare il
// corriere. Nei margini il detentore sembrava guadagnare tutto l'incasso, mentre una parte non fa
// che coprire il conto. Dal 2/07 al 29/09/2026 erano 2.795,09 EUR di resi e 313,95 di giacenze che
// non stavano scritti da nessuna parte. Il recupero c'e' gia' (le code degli addebiti girano la
// spesa a valle): mancava la spesa.
//
// SI PUO' RIFARE QUANTE VOLTE SI VUOLE. Il conto e' cumulativo e questo giro rilegge sempre le
// stesse righe: a impedire il doppio addebito e' l'indice unico sul riferimento
// (movimenti_un_costo_fornitore_per_master), non l'ordine in cui girano le cose.
import { registraMovimentoMaster } from '@/lib/movimenti'

const BASE = 'https://core.spediamopro.com/api/v2'

type RigaConto = { id?: number | string; reason: string; amount: number; createdAt?: string }

// Le due voci che ci interessano. Il codice e' quello del corriere (raw_response.code), non la
// lettera di vettura: "Reso spedizione: 6A..." e "Giacenza spedizione #6A...".
const VOCI: { tipo: 'reso' | 'giacenza'; re: RegExp; prefisso: string; testo: (ldv: string, eur: string) => string }[] = [
  {
    tipo: 'reso', re: /^\s*reso spedizione\s*[:#]/i, prefisso: 'RESOFORN',
    testo: (ldv, eur) => `Reso ${ldv} - costo addebitato dal corriere €${eur}`,
  },
  {
    tipo: 'giacenza', re: /^\s*giacenza spedizione\s*[:#]/i, prefisso: 'GIACFORN',
    testo: (ldv, eur) => `Apertura giacenza ${ldv} - costo addebitato dal corriere €${eur}`,
  },
]

const codiceDi = (t: string) => (String(t).match(/[:#]\s*([0-9A-Za-z]*\d[0-9A-Za-z]{7,})/) || [])[1] || null

async function token(authcode: string): Promise<string | null> {
  const r = await fetch(`${BASE}/auth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${authcode}:`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const j: any = await r.json().catch(() => null)
  return j?.access_token || null
}

// Le righe del conto, dalla piu' recente. `pagine` limita quanto si va indietro: al giro di ogni
// giorno bastano poche pagine (il conto fa ~1.100 righe al giorno), per un recupero di arretrato si
// alza e basta.
async function leggiConto(authcode: string, pagine: number): Promise<RigaConto[]> {
  const tk = await token(authcode)
  if (!tk) return []
  const out: RigaConto[] = []
  for (let p = 1; p <= pagine; p++) {
    const r = await fetch(`${BASE}/wallet/transactions/search?page=${p}&perPage=100`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    })
    if (!r.ok) break
    const j: any = await r.json().catch(() => null)
    const righe = j?.data || []
    out.push(...righe)
    if (righe.length < 100) break
  }
  return out
}

export type EsitoRiconciliazione = {
  lette: number; costi: number; scritti: number; euro: number; senzaSpedizione: number; inAttesa: number
  resiSegnati: number
  daControllare: { numero: string; stato: string; motivo: string }[]
}

// ── IL RESO FATTURATO DAL CORRIERE E' UN RESO ──
//
// Il costo da solo non bastava: si registrava al titolare, ma il pacco restava "non consegnato", "in
// giacenza" o "consegnata", nessuno sotto lo pagava e il titolare non recuperava niente. Il fornitore
// i BRT e gli UPS li fattura come reso senza mandare gli eventi del ritorno, quindi il tracking il
// reso non lo vede mai: il 09/11/2026 erano 57 pacchi (992,87 EUR a valle), il 10/11 altri 57 (801,05),
// tutti corretti a mano. Lorenzo, 10/11: «se ci addebitano quel costo, noi dobbiamo farlo pagare».
//
// Qui il pacco passa a reso_mittente; l'addebito lo fa la coda dei resi, come per ogni altro reso (il
// trigger fn_reso_da_addebitare mette il pacco in coda, /api/cron/addebiti-code lo addebita a cliente
// e catena). La riga del titolare non si scrive due volte: il suo costo e' il RESOFORN appena scritto,
// e fn_addebita_resi salta la sua riga (scripts/reso-titolare-costo-fornitore.sql).
//
// Prima si rilegge il fornitore, perche' una fattura sbagliata non diventi un addebito:
// - pacco MAI PARTITO (status 4/5/6/13, o 0 annullato): non e' un reso, e' da contestare
//   (050261292815569, MULTI a suo nome, fermo in lavorazione dall'agosto e fatturato come reso);
// - CONSEGNATO al destinatario (status 10) senza nessun reso negli eventi: da contestare anche questo
//   (050224292877762, consegnato a Firenze il 07/09 e fatturato come reso il 06/10).
// Quei pacchi restano come sono e tornano nell'esito del giro, da guardare a mano. Tutto il resto (in
// viaggio, in giacenza, fermo al punto di ritiro, eccezione, o consegnato con il reso scritto negli
// eventi, cioe' consegnato al mittente) e' un reso.
const STATI_DA_SEGNARE = ['in_lavorazione', 'spedita', 'in_transito', 'in_consegna', 'in_giacenza', 'non_consegnato', 'eccezione', 'consegnata']
const STATUS_MAI_PARTITO = new Set([0, 4, 5, 6, 13])
// Un giro normale ne trova poche decine; con `pagine` alto (recupero d'arretrato) il resto va al giro dopo.
const LETTURE_MAX = 80

export type DecisioneResoFatturato = { reso: true; resoIl: string } | { reso: false; motivo: string }

// Il reso fatturato, letto il tracking vivo del fornitore: e' un reso o una fattura da contestare?
// `quando` e' il giorno della riga del conto, la data di ripiego del rientro.
export async function decidiResoFatturato(
  tr: { status: number | null; events: any[] }, quando?: string,
): Promise<DecisioneResoFatturato> {
  const { spediamoproEventiIndicanoReso } = await import('@/lib/spediamopro')
  const { testoIndicaReso, testoAnnunciaReso } = await import('@/lib/spedisci')
  const { istanteDaTesto } = await import('@/lib/tracking-eventi')
  const status = tr.status === null || tr.status === undefined ? null : Number(tr.status)
  const eventi = Array.isArray(tr.events) ? tr.events : []
  if (status === null || STATUS_MAI_PARTITO.has(status)) {
    return { reso: false, motivo: `reso fatturato ma il pacco non risulta partito (status ${status ?? '-'})` }
  }
  const resoNegliEventi = spediamoproEventiIndicanoReso(eventi)
  const testo = (e: any) => `${e?.title || ''} ${e?.description || ''}`
  // UPS consegna e poi scrive «Il pacco verrà restituito al mittente come richiesto dal destinatario»
  // (1ZGE70566838916080, 1ZGE70566827802893): per testoIndicaReso e' un annuncio, e da solo non basta (su 12
  // annunci dello storico 5 pacchi sono poi stati consegnati). Qui pero' c'e' anche la fattura del reso:
  // un ritorno annunciato al futuro certo DOPO l'ultima consegna, insieme alla fattura, e' un reso. Il
  // condizionale («potrebbe essere rispedito») no. La consegna si riconosce dal titolo, mai «NON CONSEGNATA»,
  // e il ritorno con le regole rigide di lib/spedisci: un generico "al mittente" prenderebbe anche "dal
  // mittente" e la rimessa del contrassegno al mittente, che arriva proprio dopo la consegna.
  const ordinati = [...eventi].sort((a: any, b: any) => String(a?.at || a?.date || '').localeCompare(String(b?.at || b?.date || '')))
  const iConsegna = ordinati.map((e: any) => {
    const t = String(e?.title || '').toLowerCase()
    return /\bconsegnat|\bdelivered\b/.test(t) && !/non consegnat|not delivered/.test(t)
  }).lastIndexOf(true)
  const ritornoDopoConsegna = iConsegna >= 0 && ordinati.slice(iConsegna + 1)
    .some((e: any) => testoIndicaReso(testo(e)) || (testoAnnunciaReso(testo(e)) && !/\bpotr/i.test(testo(e))))
  if (status === 10 && !resoNegliEventi && !ritornoDopoConsegna) {
    return { reso: false, motivo: 'reso fatturato ma il corriere lo da consegnato al destinatario' }
  }
  // La data del rientro: l'evento di reso se il corriere lo scrive, se no il giorno della fattura.
  // E' la data con cui il reso entra nella percentuale resi del cliente (resi_per_cliente_v2). Le date
  // del fornitore arrivano senza fuso ed e' ora italiana: istanteDaTesto, non new Date().
  const evReso = ordinati.find((e: any) => testoIndicaReso(testo(e)))
  const resoIl = (evReso && istanteDaTesto(evReso.at || evReso.date)) || (quando && istanteDaTesto(quando)) || new Date().toISOString()
  return { reso: true, resoIl }
}

async function segnaResiFatturati(
  admin: any, authcode: string,
  resi: { spedizioneId: string; quando?: string }[],
  esito: EsitoRiconciliazione,
): Promise<void> {
  const quandoDi = new Map<string, string | undefined>()
  for (const r of resi) if (!quandoDi.has(r.spedizioneId)) quandoDi.set(r.spedizioneId, r.quando)
  const ids = [...quandoDi.keys()]
  const candidati: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from('spedizioni')
      .select('id,numero,tracking_number,stato,sp_id:raw_response->>id,sp_id2:raw_response->raw->data->>id')
      .in('id', ids.slice(i, i + 200)).in('stato', STATI_DA_SEGNARE)
    if (error) { console.error('[CONTO][RESI] spedizioni non lette:', error.message); return }
    candidati.push(...(data || []))
  }
  if (!candidati.length) return

  const { spediamoproGetTracking } = await import('@/lib/spediamopro')
  const { notificaCambioStato } = await import('@/lib/tracking-notifica')
  const inizio = Date.now()
  let letti = 0
  for (const s of candidati.slice(0, LETTURE_MAX)) {
    // Il giro ha 300 secondi e prima ha gia' letto il conto: le letture si fermano a 150, il resto domani.
    if (Date.now() - inizio > 150_000) break
    letti++
    const spid = s.sp_id || s.sp_id2
    if (!spid) { esito.daControllare.push({ numero: s.numero, stato: s.stato, motivo: 'senza id del fornitore' }); continue }
    let tr: Awaited<ReturnType<typeof spediamoproGetTracking>>
    try {
      tr = await Promise.race([
        spediamoproGetTracking(authcode, Number(spid)),
        new Promise<never>((_, ko) => setTimeout(() => ko(new Error('nessuna risposta in 20 secondi')), 20_000)),
      ])
    } catch (e: any) {
      // Fornitore che non risponde: si riprova al giro dopo (la riga del conto resta nella finestra per due-tre
      // giorni). Finisce comunque nel log: un pacco che non si legge mai uscirebbe dalla finestra col costo
      // pagato e senza reso, cioe' il guasto di prima, in silenzio.
      esito.daControllare.push({ numero: s.numero, stato: s.stato, motivo: 'tracking del fornitore non leggibile, si riprova: ' + String(e?.message || e).slice(0, 80) })
      continue
    }
    const decisione = await decidiResoFatturato(tr, quandoDi.get(s.id))
    if (!decisione.reso) { esito.daControllare.push({ numero: s.numero, stato: s.stato, motivo: decisione.motivo }); continue }
    const resoIl = decisione.resoIl

    // UN RESO E' UN EVENTO DEL PACCO: un pacco condiviso ha piu' gambe con lo stesso tracking_number, e la
    // gamba di chi lo compra (il ponte) il reso non lo vedrebbe mai, perche' il fornitore non lo scrive.
    // Si segnano tutte; l'addebito resta uno solo per pagatore (fn_addebita_resi e il trigger
    // trg_reso_una_volta_per_pacco), come quando il reso lo porta il tracking.
    let gambe: any[] = [s]
    if (s.tracking_number) {
      const { data: g } = await admin.from('spedizioni').select('id,numero,stato')
        .eq('tracking_number', s.tracking_number).in('stato', STATI_DA_SEGNARE)
      if (g?.length) gambe = g
    }
    for (const g of gambe) {
      // Solo se lo stato e' ancora quello letto: se nel frattempo il tracking l'ha cambiato, vince lui.
      const { data: ok, error } = await admin.from('spedizioni')
        .update({ stato: 'reso_mittente', reso_il: resoIl }).eq('id', g.id).eq('stato', g.stato).select('id')
      if (error) { console.error('[CONTO][RESI] stato non aggiornato', g.numero, error.message); continue }
      if (ok?.length) {
        esito.resiSegnati++
        // Chi si integra via API riceve l'avviso del reso come da ogni altra porta che cambia lo stato.
        await notificaCambioStato(admin, g.id, 'reso_mittente', g.stato)
      }
    }
  }
  if (candidati.length > letti) console.log('[CONTO][RESI] rimandati al giro dopo:', candidati.length - letti)
}

export async function riconciliaCostiConto(admin: any, opts: { pagine?: number; createdBy?: string | null } = {}): Promise<EsitoRiconciliazione> {
  const esito: EsitoRiconciliazione = { lette: 0, costi: 0, scritti: 0, euro: 0, senzaSpedizione: 0, inAttesa: 0, resiSegnati: 0, daControllare: [] }

  // CHI PAGA IL CONTO E' CHI POSSIEDE IL CONTRATTO. Le credenziali sono le sue: i master che lo
  // rivendono usano la stessa chiave ma il conto non e' il loro. Una chiave = un pagatore.
  const { data: corr } = await admin.from('corrieri').select('master_id,credenziali,proprio').eq('tipo', 'spediamopro')
  const perChiave = new Map<string, string>()
  for (const c of (corr || [])) {
    const auth = (c as any)?.credenziali?.authcode
    if (!auth) continue
    if ((c as any).proprio || !perChiave.has(auth)) perChiave.set(auth, (c as any).master_id)
  }

  for (const [authcode, pagatore] of perChiave) {
    const righe = await leggiConto(authcode, Math.max(1, opts.pagine || 30))
    esito.lette += righe.length

    const costi: { tipo: string; prefisso: string; code: string; euro: number; riga: string; quando?: string; testo: (ldv: string, eur: string) => string }[] = []
    for (const m of righe) {
      const t = String(m?.reason || '')
      const voce = VOCI.find(v => v.re.test(t))
      if (!voce) continue
      const code = codiceDi(t)
      const euro = Math.abs(Number(m?.amount || 0)) / 100
      if (!code || !(euro > 0) || !m?.id) continue
      costi.push({ tipo: voce.tipo, prefisso: voce.prefisso, code, euro, testo: voce.testo, riga: String(m.id), quando: m.createdAt })
    }
    esito.costi += costi.length
    if (!costi.length) continue

    // La spedizione serve per agganciare il movimento (e per scrivere la lettera di vettura, che e'
    // quello che una persona riconosce).
    const sped = new Map<string, { id: string; numero: string }>()
    const codici = Array.from(new Set(costi.map(c => c.code)))
    for (let i = 0; i < codici.length; i += 200) {
      const { data } = await admin.from('spedizioni')
        .select('id,numero,code:raw_response->>code').in('raw_response->>code', codici.slice(i, i + 200))
      for (const s of (data || [])) if ((s as any).code) sped.set((s as any).code, { id: (s as any).id, numero: (s as any).numero })
    }

    // ── SI SCALA SOLO QUELLO CHE MANCA ──
    //
    // Il flusso dei resi e delle giacenze addebita GIA' al detentore il suo nolo per la stessa cosa
    // (movimento reso/giacenza con master_target_id = lui, e registra_movimento_master scala il
    // conto del TARGET). Registrando qui il costo per intero la spesa risultava DOPPIA: il
    // 29/09/2026 sono stati scalati 2.473,24 EUR di troppo a MULTIEXPRESS, stornati subito.
    // Si scala la DIFFERENZA fra quello che chiede il corriere e quello che il detentore ha gia'
    // pagato — che e' esattamente il supplemento che il corriere mette sul ritorno.
    const SETTIMANA = 7 * 24 * 60 * 60 * 1000
    const giaAddebitato = new Map<string, number>()
    {
      const idSped = Array.from(new Set(costi.map(c => sped.get(c.code)?.id).filter(Boolean))) as string[]
      for (let k = 0; k < idSped.length; k += 200) {
        const { data } = await admin.from('movimenti').select('spedizione_id,tipo,importo')
          .in('spedizione_id', idSped.slice(k, k + 200)).in('tipo', ['reso', 'giacenza'])
          .eq('master_target_id', pagatore)
        for (const m of (data || [])) {
          const key = `${(m as any).spedizione_id}|${(m as any).tipo}`
          giaAddebitato.set(key, (giaAddebitato.get(key) || 0) + Math.abs(Number((m as any).importo || 0)))
        }
      }
    }

    // QUATTRO ALLA VOLTA: qui si muove credito e tutte queste righe scalano lo stesso conto.
    let i = 0
    await Promise.all(Array.from({ length: Math.min(4, costi.length) }, async () => {
      while (i < costi.length) {
        const c = costi[i++]
        const s = sped.get(c.code)
        if (!s) { esito.senzaSpedizione++; continue }
        const gia = giaAddebitato.get(`${s.id}|${c.tipo}`) || 0
        const daScalare = Math.round((c.euro - gia) * 100) / 100
        if (daScalare < 0.01) {
          // Il detentore ha gia' pagato almeno quanto gli chiede il corriere: niente da aggiungere.
          // Se non ha pagato NULLA ed e' roba fresca, si aspetta il nostro addebito e si riprova al
          // giro dopo (il conto e' cumulativo).
          if (gia <= 0 && c.quando && Date.now() - new Date(c.quando).getTime() < SETTIMANA) esito.inAttesa++
          continue
        }
        try {
          await registraMovimentoMaster(admin, {
            masterOwnerId: pagatore, masterTargetId: pagatore, tipo: 'rettifica',
            descrizione: gia > 0
              ? `${c.testo(s.numero, c.euro.toFixed(2))} — gia' conteggiati €${gia.toFixed(2)} nel nolo, si scala la differenza`
              : c.testo(s.numero, c.euro.toFixed(2)),
            // IL RIFERIMENTO E' LA RIGA DEL CONTO, NON LA SPEDIZIONE. Lo stesso pacco puo' andare in
            // giacenza due volte (24 casi nel conto: due aperture in date diverse, 0,99 EUR
            // ciascuna): con la spedizione come chiave la seconda non si scalerebbe mai, e non solo
            // oggi — per sempre. L'id della riga del conto e' suo e non cambia.
            riferimento: `${c.prefisso}-${c.riga}`,
            importo: -Math.abs(daScalare),
            spedizioneId: s.id, createdBy: opts.createdBy ?? null,
          })
          esito.scritti++; esito.euro += daScalare
        } catch (err: any) {
          // Gia' scalato da un giro precedente: e' il comportamento voluto, non un guasto.
          const m = String(err?.message || '')
          if (!/23505|duplicate key|unique constraint/i.test(m)) console.error('[CONTO] costo non scalato', c.code, m)
        }
      }
    }))

    // DOPO il costo, non prima: col RESOFORN gia' scritto la cascata del reso salta la riga del titolare.
    // Se il costo non e' passato (errore), la cascata scrive la sua riga e il giro di domani scala solo la
    // differenza: l'ordine normale, che gia' funzionava.
    const resiFatturati = costi.filter(c => c.tipo === 'reso' && sped.get(c.code))
      .map(c => ({ spedizioneId: sped.get(c.code)!.id, quando: c.quando }))
    if (resiFatturati.length) {
      try { await segnaResiFatturati(admin, authcode, resiFatturati, esito) }
      catch (e: any) { console.error('[CONTO][RESI] resi fatturati non segnati:', e?.message) }
    }
  }
  return esito
}
