// ANNULLO DEI PACCHI POSTE DIRETTI (SDA EXPRESS L e ogni pacco la cui LDV vera sta su un contratto
// `tipo='poste'`, oggi solo di LOGIXIA).
//
// POSTE non ha un annullo via API: la LDV resta emessa, ma finche' il pacco non viene affidato al
// corriere non costa niente a nessuno. La regola (Lorenzo, 15/10/2026): l'annullo si fa SOLO sul
// portale — tutte le gambe del pacco annullate e stornate — e poi si TIENE D'OCCHIO il pacco per 30
// giorni. Se nel frattempo risulta affidato al corriere e in movimento, il cliente ha spedito lo stesso
// (per errore o di proposito) e il pacco va RIADDEBITATO a ogni livello, anche se il conto va sotto zero.
// Nessuna email: resta una nota sulla spedizione.
//
// Prima di questa libreria l'annullo di una SDA EXPRESS L non si chiudeva MAI: la gamba del cliente e'
// un ponte di condivisione, l'annullo rispondeva "va gestito dall'assistenza" e il cron delle 48 ore la
// rimetteva attiva, col cliente addebitato. Al 15/10 erano 287 rimandate indietro e 186 in attesa.
//
// SUBITO, NON DOPO 48 ORE (Lorenzo, 25/11/2026: «alla richiesta va annullata subito e rimborsata; se
// notiamo che e' partita va riaddebitata»). Le 48 ore non proteggevano niente — su Poste non c'e' un
// annullo da mandare — e intanto il cliente restava addebitato: al 25/11 erano 246 pacchi in attesa.
// Ora il cestino del portale e il DELETE dell'API chiudono subito (annullaSubitoPoste); il cron chiude
// quelle rimaste in attesa da prima, senza aspettare.
//
// Un posto solo per quattro porte: il cestino (spedizioni/elimina), l'API (v1 DELETE), il cron degli
// annulli e la sorveglianza oraria (annulli-recupero-cron).

import { risolviGambeSpedizione, gambePerTracking, type GambaSpedizione } from '@/lib/condivisione-catena'
import { annullaGambePacco, STATI_PARTITA } from '@/lib/annullaSpedizione'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { statoDaLetturaPoste, mappaStatoPoste } from '@/lib/tracking-poste'

// "Il pacco e' nelle mani del corriere": l'elenco vive in lib/annullaSpedizione (lo usa anche annullaGambePacco
// per non annullare mai una riga in viaggio) e si riesporta da qui per chi lo importava gia'.
export { STATI_PARTITA }
export const GIORNI_SORVEGLIANZA = 30

// Marca del riaddebito nella descrizione dei movimenti: e' la guardia anti-doppione (un pacco si
// riaddebita una volta sola) e il modo di ritrovarli. Stesso metodo del riaddebito a mano del 6/10.
const MARCA_RIADDEBITO = 'annullato ma affidato al corriere'

const giorno = (d: string | Date | null | undefined) => {
  if (!d) return ''
  const x = new Date(d)
  return isNaN(x.getTime()) ? '' : x.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' })
}

// Le gambe del pacco, ma solo se la LDV vera sta su un contratto POSTE diretto. Le gambe-ponte hanno
// tipo 'moovexpress', la gamba del detentore ha il tipo vero: basta che una sia 'poste'.
export async function gambePaccoPoste(admin: any, tracking: string | null | undefined): Promise<GambaSpedizione[] | null> {
  if (!tracking) return null
  const gambe = await risolviGambeSpedizione(admin, String(tracking))
  return gambe.some(g => g.tipo === 'poste') ? gambe : null
}

// IL PACCO E' NELLE MANI DEL CORRIERE? Si decide dal TESTO dell'evento, non solo dallo stato.
// Due buchi trovati il 25/11/2026, per cui dal 10/11 la sorveglianza non riaddebitava piu' niente:
//  - la fonte che oggi scrive quasi tutti gli eventi SDA EXPRESS L li salva SENZA stato (38.000 in 24 ore:
//    "LA SPEDIZIONE E' PARTITA", "IN TRANSITO", "LA SPEDIZIONE E' STATA CONSEGNATA"), e la sorveglianza
//    guardava solo lo stato;
//  - il RITIRO presso il mittente non contava: "LA SPEDIZIONE E' STATA RITIRATA PRESSO IL MITTENTE" non ha
//    stato, "presa in carico da un nostro operatore presso il domicilio del mittente" ha 'spedita', escluso
//    di proposito perche' su questi contratti 'spedita' e' spesso solo la LDV accettata. Ma il ritiro e'
//    il momento in cui il pacco passa a Poste, e Poste lo fattura: 282343J105809 ritirato alle 14:14 del
//    20/11, annullo chiesto alle 14:30, rimborsato e mai riaddebitato (cosi' altri due).
// "SPEDIZIONE REGISTRATA DAL MITTENTE" e "Annullamento ritiro" restano fuori: sono la LDV, non il pacco.
const PASSATO_AL_CORRIERE = /ritirat\w*\s+presso\s+(il\s+)?(domicilio\s+del\s+)?mittente|presa\s+in\s+carico\s+da\s+un\s+nostro\s+operatore|accettat\w*\s+presso\s+(la\s+)?filiale|affidat\w*\s+al\s+partner/i
export function eventoDiPartenza(e: { stato?: string | null; descrizione?: string | null }): boolean {
  if (e.stato && STATI_PARTITA.includes(e.stato)) return true
  const d = String(e.descrizione || '')
  if (PASSATO_AL_CORRIERE.test(d)) return true
  const s = mappaStatoPoste(d)
  return !!s && STATI_PARTITA.includes(s)
}

// Lo stato da rimettere su un pacco riaddebitato: quello piu' avanti fra gli eventi (stessa regola delle
// letture Poste), oppure 'spedita' se si sa solo che e' stato ritirato.
function statoDopoRiaddebito(ev: { stato?: string | null; descrizione?: string | null; data_evento?: string | null }[]): string {
  const letti = ev.map(e => ({ ...e, stato: e.stato || mappaStatoPoste(String(e.descrizione || '')) || (PASSATO_AL_CORRIERE.test(String(e.descrizione || '')) ? 'spedita' : null) }))
  return statoDaLetturaPoste(letti as any, null) || 'spedita'
}

// Il pacco si e' mosso? Si guarda TUTTO il pacco (ogni gamba), perche' il tracking arriva sulla gamba
// del detentore e scende alle altre dai ponti: basta che una lo dica.
export async function paccoPartito(admin: any, gambe: GambaSpedizione[]): Promise<{ partito: boolean; quando: string | null }> {
  const ids = gambe.map(g => g.spedizioneId)
  if (!ids.length) return { partito: false, quando: null }
  const { data: ev, error } = await admin.from('tracking_events').select('stato,descrizione,data_evento').in('spedizione_id', ids)
  // Se gli eventi non si leggono non si puo' dire che il pacco e' fermo: meglio fermarsi che rimborsare
  // a vuoto un pacco forse gia' in viaggio.
  if (error) throw new Error('eventi del pacco non leggibili: ' + error.message)
  const partenze = (ev || []).filter(eventoDiPartenza)
  if (partenze.length) return { partito: true, quando: partenze.map((e: any) => e.data_evento).filter(Boolean).sort()[0] || null }
  const { data: righe } = await admin.from('spedizioni').select('stato').in('id', ids).in('stato', STATI_PARTITA).limit(1)
  return { partito: !!righe?.length, quando: null }
}

// ANNULLO SUBITO, alla richiesta (cestino del portale, DELETE dell'API, cron per le rimaste in attesa).
//  - 'non_poste': il pacco non ha una LDV Poste diretta, decide chi chiama.
//  - 'partito': il pacco e' gia' nelle mani del corriere: niente annullo, resta addebitata.
//  - 'annullata': tutte le gambe annullate e stornate; da qui parte la sorveglianza di 30 giorni.
export async function annullaSubitoPoste(
  admin: any, tracking: string | null | undefined, rich: { da?: string | null; richiestoAt?: string | null },
): Promise<{ esito: 'non_poste' } | { esito: 'partito'; quando: string | null; messaggio: string } | { esito: 'annullata'; gambe: number }> {
  const gambe = await gambePaccoPoste(admin, tracking)
  if (!gambe) return { esito: 'non_poste' }
  const p = await paccoPartito(admin, gambe)
  if (p.partito) {
    return { esito: 'partito', quando: p.quando, messaggio: `Non annullabile: il pacco risulta già affidato al corriere${p.quando ? ' il ' + giorno(p.quando) : ''}. La spedizione resta addebitata.` }
  }
  const r = await annullaGambePacco(admin, gambe, { richiestoAt: rich.richiestoAt || new Date().toISOString(), da: rich.da || null })
  console.info('[ANNULLO-POSTE] annullata subito:', gambe[0]?.numero, `${r.gambe} gambe`)
  return { esito: 'annullata', gambe: r.gambe }
}

// ANNULLO: tutte le gambe annullate e stornate (lib/annullaSpedizione, annullaGambePacco). Su Poste non
// c'e' nulla da mandare al corriere: la LDV resta emessa, e da `richiestoAt` parte la sorveglianza.
export async function annullaPaccoPoste(
  admin: any, gambe: GambaSpedizione[], rich: { richiestoAt?: string | null; da?: string | null },
): Promise<{ gambe: number }> {
  return annullaGambePacco(admin, gambe, rich)
}

export interface RiaddebitoPianificato {
  spedizioneId: string; numero: string; clienteId: string | null; masterId: string; masterTargetId: string | null; importo: number
}

// RIADDEBITO di un pacco annullato ma partito: su ogni gamba si rovescia ogni rimborso dell'annullo
// (stesso soggetto, importo opposto), cosi' ogni livello torna a pagare esattamente quello che pagava
// prima. Il cliente va anche sotto zero (registraMovimento non chiede capienza): il pacco ha viaggiato
// e il detentore paga Poste comunque.
// Lo stato si rimette alla fine, DOPO i soldi, e il pacco torna visibile: l'incidente del 6/10 era
// proprio un riaddebito riuscito con la riga rimasta 'annullata', quindi pagata e nascosta.
// `simula` = nessuna scrittura, torna solo il piano (serve all'arretrato e alla verifica).
export async function riaddebitaPaccoPartito(
  admin: any, gambe: GambaSpedizione[], esito: { stato: string; quando?: string | null }, opz: { simula?: boolean } = {},
): Promise<{ piano: RiaddebitoPianificato[]; gambe: number }> {
  const ids = gambe.map(g => g.spedizioneId)
  const { data: righe } = await admin.from('spedizioni')
    .select('id,numero,stato,contrassegno,stato_contrassegno,distinta_contrassegno_id,annullamento_richiesto_at').in('id', ids)
  const annullate = (righe || []).filter((r: any) => r.stato === 'annullata')
  const piano: RiaddebitoPianificato[] = []
  for (const r of annullate) {
    const { data: rimb } = await admin.from('movimenti').select('cliente_id,master_id,master_target_id,importo,descrizione')
      .eq('spedizione_id', r.id).eq('tipo', 'rimborso')
    if ((rimb || []).some((m: any) => String(m.descrizione || '').includes(MARCA_RIADDEBITO))) continue
    for (const m of (rimb || [])) {
      const importo = -Number(m.importo || 0)
      if (!(Math.abs(importo) > 0.0001)) continue
      piano.push({ spedizioneId: r.id, numero: r.numero, clienteId: m.cliente_id || null, masterId: m.master_id, masterTargetId: m.master_target_id || null, importo })
    }
  }
  if (opz.simula) return { piano, gambe: annullate.length }

  for (const p of piano) {
    const desc = `Riaddebito ${p.numero} - ${MARCA_RIADDEBITO}`
    if (p.clienteId) {
      await registraMovimento(admin, { masterId: p.masterId, clienteId: p.clienteId, tipo: 'rimborso', descrizione: desc, riferimento: p.numero, importo: p.importo, spedizioneId: p.spedizioneId, createdBy: null })
    } else if (p.masterTargetId) {
      await registraMovimentoMaster(admin, { masterOwnerId: p.masterId, masterTargetId: p.masterTargetId, tipo: 'rimborso', descrizione: desc, riferimento: p.numero, importo: p.importo, spedizioneId: p.spedizioneId, createdBy: null })
    }
  }
  // La data dell'annullo e' del PACCO: le gambe annullate a mano prima di questa libreria non la portano.
  const dataAnnullo = annullate.map((r: any) => r.annullamento_richiesto_at).filter(Boolean).sort()[0] || null
  const nota = `Annullata${dataAnnullo ? ' il ' + giorno(dataAnnullo) : ''} ma affidata al corriere${esito.quando ? ' il ' + giorno(esito.quando) : ''}: riaddebitata.`
  for (const r of annullate) {
    const upd: any = { stato: esito.stato, annullamento_richiesto_at: null, annullamento_da: null, annullamento_errore: nota }
    // All'annullo il trigger ha chiuso il contrassegno ancora in attesa (fn_contrassegno_chiudi_su_reso):
    // se il pacco viaggia, il contrassegno verra' incassato e va restituito al cliente. Si riapre.
    if (Number(r.contrassegno || 0) > 0 && r.stato_contrassegno === 'annullato' && !r.distinta_contrassegno_id) upd.stato_contrassegno = 'in_attesa'
    await admin.from('spedizioni').update(upd).eq('id', r.id)
  }
  // La merce di magazzino rientrata all'annullo (trg_articoli_rientro) NON si riscarica da sola: lo dico
  // nei log, perche' un secondo scarico dello stesso articolo lo ferma l'indice unico.
  const { data: art } = await admin.from('articoli_movimenti').select('spedizione_id').in('spedizione_id', ids).limit(1)
  if (art?.length) console.warn('[ANNULLO-POSTE] riaddebitato un pacco con articoli di magazzino rientrati: la giacenza va riallineata a mano', gambe[0]?.numero)
  return { piano, gambe: annullate.length }
}

// SORVEGLIANZA DAI FATTI GIA' SCRITTI. Il tracking delle SDA EXPRESS L non arriva da una fonte sola: lo
// sweep OneTracking dal Mac (tre volte al giorno, la fonte che regge davvero) e bonifica-poste da poste.it,
// che Poste blocca quasi a ogni giro dopo una ventina di letture (log del 15-16/10: bloccati=6 sempre).
// Quindi la decisione non dipende da chi legge: qui si guardano gli eventi di movimento gia' scritti su
// QUALSIASI gamba dei pacchi annullati negli ultimi 30 giorni, e se ce n'e' uno il pacco si riaddebita.
// Gira ogni ora da annulli-recupero-cron. Nessuna chiamata esterna: solo letture, poi il riaddebito.
export async function sorvegliaAnnullatePoste(admin: any, opz: { simula?: boolean } = {}): Promise<{ pacchi: number; partiti: number; riaddebitati: number; piano: RiaddebitoPianificato[] }> {
  const inizio = new Date(Date.now() - (GIORNI_SORVEGLIANZA + 2) * 86400000).toISOString()
  // Qualunque gamba annullata nella finestra, non solo quella del detentore: gli annulli fatti a mano prima
  // di questa libreria (5-6/10) hanno la data solo sulla gamba del cliente. I pacchi senza una gamba POSTE
  // (ponti verso altri corrieri) li scarta piu' sotto il controllo sulle gambe.
  const { data: corr } = await admin.from('corrieri').select('id').in('tipo', ['poste', 'moovexpress'])
  const corrIds = (corr || []).map((c: any) => c.id)
  const vuoto = { pacchi: 0, partiti: 0, riaddebitati: 0, piano: [] as RiaddebitoPianificato[] }
  if (!corrIds.length) return vuoto
  const trk = new Set<string>()
  for (let da = 0; ; da += 1000) {
    const { data, error } = await admin.from('spedizioni').select('tracking_number')
      .in('corriere_id', corrIds).eq('stato', 'annullata').gte('annullamento_richiesto_at', inizio)
      .not('tracking_number', 'is', null).order('id').range(da, da + 999)
    if (error) throw new Error('annullate in sorveglianza non leggibili: ' + error.message)
    for (const r of (data || [])) trk.add(String(r.tracking_number))
    if (!data || data.length < 1000) break
  }
  if (!trk.size) return vuoto
  const gambeDi = await gambePerTracking(admin, [...trk])
  const ids = [...gambeDi.values()].flat().map(g => g.spedizioneId)
  // TUTTI gli eventi, non solo quelli con uno stato di movimento: la decisione la prende eventoDiPartenza,
  // che legge anche il testo (vedi sopra). A pagine, perche' 100 gambe possono avere piu' di 1.000 eventi.
  const eventi = new Map<string, { stato: string | null; descrizione: string | null; data_evento: string | null }[]>()
  for (let i = 0; i < ids.length; i += 100) {
    for (let da = 0; ; da += 1000) {
      const { data, error } = await admin.from('tracking_events').select('id,spedizione_id,stato,descrizione,data_evento')
        .in('spedizione_id', ids.slice(i, i + 100)).order('id').range(da, da + 999)
      if (error) throw new Error('eventi delle annullate non leggibili: ' + error.message)
      for (const e of (data || [])) {
        if (!eventoDiPartenza(e)) continue
        if (!eventi.has(e.spedizione_id)) eventi.set(e.spedizione_id, [])
        eventi.get(e.spedizione_id)!.push({ stato: e.stato || null, descrizione: e.descrizione || null, data_evento: e.data_evento || null })
      }
      if (!data || data.length < 1000) break
    }
  }
  let partiti = 0, riaddebitati = 0
  const piano: RiaddebitoPianificato[] = []
  for (const gambe of gambeDi.values()) {
    if (!gambe.some(g => g.tipo === 'poste')) continue
    const ev = gambe.flatMap(g => eventi.get(g.spedizioneId) || [])
    if (!ev.length) continue
    partiti++
    const quando = ev.map(e => e.data_evento).filter(Boolean).sort()[0] || null
    // Lo stato vero dalla stessa regola delle letture Poste (solo avanti, reso che vince, mai giacenza),
    // letto anche dal testo; se si sa solo del ritiro, 'spedita'.
    const r = await riaddebitaPaccoPartito(admin, gambe, { stato: statoDopoRiaddebito(ev), quando }, { simula: opz.simula })
    piano.push(...r.piano)
    if (r.gambe) {
      riaddebitati++
      if (!opz.simula) console.warn('[ANNULLO-POSTE] annullata ma affidata al corriere, riaddebitata:', gambe[0]?.numero)
    }
  }
  return { pacchi: [...gambeDi.values()].filter(g => g.some(x => x.tipo === 'poste')).length, partiti, riaddebitati, piano }
}

// IL CONTROLLO DI OGNI MATTINA (Sentinella, app/api/controllo/sentinella). Lorenzo, 25/11/2026: «prepara il
// funnel e controllalo sempre». Il flusso si rompe senza errori — come dal 10/11, quando la sorveglianza ha
// smesso di vedere i pacchi partiti e nessuno lo sapeva — quindi si guarda che ogni passo abbia lavorato:
//  1. nessuna richiesta resta in attesa (l'annullo e' immediato; il cron chiude le rimaste ogni ora);
//  2. nessun pacco annullato e gia' partito aspetta il riaddebito (la sorveglianza gira ogni ora);
//  3. le annullate in sorveglianza vengono ancora rilette dal tracking (il silenzio e' l'allarme).
// Piu' due righe da leggere: annullate e riaddebitate nelle ultime 24 ore.
export async function controlloAnnulliPoste(admin: any): Promise<{ area: string; controllo: string; valore: number; atteso: string; allarme: boolean }[]> {
  const area = 'annulli SDA EXPRESS L'
  const ora = Date.now()
  const { data: corr, error: ec } = await admin.from('corrieri').select('id,tipo').or('tipo.eq.poste,nome_contratto.ilike."sda express l*"')
  if (ec) throw new Error('contratti non leggibili: ' + ec.message)
  const tutti = (corr || []).map((c: any) => c.id)
  const detentori = (corr || []).filter((c: any) => c.tipo === 'poste').map((c: any) => c.id)
  const conta = async (q: any) => { const { count, error } = await q; if (error) throw new Error(error.message); return count || 0 }

  const inAttesa = await conta(admin.from('spedizioni').select('id', { count: 'exact', head: true })
    .in('corriere_id', tutti).eq('stato', 'annullamento_pending').lt('annullamento_richiesto_at', new Date(ora - 2 * 3600000).toISOString()))
  const sorv = await sorvegliaAnnullatePoste(admin, { simula: true })
  const inizio = new Date(ora - (GIORNI_SORVEGLIANZA + 2) * 86400000).toISOString()
  const inSorveglianza = await conta(admin.from('spedizioni').select('id', { count: 'exact', head: true })
    .in('corriere_id', detentori).eq('stato', 'annullata').gte('annullamento_richiesto_at', inizio))
  const rilette = await conta(admin.from('spedizioni').select('id', { count: 'exact', head: true })
    .in('corriere_id', detentori).eq('stato', 'annullata').gte('annullamento_richiesto_at', inizio)
    .gte('tracking_check_at', new Date(ora - 86400000).toISOString()))
  const ieri = new Date(ora - 86400000).toISOString()
  const annullate24 = await conta(admin.from('spedizioni').select('id', { count: 'exact', head: true })
    .in('corriere_id', detentori).eq('stato', 'annullata').gte('annullamento_richiesto_at', ieri))
  const { data: riad, error: er } = await admin.from('movimenti').select('riferimento')
    .gte('created_at', ieri).like('descrizione', `%${MARCA_RIADDEBITO}%`)
  if (er) throw new Error(er.message)
  const riaddebitate24 = new Set((riad || []).map((m: any) => m.riferimento)).size

  return [
    { area, controllo: 'richieste di annullo ancora in attesa da più di 2 ore', valore: inAttesa, atteso: '0', allarme: inAttesa > 0 },
    { area, controllo: 'pacchi annullati ma già partiti, non ancora riaddebitati', valore: sorv.riaddebitati, atteso: '0', allarme: sorv.riaddebitati > 0 },
    { area, controllo: `annullate in sorveglianza (${inSorveglianza}) rilette dal tracking nelle 24 ore`, valore: rilette, atteso: inSorveglianza ? 'più di 0' : '0', allarme: inSorveglianza > 0 && rilette === 0 },
    { area, controllo: 'pacchi annullati nelle 24 ore', valore: annullate24, atteso: 'informativa', allarme: false },
    { area, controllo: 'pacchi riaddebitati nelle 24 ore (annullati ma partiti)', valore: riaddebitate24, atteso: 'informativa', allarme: false },
  ]
}
