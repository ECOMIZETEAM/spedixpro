// ANNULLO DI UN PACCO VENDUTO FRA RETI, QUANDO LA LDV VERA NON E' POSTE NE' GLS
//
// Un pacco su un contratto condiviso ha una riga per livello (cliente, master che rivendono, detentore),
// tutte con lo stesso tracking. La LDV vera sta solo sulla riga del DETENTORE: e' li' che l'annullo si fa
// davvero (API del fornitore, oppure coda del detentore che lo chiede all'assistenza). Le righe sopra sono
// ponti (`tipo='moovexpress'`) e da sole non possono annullare niente.
//
// Prima la richiesta fatta da una riga-ponte andava in attesa 48 ore e poi il giro delle 48 ore la
// rimandava indietro con "va gestito dall'assistenza", cliente addebitato: la richiesta non arrivava mai
// al detentore. In 90 giorni 25 richieste cosi' (al 26/11/2026), fra cui 1UW0S0W248189 e 026001010025392
// di Atlantik, rimborsate a mano. Poste (lib/annullo-poste) e GLS diretto (lib/annullo-gls) lavoravano gia'
// sul pacco intero; qui la stessa regola per tutti gli altri contratti: la richiesta da qualunque riga si
// gira alla riga del detentore, con la regola del SUO corriere, e l'esito vale per tutto il pacco.
//
// Le righe sopra seguono il detentore anche quando lo annulla un'altra porta (conferma della coda,
// storno DVA, tracking): lo fa il database, trigger trg_gambe_seguono_detentore
// (scripts/gambe-seguono-detentore.sql). Qui, quando l'annullo riesce subito, si annullano e rimborsano
// tutte le righe nello stesso momento, come fanno Poste e GLS, invece di aspettare la coda dei rimborsi.

import { risolviGambeSpedizione, type GambaSpedizione } from '@/lib/condivisione-catena'
import { annullaSpedizioneSulCorriere, annullaGambePacco, masterDetentore } from '@/lib/annullaSpedizione'
import { STATI_PARTITA } from '@/lib/annullo-poste'

// Poste e GLS diretto hanno gia' la loro strada sul pacco intero.
const TIPI_GIA_SUL_PACCO = new Set(['poste', 'gls'])
// Righe che si possono ancora mettere in coda o annullare: non partite, non gia' chiuse.
const STATI_FERMI = ['in_lavorazione', 'spedita', 'annullamento_pending']
// Corrieri il cui annullo via API e' VERO e si manda dopo 48 ore. Tutti gli altri tipi (InPost, interno, quelli
// che verranno) in annullaSpedizioneSulCorriere cadono nel ritorno generico ok:true SENZA chiamare nessuno:
// rimborsare su quell'ok vorrebbe dire rimborsare tutta la catena con l'etichetta ancora valida. Vanno in coda
// al detentore, che conferma quando l'annullo c'e' davvero.
const ANNULLO_VERO_A_48_ORE = new Set(['spediamopro', 'fedex'])

export interface PaccoAlDetentore {
  gambe: GambaSpedizione[]   // tutte le righe del pacco, il detentore per ultimo
  det: any                   // riga spedizioni del detentore
  corr: { id: string; tipo: string; nome_contratto: string | null; master_id: string; contratto_id: string | null }
  stati: Map<string, string> // stato di ogni riga del pacco, letto adesso
}

export type EsitoPacco =
  | { esito: 'annullata' }
  | { esito: 'coda'; storno: boolean }     // nella coda del detentore (o storno DVA in verifica)
  | { esito: 'rifiutata'; motivo: string } // il corriere non lo consente: tutto resta com'e'
  | { esito: 'attesa' }                    // contratto che si annulla a 48 ore: la richiesta resta su chi chiede

// Il pacco va girato al detentore? Null = percorso di sempre: riga singola, richiesta gia' sulla riga del
// detentore, Poste o GLS (strade proprie), oppure fila dei puntatori che non si chiude (non si decide da soli).
export async function paccoAlDetentore(
  admin: any, sped: { id: string; tracking_number?: string | null },
): Promise<PaccoAlDetentore | null> {
  if (!sped.tracking_number) return null
  const tutte = await risolviGambeSpedizione(admin, String(sped.tracking_number))
  if (tutte.length < 2) return null
  const perId = new Map(tutte.map(g => [g.spedizioneId, g]))

  // Dalla riga di chi chiede si sale di venditore in venditore fino a chi non ha venditore: il detentore.
  // Non ordinaGambe: con un'altra riga che riusa lo stesso tracking sceglierebbe a caso da dove partire.
  let cur = perId.get(sped.id)
  const salita = new Set<string>()
  while (cur?.venditoreSpedizioneId && !salita.has(cur.spedizioneId)) {
    salita.add(cur.spedizioneId)
    cur = perId.get(cur.venditoreSpedizioneId)
  }
  if (!cur || cur.venditoreSpedizioneId) return null           // venditore senza quel tracking: fila rotta
  if (cur.spedizioneId === sped.id) return null                 // la richiesta e' gia' sul detentore
  if (!cur.tipo || cur.tipo === 'moovexpress' || TIPI_GIA_SUL_PACCO.has(cur.tipo)) return null

  // Tutte le righe che arrivano al detentore, per quanti salti ci siano; distanza per metterlo ultimo.
  const distanza = new Map<string, number>([[cur.spedizioneId, 0]])
  for (let giro = 0; giro < 20; giro++) {
    let nuove = 0
    for (const g of tutte) {
      if (distanza.has(g.spedizioneId) || !g.venditoreSpedizioneId) continue
      const d = distanza.get(g.venditoreSpedizioneId)
      if (d !== undefined) { distanza.set(g.spedizioneId, d + 1); nuove++ }
    }
    if (!nuove) break
  }
  const gambe = tutte.filter(g => distanza.has(g.spedizioneId))
    .sort((a, b) => (distanza.get(b.spedizioneId)! - distanza.get(a.spedizioneId)!))

  const { data: righe, error: errRighe } = await admin.from('spedizioni').select('id,stato').in('id', gambe.map(g => g.spedizioneId))
  if (errRighe) throw new Error('righe del pacco non leggibili: ' + errRighe.message)
  const stati = new Map<string, string>((righe || []).map((r: any) => [r.id, r.stato]))
  const { data: det, error: errDet } = await admin.from('spedizioni')
    .select('id,numero,dest_nome,stato,stato_precedente,corriere_id,raw_response,tracking_number,created_at,distinta_id,annullamento_da,annullamento_owner_id')
    .eq('id', cur.spedizioneId).maybeSingle()
  if (errDet) throw new Error('riga del detentore non leggibile: ' + errDet.message)
  if (!det) return null
  const { data: corr, error: errCorr } = await admin.from('corrieri')
    .select('id,tipo,nome_contratto,master_id,contratto_id').eq('id', det.corriere_id).maybeSingle()
  if (errCorr) throw new Error('contratto del detentore non leggibile: ' + errCorr.message)
  if (!corr) return null
  return { gambe, det, corr, stati }
}

// Le righe sopra il detentore mostrano «Annullo in corso» mentre la richiesta e' nella sua coda. Senza owner:
// nella coda del detentore deve comparire una riga sola per pacco, la sua. Lo stesso lo fa il trigger quando
// e' il detentore a entrare in coda; qui serve quando ci era gia' (richiesta arrivata prima da un'altra riga).
async function segnaGambeInCoda(admin: any, p: PaccoAlDetentore, rich: { da: string | null; quando: string }) {
  const altre = p.gambe.filter(g => g.spedizioneId !== p.det.id).map(g => g.spedizioneId)
  if (!altre.length) return
  const { data: righe, error } = await admin.from('spedizioni').select('id,stato,stato_precedente').in('id', altre)
  if (error) throw new Error('righe del pacco non leggibili: ' + error.message)
  for (const r of (righe || [])) {
    if (!STATI_FERMI.includes(r.stato)) continue
    const { error: e } = await admin.from('spedizioni').update({
      stato: 'annullamento_manuale',
      stato_precedente: r.stato === 'annullamento_pending' ? (r.stato_precedente || 'in_lavorazione') : r.stato,
      annullamento_owner_id: null,
      annullamento_richiesto_at: rich.quando,
      annullamento_da: rich.da,
      annullamento_errore: null,
    }).eq('id', r.id).eq('stato', r.stato)
    if (e) throw new Error('riga del pacco non aggiornata: ' + e.message)
  }
}

// La riga del detentore entra nella SUA coda, con l'owner giusto (chi detiene il contratto per puntatori), poi le
// altre righe la seguono. Lo stato si rilegge ADESSO: fra la prima lettura e qui c'e' stata la chiamata al
// fornitore, e un'altra porta (lo storno DVA, per esempio) puo' averla gia' messa in coda SENZA owner.
// Se la riga del detentore non si e' potuta mettere in coda si dice: mai "in coda" a vuoto.
async function mettiInCodaDetentore(admin: any, p: PaccoAlDetentore, rich: { da: string | null; errore: string | null }) {
  const quando = new Date().toISOString()
  const { data: ora, error: errOra } = await admin.from('spedizioni')
    .select('id,stato,stato_precedente,annullamento_owner_id').eq('id', p.det.id).maybeSingle()
  if (errOra || !ora) throw new Error('riga del detentore non leggibile: ' + (errOra?.message || 'non trovata'))
  const ownerId = await masterDetentore(admin, p.corr)

  if (STATI_FERMI.includes(ora.stato)) {
    const { data: fatte, error } = await admin.from('spedizioni').update({
      stato: 'annullamento_manuale',
      stato_precedente: ora.stato === 'annullamento_pending' ? (ora.stato_precedente || 'in_lavorazione') : ora.stato,
      annullamento_owner_id: ownerId,
      annullamento_richiesto_at: quando,
      annullamento_da: rich.da,
      annullamento_errore: rich.errore,
    }).eq('id', p.det.id).eq('stato', ora.stato).select('id')
    if (error) throw new Error('riga del detentore non messa in coda: ' + error.message)
    if (!fatte?.length) throw new Error('la riga del detentore è cambiata nel frattempo, riprova')
  } else if (ora.stato === 'annullamento_manuale') {
    if (!ora.annullamento_owner_id) {
      const { error } = await admin.from('spedizioni').update({ annullamento_owner_id: ownerId })
        .eq('id', p.det.id).eq('stato', 'annullamento_manuale').is('annullamento_owner_id', null)
      if (error) throw new Error('detentore della coda non scritto: ' + error.message)
    }
  } else if (ora.stato !== 'storno_richiesto') {
    throw new Error(`la riga del detentore è in stato "${ora.stato}": non si può mettere in coda`)
  }
  await segnaGambeInCoda(admin, p, { da: rich.da, quando })
}

// Il detentore e' gia' annullato (da un'altra porta): si chiudono le righe ancora FERME, senza rimborsare qui.
// Il rimborso lo fa la coda annulli_da_rimborsare (le righe ci entrano diventando 'annullata'), che prima
// guarda eventi di viaggio e ripesature del fornitore: un pacco annullato e poi partito non si rimborsa.
async function chiudiRigheFerme(admin: any, p: PaccoAlDetentore, da: string | null) {
  const altre = p.gambe.filter(g => g.spedizioneId !== p.det.id).map(g => g.spedizioneId)
  const { data: righe, error } = await admin.from('spedizioni').select('id,stato,stato_precedente').in('id', altre)
  if (error) throw new Error('righe del pacco non leggibili: ' + error.message)
  for (const r of (righe || [])) {
    if (!STATI_FERMI.includes(r.stato) && r.stato !== 'annullamento_manuale' && r.stato !== 'storno_richiesto') continue
    const { error: e } = await admin.from('spedizioni').update({
      stato: 'annullata',
      stato_precedente: ['annullamento_pending', 'annullamento_manuale', 'storno_richiesto'].includes(r.stato) ? (r.stato_precedente || 'in_lavorazione') : r.stato,
      annullamento_richiesto_at: new Date().toISOString(),
      annullamento_da: da,
      annullamento_owner_id: null,
      annullamento_errore: null,
    }).eq('id', r.id).eq('stato', r.stato)
    if (e) throw new Error('riga del pacco non annullata: ' + e.message)
  }
}

// Il fornitore ha appena annullato la LDV: si annulla e si rimborsa tutto il pacco. La riga del detentore si
// PRENDE prima (passa ad annullata solo se e' ancora ferma): se due richieste arrivano insieme da due righe dello
// stesso pacco, rimborsa una sola; l'altra trova il detentore gia' annullato e lascia fare alla coda.
async function annullaTutto(admin: any, p: PaccoAlDetentore, da: string | null): Promise<EsitoPacco> {
  const quando = new Date().toISOString()
  const { data: presa, error } = await admin.from('spedizioni').update({
    stato: 'annullata',
    stato_precedente: p.det.stato === 'annullamento_pending' ? (p.det.stato_precedente || 'in_lavorazione') : p.det.stato,
    annullamento_richiesto_at: quando,
    annullamento_da: da,
    annullamento_owner_id: null,
    annullamento_errore: null,
  }).eq('id', p.det.id).in('stato', STATI_FERMI).select('id')
  if (error) throw new Error('riga del detentore non annullata: ' + error.message)
  if (!presa?.length) {
    await chiudiRigheFerme(admin, p, da)
    return { esito: 'annullata' }
  }
  await annullaGambePacco(admin, p.gambe, { richiestoAt: quando, da })
  console.info('[ANNULLO-PACCO] annullato sul detentore:', p.det.numero, `${p.gambe.length} righe`, p.corr.tipo)
  return { esito: 'annullata' }
}

const MSG_15_GIORNI = 'Non annullabile: sono passati più di 15 giorni dalla creazione — il corriere non consente più l\'annullo.'

// Applica alla riga del detentore la regola del SUO corriere, la stessa che spedizioni/elimina applica a una
// spedizione diretta. `subito`: il giro delle 48 ore (annullamenti-cron) manda l'annullo anche ai contratti
// che dal portale aspettano; dal portale e dall'API quei contratti rispondono 'attesa'.
export async function annullaPaccoAlDetentore(
  admin: any, p: PaccoAlDetentore, opz: { da: string | null; subito: boolean },
): Promise<EsitoPacco> {
  const { det, corr } = p
  const da = opz.da

  // Una qualunque riga del pacco gia' in viaggio (consegnata, in giacenza, resa...): il pacco e' nelle mani del
  // corriere e annullarlo vorrebbe dire rimborsare merce che viaggia. Vale anche col detentore gia' annullato:
  // e' il caso "annullato e poi partito", che si guarda a mano.
  for (const s of p.stati.values()) {
    if (STATI_PARTITA.includes(s)) return { esito: 'rifiutata', motivo: 'il pacco risulta già affidato al corriere' }
  }
  // Gia' annullata dal detentore (con una porta che non toccava le altre righe): si chiudono le righe ferme.
  if (det.stato === 'annullata') {
    await chiudiRigheFerme(admin, p, da)
    return { esito: 'annullata' }
  }
  // Gia' nella coda del detentore: ci si assicura che abbia l'owner, e le altre righe si mettono in coda con lei.
  if (det.stato === 'annullamento_manuale' || det.stato === 'storno_richiesto') {
    await mettiInCodaDetentore(admin, p, { da, errore: null })
    return { esito: 'coda', storno: det.stato === 'storno_richiesto' }
  }
  if (!STATI_FERMI.includes(det.stato)) {
    return { esito: 'rifiutata', motivo: `la spedizione del detentore è in stato "${det.stato}"` }
  }

  switch (corr.tipo) {
    // Spedisci: si prova l'annullo via API col conto del detentore; se il fornitore non lo consente
    // (contratto non amministrato via API, borderò chiuso) va nella coda del detentore, che lo chiede
    // all'assistenza e conferma con «Segna annullato».
    case 'spedisci': {
      const e = await annullaSpedizioneSulCorriere(admin, det)
      if (e.ok) return annullaTutto(admin, p, da)
      await mettiInCodaDetentore(admin, p, { da, errore: null })
      return { esito: 'coda', storno: false }
    }
    // DVA: richiesta di storno sulla riga del detentore (lib/storno-dva). Se DVA la risulta gia' cancellata
    // l'ha gia' annullata e rimborsata lei: si chiudono le altre righe (rimborso dalla coda).
    case 'easyparcel': {
      const { richiediStornoDva } = await import('@/lib/storno-dva')
      let r
      try { r = await richiediStornoDva(admin, det, da) }
      catch (err: any) { r = { azione: 'manuale' as const, codice: 'errore', messaggio: err?.message || 'errore storno' } }
      if (r.azione === 'gia_cancellato') {
        await chiudiRigheFerme(admin, p, da)
        return { esito: 'annullata' }
      }
      if (r.azione === 'richiesto') {
        await segnaGambeInCoda(admin, p, { da, quando: new Date().toISOString() })
        return { esito: 'coda', storno: true }
      }
      if (r.azione === 'saltata') return { esito: 'rifiutata', motivo: r.messaggio || 'il pacco risulta già affidato al corriere' }
      await mettiInCodaDetentore(admin, p, { da, errore: r.messaggio ? `Storno DVA non possibile: ${r.messaggio}`.slice(0, 200) : null })
      return { esito: 'coda', storno: false }
    }
    // Corrieri che si annullano solo subito (BRT diretto, Ecosmos, Spring): o adesso o mai, come dal portale.
    case 'brt':
    case 'ecosmos':
    case 'spring': {
      const e = await annullaSpedizioneSulCorriere(admin, det)
      if (e.ok) return annullaTutto(admin, p, da)
      return { esito: 'rifiutata', motivo: e.reason || 'il corriere non consente la cancellazione in questo momento' }
    }
    default: {
      // SpediamoPro e FedEx: dal portale aspettano 48 ore, il giro delle 48 ore manda l'annullo vero.
      if (ANNULLO_VERO_A_48_ORE.has(corr.tipo)) {
        if (corr.tipo === 'spediamopro' && det.created_at &&
            new Date(det.created_at).getTime() < Date.now() - 15 * 24 * 60 * 60 * 1000) {
          return { esito: 'rifiutata', motivo: MSG_15_GIORNI }
        }
        if (!opz.subito) return { esito: 'attesa' }
        const e = await annullaSpedizioneSulCorriere(admin, det)
        if (e.ok) return annullaTutto(admin, p, da)
        return { esito: 'rifiutata', motivo: e.reason || 'spedizione già spedita o chiusa in distinta' }
      }
      // Dielle (nessun annullo via API) e ogni tipo senza un annullo vero: coda del detentore.
      await mettiInCodaDetentore(admin, p, { da, errore: null })
      return { esito: 'coda', storno: false }
    }
  }
}

// IL CONTROLLO DI OGNI MATTINA (Sentinella, app/api/controllo/sentinella). L'annullo per pacco si rompe senza
// errori visibili: una riga rimasta addebitata sotto un detentore annullato non la nota nessuno (026031010041765,
// Atlantik, otto giorni), e una coda senza owner non compare da nessuna parte (tre DVA dal 15/10). Quindi si
// contano gli effetti, non i log.
export async function controlloAnnulliPacco(admin: any): Promise<{ area: string; controllo: string; valore: number; atteso: string; allarme: boolean }[]> {
  const area = 'annulli dei pacchi fra reti'
  const ora = Date.now()
  const conta = async (q: any) => { const { count, error } = await q; if (error) throw new Error(error.message); return count || 0 }

  // 1. Righe che il trigger non e' riuscito a far seguire al detentore (scripts/gambe-seguono-detentore.sql).
  const anomalie = await conta(admin.from('gambe_pacco_anomalie').select('id', { count: 'exact', head: true })
    .gte('at', new Date(ora - 48 * 3600000).toISOString()))

  // 2. Code manuali senza owner sulla riga con la LDV vera: non le vede e non le chiude nessuno.
  const { data: veri, error: ev } = await admin.from('corrieri').select('id').neq('tipo', 'moovexpress')
  if (ev) throw new Error('contratti non leggibili: ' + ev.message)
  const idVeri = (veri || []).map((c: any) => c.id)
  let senzaOwner = 0
  for (let i = 0; i < idVeri.length; i += 200) {
    senzaOwner += await conta(admin.from('spedizioni').select('id', { count: 'exact', head: true })
      .eq('stato', 'annullamento_manuale').is('annullamento_owner_id', null).in('corriere_id', idVeri.slice(i, i + 200)))
  }

  // 3. Righe a valle ancora ferme (quindi addebitate) sotto un detentore annullato negli ultimi 3 giorni.
  const { data: annullate, error: ea } = await admin.from('spedizioni').select('id,tracking_number')
    .eq('stato', 'annullata').gte('updated_at', new Date(ora - 3 * 86400000).toISOString())
    .is('raw_response->>venditore_spedizione_id', null).not('tracking_number', 'is', null).limit(2000)
  if (ea) throw new Error('annullate non leggibili: ' + ea.message)
  const { gambePerTracking } = await import('@/lib/condivisione-catena')
  const perTrk = await gambePerTracking(admin, (annullate || []).map((s: any) => s.tracking_number))
  const idDet = new Set((annullate || []).map((s: any) => s.id))
  const sotto: string[] = []
  for (const legs of perTrk.values()) {
    if (legs.length < 2) continue
    for (const g of legs) if (g.venditoreSpedizioneId && !idDet.has(g.spedizioneId)) sotto.push(g.spedizioneId)
  }
  let ferme = 0
  for (let i = 0; i < sotto.length; i += 200) {
    ferme += await conta(admin.from('spedizioni').select('id', { count: 'exact', head: true })
      .in('id', sotto.slice(i, i + 200)).in('stato', STATI_FERMI))
  }

  // 4. Richieste chiuse dal giro delle 48 ore perche' il ripristino e' stato rifiutato (stesso ordine rispedito):
  //    restano addebitate e "in annullamento", la decisione e' di una persona.
  const bloccate = await conta(admin.from('spedizioni').select('id', { count: 'exact', head: true })
    .eq('stato', 'annullamento_pending').is('annullamento_richiesto_at', null))

  return [
    { area, controllo: 'righe che non hanno seguito il detentore (ultime 48 ore)', valore: anomalie, atteso: '0', allarme: anomalie > 0 },
    { area, controllo: 'annulli in coda manuale senza detentore (non li vede nessuno)', valore: senzaOwner, atteso: '0', allarme: senzaOwner > 0 },
    { area, controllo: 'righe ancora addebitate sotto un detentore annullato (ultimi 3 giorni)', valore: ferme, atteso: '0', allarme: ferme > 0 },
    { area, controllo: 'annulli fermi: rifiutati dal corriere e non ripristinabili (stesso ordine rispedito)', valore: bloccate, atteso: '0', allarme: bloccate > 0 },
  ]
}
