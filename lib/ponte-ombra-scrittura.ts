import { createAdminSupabase } from '@/lib/supabase-admin'
import { conMemoRichiesta } from '@/lib/memo-richiesta'
import { valutaLivelloV1 } from '@/lib/v1-livello'
import { filaDelPonte } from '@/lib/ponte-unico'
import { colliDellOrigine } from '@/lib/ponte-ombra'
import {
  richiesteDellaFila, pianoDellaFila, prenotazioniDellaFila, vaPrenotato, completaPiano, opsAddebitoClientePortale, opMaster,
  SEGNO_LDV, type LivelloDaScrivere, type OpPonte,
} from '@/lib/ponte-scrittura'
import { rigaTestaCondivisa } from '@/lib/ponte-riga-origine'
import { rigaV1 } from '@/lib/v1-riga'
import { movimentiAlbero } from '@/lib/condivisione-catena'

// LA SCRITTURA UNICA, A VUOTO, SUI CONDIVISI VERI (fase 3 di PONTE-UNICO.md, «Come si verifica prima di accendere»).
//
// Per un condiviso gia' nato con la staffetta: si prepara il piano del ponte unico con le stesse funzioni che userebbe
// davvero, lo si scrive nel database con ponte_scrivi in prova (righe, movimenti, automatismi: tutto, poi annullato), e
// si confronta campo per campo con quello che la staffetta ha scritto davvero. Si accende solo con zero differenze.
//
// Cosa NON si prova qui, e perche':
// - la LDV: non se ne compra una seconda. Si usano il numero e la risposta del corriere della gamba vera, e al posto
//   dell'etichetta (300 KB, la stessa in tutte le righe: verificato il 21/11) un PDF finto di pochi byte; si confronta
//   che ci sia dove c'e' nella staffetta;
// - la richiesta del portale: non si conserva, si ricompone dalla prima gamba (indirizzi col «presso», come li ha
//   ricevuti il primo venditore) e dalla riga del cliente. La riga del cliente ricomposta da se stessa dice poco: di
//   lei contano il prezzo del primo venditore, la modalita' del contrassegno, la risposta del venditore e i movimenti;
// - chi ha creato: col cliente, l'addebito del cliente; senza, una spedizione propria del master. Una spedizione per
//   conto di un sotto-master risulta come differenza (rara, e nota).

type Admin = ReturnType<typeof createAdminSupabase>
export type DifferenzaScrittura = { cosa: string; livello?: number; campo?: string; atteso?: any; vero?: any }
export type EsitoScrittura = { esito: 'uguale' | 'diverso' | 'errore' | 'saltata'; differenze: DifferenzaScrittura[]; ms: number; righe: number; movimenti: number }

const ETICHETTA_FINTA = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 ponte unico, prova in ombra').toString('base64')}`
const SUFFISSO = '~ombra'
const num = (x: any) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : undefined }
const nuovoId = () => crypto.randomUUID()

// Campi che cambiano dopo la creazione per conto di altri giri (tracking, etichetta, ritiro prenotato dopo dal portale),
// o che la prova cambia apposta (numero e riferimento d'ordine, col suffisso): si confrontano a parte o non si confrontano.
const A_PARTE = new Set(['id', 'stato', 'etichetta_url', 'numero', 'rif_ordine', 'raw_response', 'colli_dettaglio'])
const RITIRO = new Set(['richiedi_ritiro', 'data_ritiro', 'intervallo_ritiro'])

function normale(v: any): any {
  if (v === undefined) return null
  if (typeof v === 'number') return Math.round(v * 10000) / 10000
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 20) return Math.round(Number(v) * 10000) / 10000
  if (Array.isArray(v)) return v.map(normale)
  if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v).sort()) o[k] = normale(v[k]); return o }
  return v
}
const uguali = (a: any, b: any) => JSON.stringify(normale(a)) === JSON.stringify(normale(b))
const senzaSuffisso = (x: any) => (typeof x === 'string' ? x.split(SUFFISSO).join('') : x)
// Le etichette nel dettaglio colli: conta che ci siano, non i byte (quelli finti in prova).
const colliSenzaEtichetta = (c: any) => (Array.isArray(c) ? c.map((x: any) => ({ ...x, etichetta_url: !!x?.etichetta_url })) : c)

// Le colonne che il piano scrive: quelle delle due righe (livello e cliente), lette da una prova a secco dei costruttori.
let _colonne: string[] | null = null
function colonneDelPiano(): string[] {
  if (_colonne) return _colonne
  const body = { shipFrom: {}, shipTo: {} }
  const a = rigaV1({
    cliente: {}, ctx: { clienteId: '' }, numero: '', masterId: '', corriere: {}, body, pressoFrom: '', pressoTo: '', puntoConsegna: null,
    packages: [{}], pesoReale: 1, ris: {}, pkg: {}, codModeUsata: null, etichettaUrl: null, colliDettaglio: null, raw: null,
    costoCorrente: 0, costoCliente: 0, ritiroPrenotato: false, _dataRitiro: '', _pomeriggio: false,
  }).riga
  const b = rigaTestaCondivisa({
    masterId: '', clienteId: null, corriereRecord: {}, numeroFinale: '', body, packages: [{}], pesoReale: 1, pesoVolCalc: 0, pesoFattCalc: 0,
    pkg: {}, ris: {}, etichettaUrl: null, costoCorrente: 0, costoCliente: 0, serviziAccessori: null, _vuoleRitiro: false, _pomeriggio: false,
  })
  _colonne = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(c => c !== 'etichetta_url')
  return _colonne
}

export async function provaScritturaInOmbra(admin: Admin, o: { id: string; tracking_number: string; master_id: string; corriere_id: string }, nomeContratto: string): Promise<EsitoScrittura> {
  const t0 = Date.now()
  const fine = (esito: EsitoScrittura['esito'], differenze: DifferenzaScrittura[], righe = 0, movimenti = 0): EsitoScrittura =>
    ({ esito, differenze, ms: Date.now() - t0, righe, movimenti })
  try {
    return await conMemoRichiesta(async () => {
      const colonne = colonneDelPiano()
      const [{ fila, errore }, { data: vere, error: eV }, { data: ponteOrigine }] = await Promise.all([
        filaDelPonte(admin, o.master_id, nomeContratto, o.corriere_id),
        admin.from('spedizioni').select([...new Set(['id', 'cliente_id', 'corriere_id', 'master_id', 'created_at', ...colonne])].join(','))
          .eq('tracking_number', o.tracking_number).limit(10),
        admin.from('corrieri').select('id,nome_contratto').eq('id', o.corriere_id).maybeSingle(),
      ])
      if (eV) throw new Error('righe: ' + eV.message)
      if (errore || !fila.length) return fine('errore', [{ cosa: 'fila', vero: errore || 'vuota' }])
      const R: any = (vere || []).find((r: any) => r.id === o.id)
      if (!R) return fine('errore', [{ cosa: 'riga del cliente non trovata' }])
      // Nata dall'API pubblica: la riga del cliente la scrive /api/v1/shipments (rigaV1), non la creazione dal portale. Il
      // ponte unico parte dal portale (3.217 condivisi su 3.432 al giorno, 20/11); l'API viene dopo, con la sua prova.
      if (R.canale === 'api') return fine('saltata', [{ cosa: 'origine API: si prova quando il ponte unico arriva all\'API' }])
      const usate = new Set<string>([R.id])
      const gambe: any[] = fila.map(l => {
        const g = (vere || []).find((r: any) => !usate.has(r.id) && r.cliente_id === l.clienteId && r.corriere_id === l.corriereId)
        if (g) usate.add((g as any).id)
        return g
      })
      if (gambe.some(g => !g)) return fine('errore', [{ cosa: 'gamba vera mancante', vero: gambe.map(g => !!g) }])
      if ((vere || []).length !== fila.length + 1) return fine('errore', [{ cosa: 'righe vere', atteso: fila.length + 1, vero: (vere || []).length }])

      // La richiesta del portale al primo venditore, ricomposta: indirizzi dalla prima gamba (come li ha ricevuti), il
      // resto dalla riga del cliente. Stessa forma di quella della creazione (app/api/spedizioni/crea, ramo moovexpress).
      const g1 = gambe[0]
      const indirizzo = (r: any, pre: 'dest' | 'mitt') => ({
        name: r[`${pre}_nome`], street1: r[`${pre}_indirizzo`], ...(r[`${pre}_presso`] ? { presso: r[`${pre}_presso`] } : {}),
        city: r[`${pre}_citta`], state: r[`${pre}_provincia`], postalCode: r[`${pre}_cap`],
        ...(r[`${pre}_email`] ? { email: r[`${pre}_email`] } : {}), ...(r[`${pre}_telefono`] ? { phone: r[`${pre}_telefono`] } : {}),
      })
      const colli = await colliDellOrigine(admin, { id: R.id, colli: R.colli, peso_reale: R.peso_reale, lunghezza: R.lunghezza, larghezza: R.larghezza, altezza: R.altezza })
      const packages = colli.map((p: any) => ({
        weight: parseFloat(p?.weight) || 1, length: parseFloat(p?.length) || undefined, width: parseFloat(p?.width) || undefined, height: parseFloat(p?.height) || undefined,
      }))
      const codValue = num(R.contrassegno)
      const vuoleRitiro = !!R.richiedi_ritiro && !!R.data_ritiro
      const pomeriggio = String(R.intervallo_ritiro || '').startsWith('14')
      const dati1 = {
        packages, shipFrom: indirizzo(g1, 'mitt'), shipTo: { ...indirizzo(g1, 'dest'), country: g1.dest_paese || 'IT' },
        codValue, ...(codValue && R.contrassegno_modalita ? { incassoModalita: String(R.contrassegno_modalita) } : {}),
        insuranceValue: num(R.assicurazione), notes: R.note || undefined, contenuto: R.contenuto || undefined,
        rifOrdine: String(R.rif_ordine || '').trim() || undefined,
        pickup: vuoleRitiro ? { requested: true, date: String(R.data_ritiro), time: pomeriggio ? 'pomeriggio' : 'mattina' } : undefined,
      }

      // Tutta la fila, come la farebbe il ponte unico: la richiesta di ogni livello, i controlli insieme, il piano.
      const corpi = richiesteDellaFila(dati1, fila.length)
      const valutazioni = await Promise.all(fila.map((l, k) => valutaLivelloV1(admin, { clienteId: l.clienteId, corriereId: l.corriereId }, corpi[k], { soloValuta: true })))
      const rifiuto = valutazioni.findIndex(v => v instanceof Response)
      if (rifiuto >= 0) {
        const r = valutazioni[rifiuto] as Response
        const j: any = await r.json().catch(() => ({}))
        return fine('diverso', [{ cosa: 'livello rifiutato', livello: rifiuto + 1, atteso: `${r.status} ${j?.error || ''}` }])
      }
      const livelli: LivelloDaScrivere[] = fila.map((l, k) => {
        const v = valutazioni[k] as Exclude<typeof valutazioni[number], Response>
        return { l, body: corpi[k], v, id: nuovoId(), prenotazione: vaPrenotato(v) ? `PRE:${nuovoId()}` : null }
      })
      const piano = await pianoDellaFila(admin, livelli)

      // La riga del cliente e i suoi addebiti, come la creazione dal portale.
      const { data: movVeri, error: eM } = await admin.from('movimenti')
        .select('spedizione_id,master_id,master_target_id,cliente_id,tipo,importo,descrizione,riferimento,conto,created_by,created_at')
        .in('spedizione_id', [R.id, ...gambe.map(g => g.id)])
      if (eM) throw new Error('movimenti: ' + eM.message)
      const finestra = Date.parse(R.created_at) + 10 * 60e3
      const movCreazione = (movVeri || []).filter((m: any) => ['spedizione', 'commissione'].includes(m.tipo) && Date.parse(m.created_at) <= finestra)
      const userId = (movCreazione.find((m: any) => m.spedizione_id === R.id && m.created_by) as any)?.created_by || null
      const corpoPortale = {
        shipFrom: { name: R.mitt_nome, street1: R.mitt_indirizzo, city: R.mitt_citta, state: R.mitt_provincia, postalCode: R.mitt_cap, email: R.mitt_email || undefined, phone: R.mitt_telefono || undefined },
        shipTo: { name: R.dest_nome, street1: R.dest_indirizzo, city: R.dest_citta, state: R.dest_provincia, postalCode: R.dest_cap, country: R.dest_paese || 'IT', email: R.dest_email || undefined, phone: R.dest_telefono || undefined },
        codValue: R.contrassegno || 0, insuranceValue: R.assicurazione || 0, notes: R.note || undefined, contenuto: R.contenuto || undefined,
        rifOrdine: R.rif_ordine || undefined, rifDestinatario: R.rif_destinatario || undefined, dataRitiro: R.data_ritiro || undefined,
      }
      const idOrigine = nuovoId()
      const serviziAccessori = Array.isArray(R.servizi_accessori) ? R.servizi_accessori : []
      const rigaOrigine = rigaTestaCondivisa({
        masterId: R.master_id, clienteId: R.cliente_id, corriereRecord: { id: R.corriere_id }, numeroFinale: piano.risposta.tracking,
        body: corpoPortale, packages, pesoReale: Number(R.peso_reale) || 1, pesoVolCalc: Number(R.peso_volume) || 0,
        pesoFattCalc: Number(R.peso_fatturato) || 0, pkg: packages[0], ris: piano.risposta, etichettaUrl: piano.etichettaPerOrigine,
        costoCorrente: piano.risposta.prezzo, costoCliente: Number(R.costo_totale) || 0, serviziAccessori: R.servizi_accessori,
        _vuoleRitiro: !!R.richiedi_ritiro, _pomeriggio: pomeriggio,
      })
      const prenotazioneOrigine = R.cliente_id ? `PRE:${nuovoId()}` : null
      const costoOrigine = Number(R.costo_totale) || 0
      const albero = await movimentiAlbero(admin, {
        masterOriginante: R.master_id, nomeContratto: (ponteOrigine as any)?.nome_contratto || nomeContratto,
        dest: { cap: corpoPortale.shipTo.postalCode, provincia: corpoPortale.shipTo.state, citta: corpoPortale.shipTo.city, paese: corpoPortale.shipTo.country || 'IT' },
        packages, contrassegno: Number(corpoPortale.codValue || 0), assicurazione: Number(corpoPortale.insuranceValue || 0),
        serviziAccessori: serviziAccessori.map((a: any) => ({ nome: typeof a === 'string' ? a : a?.nome })),
        mittCap: corpoPortale.shipFrom.postalCode, mittProvincia: corpoPortale.shipFrom.state, mittPaese: 'IT',
        numero: SEGNO_LDV, destNome: corpoPortale.shipTo.name || '', spedizioneId: idOrigine, createdBy: userId,
      })

      const prenotazioni: OpPonte[] = [
        ...(prenotazioneOrigine && costoOrigine > 0 ? [{
          op: 'prenota' as const, livello: 0, master_id: R.master_id, cliente_id: R.cliente_id,
          descrizione: `Prenotazione ${String(corpoPortale.shipTo.name || '').slice(0, 40)}`.trim(), importo: -Math.abs(costoOrigine),
          riferimento: prenotazioneOrigine, created_by: userId,
        }] : []),
        ...prenotazioniDellaFila(livelli),
      ]
      const tutte: OpPonte[] = [
        ...piano.ops,
        { op: 'spedizione', riga: JSON.parse(JSON.stringify({ id: idOrigine, ...rigaOrigine })) },
        ...opsAddebitoClientePortale({
          isProprio: !R.cliente_id, masterSub: null, prenotazioneRif: costoOrigine > 0 ? prenotazioneOrigine : null, costo: costoOrigine,
          masterId: R.master_id, clienteId: R.cliente_id, numeroSped: SEGNO_LDV, destNome: corpoPortale.shipTo.name, spedizioneId: idOrigine, userId,
        }),
        ...albero.movimenti.map(opMaster),
      ]
      // Ogni prenotazione subito prima della sua conferma: la prova tocca le righe dei conti nello stesso ordine della
      // scrittura vera (dal detentore in su, come la staffetta). Tutte all'inizio, dall'alto, il 21/11 una prova si e'
      // incrociata (deadlock) con un'altra scrittura del ponte: due transazioni che prendono le stesse righe in ordine
      // diverso possono bloccarsi a vicenda.
      const ops: OpPonte[] = []
      for (const o of tutte) {
        if (o.op === 'conferma') { const pr = prenotazioni.find((x: any) => x.riferimento === o.riferimento); if (pr) ops.push(pr) }
        ops.push(o)
      }
      const detentore = gambe[gambe.length - 1]
      const completo = completaPiano({ id: idOrigine, ops }, { numero: o.tracking_number, etichettaUrl: ETICHETTA_FINTA, raw: detentore.raw_response })

      const [{ data: prova, error: eP }, { data: impronte, error: eI }] = await Promise.all([
        admin.rpc('ponte_scrivi', { p_piano: completo, p_prova: true }),
        admin.rpc('ponte_etichette', { p_tracking: o.tracking_number }),
      ])
      if (eP) return fine('errore', [{ cosa: 'scrittura in prova', vero: eP.message }])
      if (eI) throw new Error('etichette: ' + eI.message)

      // ── Il confronto ──
      const differenze: DifferenzaScrittura[] = []
      const idProva = [idOrigine, ...livelli.map(L => L.id)]
      const idVeri = [R.id, ...gambe.map(g => g.id)]
      const versoVero = (x: any) => { let s = JSON.stringify(x ?? null); idProva.forEach((id, i) => { s = s.split(id).join(idVeri[i]) }); return JSON.parse(s) }
      const righeProva = new Map<string, any>(((prova as any)?.righe || []).map((r: any) => [r.id, r]))
      const pianoRighe = new Map<string, any>(completo.ops.filter((x: any) => x.op === 'spedizione').map((x: any) => [x.riga.id, x.riga]))
      const etichettaVera = new Map<string, number>(((impronte as any[]) || []).map((e: any) => [e.id, Number(e.lunghezza) || 0]))
      idProva.forEach((idP, livello) => {
        const p = righeProva.get(idP), v: any = (vere || []).find((r: any) => r.id === idVeri[livello]), scritta = pianoRighe.get(idP)
        if (!p || !v || !scritta) { differenze.push({ cosa: 'riga', livello, atteso: !!p, vero: !!v }); return }
        for (const campo of Object.keys(scritta)) {
          if (A_PARTE.has(campo) || (livello === 0 && RITIRO.has(campo))) continue
          if (!uguali(p[campo], v[campo])) differenze.push({ cosa: 'campo', livello, campo, atteso: p[campo], vero: v[campo] })
        }
        if (senzaSuffisso(p.numero) !== v.numero) differenze.push({ cosa: 'campo', livello, campo: 'numero', atteso: senzaSuffisso(p.numero), vero: v.numero })
        if ((senzaSuffisso(p.rif_ordine) || null) !== (v.rif_ordine || null)) differenze.push({ cosa: 'campo', livello, campo: 'rif_ordine', atteso: senzaSuffisso(p.rif_ordine), vero: v.rif_ordine })
        if (!uguali(versoVero(p.raw_response), v.raw_response)) differenze.push({ cosa: 'campo', livello, campo: 'raw_response', atteso: versoVero(p.raw_response), vero: v.raw_response })
        if (!uguali(colliSenzaEtichetta(p.colli_dettaglio), colliSenzaEtichetta(v.colli_dettaglio))) differenze.push({ cosa: 'campo', livello, campo: 'colli_dettaglio', atteso: colliSenzaEtichetta(p.colli_dettaglio), vero: colliSenzaEtichetta(v.colli_dettaglio) })
        if ((Number(p.etichetta_lunghezza) > 0) !== ((etichettaVera.get(v.id) || 0) > 0)) differenze.push({ cosa: 'etichetta', livello, atteso: Number(p.etichetta_lunghezza) > 0, vero: (etichettaVera.get(v.id) || 0) > 0 })
      })

      const livelloDi = (ids: string[]) => (id: string) => ids.indexOf(id)
      const chiave = (m: any, livello: number) => [
        livello, m.tipo, m.master_id, m.master_target_id || '', m.cliente_id || '', (Math.round(Number(m.importo) * 100) / 100).toFixed(2),
        m.conto || '', senzaSuffisso(m.descrizione || ''), senzaSuffisso(m.riferimento || ''), m.created_by || '',
      ].join('|')
      const lp = livelloDi(idProva), lv = livelloDi(idVeri)
      const restanti = new Map<string, number>()
      for (const m of movCreazione as any[]) { const k = chiave(m, lv(m.spedizione_id)); restanti.set(k, (restanti.get(k) || 0) + 1) }
      const movProva: any[] = (prova as any)?.movimenti || []
      for (const m of movProva) {
        const k = chiave(m, lp(m.spedizione_id)), n = restanti.get(k) || 0
        if (n > 0) restanti.set(k, n - 1)
        else differenze.push({ cosa: 'movimento solo in prova', livello: lp(m.spedizione_id), atteso: k })
      }
      for (const [k, n] of restanti) for (let i = 0; i < n; i++) differenze.push({ cosa: 'movimento solo nella staffetta', vero: k })

      // Le righe del log [LIVELLO NON ADDEBITATO]: qui non si scrivono (in ombra si conterebbero doppie), si segnalano.
      for (const r of [...piano.nonAddebitati, ...albero.nonAddebitati]) differenze.push({ cosa: 'livello non addebitato', atteso: r.slice(0, 200) })
      return fine(differenze.length ? 'diverso' : 'uguale', differenze, righeProva.size, movProva.length)
    })
  } catch (e: any) {
    return fine('errore', [{ cosa: 'eccezione', vero: String(e?.message || e).slice(0, 300) }])
  }
}
