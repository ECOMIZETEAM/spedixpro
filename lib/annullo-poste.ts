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
// Un posto solo per tre porte: il cron delle 48 ore (annullamenti-cron), la sorveglianza (bonifica-poste,
// che legge poste.it) e lo script dell'arretrato.

import { risolviGambeSpedizione, type GambaSpedizione } from '@/lib/condivisione-catena'
import { rimborsaAnnulloSpedizione } from '@/lib/annullaSpedizione'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'

// "Il pacco e' nelle mani del corriere". "spedita" da sola NON conta: su questi contratti e' spesso solo
// la LDV accettata, senza scansione. Stesso elenco della guardia della coda d'annullo nel tracking
// (app/api/tracking/aggiorna) e di annulli-recupero-cron.
export const STATI_PARTITA = ['in_transito', 'in_consegna', 'consegnata', 'in_giacenza', 'non_consegnato', 'reso_mittente']
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

// Il pacco si e' mosso? Si guarda TUTTO il pacco (ogni gamba), perche' il tracking arriva sulla gamba
// del detentore da poste.it e scende alle altre dai ponti: basta che una delle due cose lo dica.
export async function paccoPartito(admin: any, gambe: GambaSpedizione[]): Promise<{ partito: boolean; quando: string | null }> {
  const ids = gambe.map(g => g.spedizioneId)
  if (!ids.length) return { partito: false, quando: null }
  const { data: ev } = await admin.from('tracking_events').select('data_evento')
    .in('spedizione_id', ids).in('stato', STATI_PARTITA).order('data_evento', { ascending: true }).limit(1)
  if (ev?.length) return { partito: true, quando: ev[0].data_evento || null }
  const { data: righe } = await admin.from('spedizioni').select('stato').in('id', ids).in('stato', STATI_PARTITA).limit(1)
  return { partito: !!righe?.length, quando: null }
}

// ANNULLO: tutte le gambe annullate, poi lo storno di ciascuna con la funzione di sempre (idempotente,
// segno opposto all'addebito, rettifiche comprese). Sui pacchi condivisi stornare la sola gamba del
// cliente lascerebbe addebitati i master sopra: e' la trappola del 5/10 (Epos Caffe').
// `richiestoAt` resta sulla riga annullata: da li' partono i 30 giorni di sorveglianza.
export async function annullaPaccoPoste(
  admin: any, gambe: GambaSpedizione[], rich: { richiestoAt?: string | null; da?: string | null },
): Promise<{ gambe: number }> {
  const ids = gambe.map(g => g.spedizioneId)
  const { data: righe } = await admin.from('spedizioni').select('id,numero,dest_nome,stato,stato_precedente').in('id', ids)
  const quando = rich.richiestoAt || new Date().toISOString()
  for (const r of (righe || [])) {
    if (r.stato === 'annullata') continue
    await admin.from('spedizioni').update({
      stato: 'annullata',
      // Della gamba in attesa conta lo stato di prima della richiesta; le altre non erano in attesa.
      stato_precedente: r.stato === 'annullamento_pending' ? (r.stato_precedente || 'in_lavorazione') : r.stato,
      annullamento_richiesto_at: quando,
      annullamento_da: rich.da || null,
      annullamento_errore: null,
    }).eq('id', r.id)
  }
  for (const r of (righe || [])) await rimborsaAnnulloSpedizione(admin, r, rich.da || null)
  // Lo store non deve restare con l'ordine "Fulfilled" e un tracking morto (vedi lib/shopify).
  try { const { annullaFulfillmentShopify } = await import('@/lib/shopify'); await annullaFulfillmentShopify(admin, ids) } catch {}
  return { gambe: (righe || []).length }
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
