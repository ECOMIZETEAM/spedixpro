/* CONTROLLO FATTURA GLS: il borderò (o l'allegato della fattura) di GLS confrontato, spedizione per
 * spedizione, con quello che Moove ha registrato come COSTO al detentore del contratto. Stesso giro e stesse
 * tre cifre del controllo BRT (lib/controllo-fattura): GLS, Moove, e il listino del detentore rifatto sul
 * peso di GLS. Cambiano la lettura (il PDF, lib/fattura-gls) e le voci.
 *
 * La differenza GLS − Moove si divide in parti che sommano esatte:
 *   peso       = listino al peso di GLS − listino al peso di Moove → GLS ha pesato o misurato di più: si gira
 *                ai clienti. Tutti e due col listino di OGGI: il listino "GLS NI W" il 06/11 ha perso la fascia
 *                fino a 5 kg (ora parte da 7 kg a 5,25 €), e confrontando il listino di oggi col costo di allora
 *                1 kg diventava "pesato di più" su 725 pacchi che GLS aveva tassato 1 kg come Moove
 *                Lo scarto fra il listino di oggi e il costo registrato (listino cambiato dopo) NON è un motivo a
 *                sé: su 260 righe di ottobre dava +1,80 € "listino cambiato" e −1,80 € "listino più alto di GLS",
 *                che si annullano e non spiegano un euro. Si scrive nel testo della tariffa.
 *   carburante = la parte di carburante oltre quella del listino (il contratto di Wave dice 3%; a ottobre
 *                GLS ha messo il 12%): da contestare a GLS
 *   voce       = varie e servizi aggiuntivi di GLS, ognuno col suo nome e con cosa farne (lib/fattura-gls)
 *   tariffa    = il resto: a parità di peso, GLS contro il costo registrato in Moove.
 * A parte, fuori dalla somma, `scartoListino`: GLS contro il listino di OGGI allo stesso peso. È quello che la
 * pagina mette in "Cosa allineare nel listino", perché è il listino di oggi che fa il costo delle prossime.
 *
 * DUE DIFFERENZE DA BRT, entrambe trovate sui numeri veri di novembre:
 *  - si abbina per TRACKING e non per riferimento. Sui contratti condivisi lo stesso pacco ha due righe in
 *    Moove: quella di chi spedisce (NI665645497) e la gamba del detentore (NI665645497-1d6ac50d), ed è sulla
 *    gamba che sta il costo del detentore. Cercando per numero, 1.535 pacchi su 2.789 risultavano a costo 0.
 *    Il costo è la somma dei movimenti del detentore su TUTTE le righe di quel tracking.
 *  - i servizi (l'Exchange) stanno DENTRO il costo registrato (4,61 = 3,61 + 1 di Exchange): il listino si
 *    rifà con gli stessi servizi (accessoriDelLivello, la funzione della creazione) e la colonna servizi di
 *    GLS si confronta col prezzo del servizio nel listino. Senza, ogni Exchange dava +1 € di "voce" e −1 €
 *    di "listino" che si annullavano (53 righe a novembre).
 *
 * Solo lettura: qui non si scrive niente. L'addebito ai clienti passa dalla Rettifica, come per BRT. */
import { calcolaPrezzoCorriereDettaglio, type DettaglioCorriere } from '@/lib/pricing'
import { accessoriDelLivello } from '@/lib/cascata'
import { movimentiDelNolo } from '@/lib/ripesature-calcolo'
import { descriviVoceGls, VOCI_GLS, type AllineaGls, type ParteAllinea, type RigaFatturaGls } from '@/lib/fattura-gls'
import type { CategoriaVoce } from '@/lib/fattura-brt'
import type { EsitoRiga, Motivo, SpedizioneAbbinata } from '@/lib/controllo-fattura'

const r2 = (n: number) => Math.round(n * 100) / 100
const kg = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
const euro = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const pct = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + '%'

// I movimenti del detentore che fanno il costo del pacco. Le rettifiche passano da movimentiDelNolo (la regola
// delle ripesature): fuori i costi di resi e giacenze del fornitore e gli storni dei resi, che col tipo
// 'rettifica' sembrerebbero nolo.
const TIPI_LETTI = ['spedizione', 'rettifica', 'reso', 'giacenza', 'rimborso', 'accessorio']
// «ENTRO ORE 12» PER ERRORE NOSTRO. Fino al 30/10/2026 (correzione 800db65a, rilasciata dopo le 10:03) Moove
// metteva la modalità del contrassegno nei servizi accessori GLS (01 contanti, dalla tabella che GLS ci aveva
// dato il 2/9); per GLS 01 è "consegna entro le 12", e lo stampava su ogni etichetta. I 12/22/32/42 € della
// colonna servizi (la "Sprinter" del borderò) sui contrassegni di quel periodo sono quello: verificato sulle
// etichette salvate di tutte e 16 le spedizioni di Wave (338 € a ottobre, 24 € a novembre). Non vanno chiesti a
// GLS: il servizio l'abbiamo chiesto noi.
const FINE_ERRORE_ENTRO_12 = '2026-10-30T09:30:00Z'
// Supabase taglia una risposta a 1.000 righe senza errore: arrivarci vuol dire che ne mancano.
const TETTO = 1000
// Sotto questo scarto la percentuale del carburante è la stessa: GLS la calcola su tutto il nolo del
// contratto e la stampa una volta, e a novembre esce 2,97% contro il 3% del listino.
const TOLLERANZA_CARBURANTE = 0.25

const COLONNE = 'id,numero,tracking_number,stato,cliente_id,master_id,corriere_id,created_at,colli,peso_reale,peso_fatturato,contrassegno,dest_cap,dest_provincia,dest_citta,dest_paese,servizi_accessori'
const aGruppi = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

async function aOndate<T, R>(items: T[], quanti: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(quanti, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

const conExchange = (s: any) => Array.isArray(s?.servizi_accessori) && s.servizi_accessori.some((x: any) => /exchange|cambio/i.test(String(x?.nome || '')))

export async function analizzaFatturaGls(
  admin: any,
  params: { contrattiIds: string[]; masterId: string; righe: RigaFatturaGls[] },
): Promise<EsitoRiga[]> {
  const { contrattiIds, masterId, righe } = params

  // I contratti del detentore su quel conto GLS e tutte le loro copie: sullo stesso conto passano anche le
  // spedizioni di chi compra il contratto.
  const { data: famiglia, error: errF } = await admin.from('corrieri').select('id,contratto_id').in('contratto_id', contrattiIds)
  if (errF) throw new Error('lettura contratti non riuscita: ' + errF.message)
  const radice = new Map<string, string>((famiglia || []).map((c: any) => [c.id, c.contratto_id]))
  for (const id of contrattiIds) radice.set(id, id)
  // Il nome di ogni contratto del detentore, che è anche il nome del suo listino ("GLS NI W", "GLS NI W LIGHT"):
  // in "Cosa allineare nel listino" dice QUALE listino toccare.
  const { data: propri, error: errP } = await admin.from('corrieri').select('id,nome_contratto').in('id', contrattiIds)
  if (errP) throw new Error('lettura contratti non riuscita: ' + errP.message)
  const nomeContratto = new Map<string, string>((propri || []).map((c: any) => [c.id, String(c.nome_contratto || '')]))
  const corrieriIds = Array.from(radice.keys())

  const perTracking = new Map<string, any[]>()
  for (const g of aGruppi(Array.from(new Set(righe.map(r => r.segnacollo).filter(Boolean))), 200)) {
    const { data, error } = await admin.from('spedizioni').select(COLONNE).in('tracking_number', g).in('corriere_id', corrieriIds)
    if (error) throw new Error('lettura spedizioni non riuscita: ' + error.message)
    if ((data || []).length >= TETTO) throw new Error('troppe spedizioni in una lettura: rischio di perderne')
    for (const s of data || []) { const v = perTracking.get(s.tracking_number) || []; v.push(s); perTracking.set(s.tracking_number, v) }
  }
  // La riga di chi ha spedito (numero = tracking) dà peso, destinazione, stato e cliente; le gambe no.
  const principale = (l: any[]) => l.find(s => s.numero === s.tracking_number) || l.find(s => !/-[0-9a-f]{8}$/.test(s.numero)) || l[0]

  // Il costo del detentore su tutte le righe del pacco: addebito, rettifiche di nolo, rimborsi, servizi.
  const ids = Array.from(perTracking.values()).flat().map(s => s.id)
  const movPerSped = new Map<string, any[]>()
  for (const g of aGruppi(ids, 100)) {
    const { data, error } = await admin.from('movimenti').select('spedizione_id,importo,cliente_id,master_id,master_target_id,tipo,riferimento')
      .eq('master_target_id', masterId).in('spedizione_id', g).in('tipo', TIPI_LETTI)
    if (error) throw new Error('lettura movimenti non riuscita: ' + error.message)
    if ((data || []).length >= TETTO) throw new Error('troppi movimenti in una lettura: rischio di perderne')
    for (const m of data || []) { const v = movPerSped.get(m.spedizione_id) || []; v.push(m); movPerSped.set(m.spedizione_id, v) }
  }
  const costoDi = (l: any[]) => {
    const mov = l.flatMap(s => movPerSped.get(s.id) || [])
    const nolo = movimentiDelNolo(mov.filter(m => m.tipo !== 'rimborso' && m.tipo !== 'accessorio'))
    const conta = [...nolo, ...mov.filter(m => m.tipo === 'rimborso' || m.tipo === 'accessorio')]
    // La parte del costo che viene da una rettifica confermata (peso o supplemento del corriere, RIPFORN-…): è già
    // stata girata a chi sta sotto (vedi «già girato» qui sotto).
    const rettificato = r2(conta.filter(m => String(m.riferimento || '').startsWith('RIPFORN-')).reduce((t, m) => t - Number(m.importo || 0), 0))
    return { costo: r2(conta.reduce((t, m) => t - Number(m.importo || 0), 0)), movimenti: conta.length, rettificato }
  }

  // QUANTO HA INCASSATO IL DETENTORE da chi sta sotto (Lorenzo, 25/11: per ogni spedizione "quanto ha pagato lui, il
  // cliente e quanto gli ha fatto pagare GLS"). Le stesse regole del margine del pacco (lib/rettifiche-margine-pacco):
  // il cliente diretto coi movimenti scritti dal detentore, il sotto-master figlio coi suoi movimenti d'albero e con
  // le rettifiche che il detentore gli ha addebitato. Sui contratti condivisi chi paga è il cliente "ingrosso" del
  // detentore, sulla gamba (NI…-1d6ac50d): si leggono tutte le righe del tracking, come per il costo.
  const { data: figli, error: errFi } = await admin.from('masters').select('id').eq('parent_master_id', masterId)
  if (errFi) throw new Error('lettura sotto-master non riuscita: ' + errFi.message)
  const idsFigli = (figli || []).map((m: any) => m.id as string)
  const incassiPerSped = new Map<string, any[]>()
  for (const g of aGruppi(ids, 100)) {
    const { data, error } = await admin.from('movimenti').select('spedizione_id,importo,cliente_id,master_id,master_target_id,tipo,riferimento')
      .in('spedizione_id', g).in('tipo', TIPI_LETTI)
      .or(`and(master_id.eq.${masterId},cliente_id.not.is.null)${idsFigli.length ? `,master_target_id.in.(${idsFigli.join(',')})` : ''}`)
    if (error) throw new Error('lettura incassi non riuscita: ' + error.message)
    if ((data || []).length >= TETTO) throw new Error('troppi movimenti in una lettura: rischio di perderne')
    for (const m of data || []) {
      if (!m.cliente_id && !(m.master_id === m.master_target_id || m.master_id === masterId)) continue
      const v = incassiPerSped.get(m.spedizione_id) || []; v.push(m); incassiPerSped.set(m.spedizione_id, v)
    }
  }
  const incassoDi = (l: any[]): { importo: number; chi: 'cliente' | 'master'; id: string } | null => {
    const mov = l.flatMap(s => incassiPerSped.get(s.id) || [])
    if (!mov.length) return null
    const nolo = movimentiDelNolo(mov.filter(m => m.tipo !== 'rimborso' && m.tipo !== 'accessorio'))
    const conta = [...nolo, ...mov.filter(m => m.tipo === 'rimborso' || m.tipo === 'accessorio')]
    const primo = mov.find(m => m.tipo === 'spedizione') || mov[0]
    return { importo: r2(conta.reduce((t, m) => t - Number(m.importo || 0), 0)), chi: primo.cliente_id ? 'cliente' : 'master', id: primo.cliente_id || primo.master_target_id }
  }

  // Il listino si rifà con la funzione dell'addebito. Quella, se una lettura non riesce, torna null come
  // quando la zona non ha prezzo: provato il 24/11 sul borderò del 23/11, 16 righe "senza prezzo" che rifatte
  // subito dopo davano 3,61 e 8,76 €. Un null si riprova una volta; un errore vero ferma il pacchetto (la
  // pagina dice "controllo interrotto") invece di diventare un motivo sbagliato.
  const memo = new Map<string, Promise<DettaglioCorriere | null>>()
  const listinoDi = (r: RigaFatturaGls, s: any, peso: number) => {
    const corriereId = radice.get(s.corriere_id) || contrattiIds[0]
    const cod = Number(s.contrassegno || 0)
    const k = [corriereId, s.dest_cap, s.dest_provincia, s.dest_citta, s.dest_paese, peso, cod].join('|')
    const calcola = () => calcolaPrezzoCorriereDettaglio(admin, {
      corriereId, masterId,
      provincia: String(s.dest_provincia || '').toUpperCase(), cap: s.dest_cap || '', citta: s.dest_citta || r.localita, paese: s.dest_paese || 'IT',
      pesoReale: peso, contrassegno: cod,
    })
    if (!memo.has(k)) memo.set(k, calcola().then(async d => d ?? (await new Promise(ok => setTimeout(ok, 400)), calcola())))
    return memo.get(k)!
  }

  // Le fasce "fino a" del listino del detentore, zona per zona, una lettura per contratto: dicono se il nolo
  // chiesto da GLS è il prezzo di un'ALTRA zona dello stesso listino. Sul borderò del 23/11 pacchi da 7 a 21 kg
  // "Italia" (Afragola, Giugliano, Pompei, Barra…) a cui GLS chiede 5,25 €, il prezzo della zona Napoli: senza
  // questo il controllo diceva "nel listino 8,00 €, GLS chiede 5,25 €" e invitava ad abbassare l'Italia. È solo un
  // suggerimento: se la lettura non riesce non c'è, e nessun numero cambia.
  const fasceMemo = new Map<string, Promise<{ zona: string; max: number; prezzo: number }[]>>()
  const fasceDi = (corriereId: string) => {
    if (!fasceMemo.has(corriereId)) fasceMemo.set(corriereId, (async () => {
      const { data: ls, error: e1 } = await admin.from('listini_corrieri').select('id').eq('master_id', masterId).eq('corriere_id', corriereId)
      if (e1 || !ls?.length) { if (e1) console.warn('[controllo-gls] fasce non lette', e1.message); return [] }
      const { data: f, error: e2 } = await admin.from('listini_corrieri_fasce').select('peso_max,prezzo,tipo,zone(nome)').in('listino_id', ls.map((l: any) => l.id)).eq('tipo', 'fino_a').limit(2000)
      if (e2) { console.warn('[controllo-gls] fasce non lette', e2.message); return [] }
      return (f || []).map((x: any) => ({ zona: String(x.zone?.nome || ''), max: Number(x.peso_max), prezzo: Number(x.prezzo) })).filter((x: { zona: string; max: number }) => x.zona && Number.isFinite(x.max))
    })())
    return fasceMemo.get(corriereId)!
  }
  const zoneColPrezzo = async (corriereId: string, zonaVista: string, peso: number, nolo: number) => {
    const perZona = new Map<string, { max: number; prezzo: number }>()
    for (const f of await fasceDi(corriereId)) {
      if (f.zona === zonaVista || f.max < peso - 1e-9) continue
      const v = perZona.get(f.zona); if (!v || f.max < v.max) perZona.set(f.zona, f)
    }
    return Array.from(perZona.entries()).filter(([, f]) => Math.abs(f.prezzo - nolo) < 0.005).map(([z]) => z)
  }

  return aOndate(righe, 8, async (r): Promise<EsitoRiga> => {
    const vociPerCategoria: Partial<Record<CategoriaVoce | 'nolo', number>> = { nolo: r.nolo }
    for (const v of r.voci) { const c = VOCI_GLS[v.sigla]?.categoria || 'altro'; vociPerCategoria[c] = r2((vociPerCategoria[c] || 0) + v.importo) }
    const gls = r.totale
    const tutte = perTracking.get(r.segnacollo)
    const base = { riga: r, abbinataPer: tutte ? 'segnacollo' as const : null, brt: r2(gls), vociPerCategoria }
    if (!tutte) return { ...base, spedizione: null, moove: null, listino: null, differenza: null, motivi: [] }

    const s = principale(tutte)
    const { costo: moove, movimenti: nMov, rettificato } = costoDi(tutte)
    const differenza = r2(gls - moove)
    const motivi: Motivo[] = []
    // La spedizione, col contratto (= il listino di costo) e quanto ha pagato chi sta sotto: valgono per ogni riga
    // trovata, anche per quelle che tornano al centesimo.
    const spedizione = s as SpedizioneAbbinata
    const conSped = { ...base, spedizione, contratto: nomeContratto.get(radice.get(s.corriere_id) || '') || '', incasso: incassoDi(tutte) }

    if (s.stato === 'annullata' && gls > 0) {
      motivi.push({ tipo: 'annullata', importo: differenza, gruppo: 'contestare', testo: `Annullata in Moove (costo rimborsato), ma GLS l'ha fatturata ${euro(gls)}: il pacco è partito lo stesso o l'annullo non è arrivato a GLS.` })
      return { ...conSped, moove, listino: null, differenza, motivi }
    }
    if (!r.andata) return { ...conSped, moove, listino: null, differenza, motivi }
    // Trovata, ma senza un movimento del detentore: il costo 0 non è un prezzo, è un costo che manca (così
    // 1.535 pacchi di novembre sembravano gratis prima di cercarli per tracking).
    if (!nMov) {
      motivi.push({ tipo: 'non_calcolabile', importo: differenza, gruppo: 'listino', testo: `In Moove non c'è il costo del detentore su questa spedizione: GLS ${euro(gls)}, costo registrato nessuno.` })
      return { ...conSped, moove, listino: null, differenza, motivi }
    }

    const pesoMoove = Number(s.peso_fatturato || s.peso_reale || 0)
    // GLS chiede quanto Moove ha registrato (al centesimo: GLS calcola il carburante sul totale del contratto e
    // la riga può uscire 3,60 contro 3,61): non c'è niente da spiegare né da girare, anche se il peso è diverso
    // (stessa fascia), e il listino non si rifà. Sono l'85% delle righe di novembre (2.417 su 2.789), e ogni
    // listino rifatto sono cinque letture sul database di produzione.
    if (Math.abs(differenza) < 0.015) return { ...conSped, moove, listino: null, differenza, motivi }
    const listino = await listinoDi(r, s, r.pesoTassato)
    if (!listino) {
      motivi.push({ tipo: 'non_calcolabile', importo: differenza, gruppo: 'listino', testo: `Il listino non dà un prezzo per ${s.dest_cap || ''} ${s.dest_citta || r.localita} a ${kg(r.pesoTassato)} kg: zona o fascia mancante (o una lettura non riuscita: ricaricando si rifà).` })
      return { ...conSped, moove, listino, differenza, motivi }
    }
    const listinoMoove = Math.abs(pesoMoove - r.pesoTassato) < 0.001 ? listino : await listinoDi(r, s, pesoMoove)
    // Senza il listino al peso di Moove l'effetto del peso non si separa: finirebbe tutto nella tariffa come
    // "listino più basso", e la spedizione non andrebbe alla Rettifica. Meglio dire che non si calcola.
    if (!listinoMoove) {
      motivi.push({ tipo: 'non_calcolabile', importo: differenza, gruppo: 'listino', testo: `Il listino non dà un prezzo per ${s.dest_cap || ''} ${s.dest_citta || r.localita} al peso di Moove (${kg(pesoMoove)} kg): l'effetto del peso di GLS non si può separare.` })
      return { ...conSped, moove, listino, differenza, motivi }
    }
    // I servizi chiesti (Exchange…) col prezzo del listino del detentore, come li somma la creazione.
    const corriereRadice = radice.get(s.corriere_id) || contrattiIds[0]
    const conServizi = Array.isArray(s.servizi_accessori) && s.servizi_accessori.length > 0
    const accessori = async (l: DettaglioCorriere | null) => conServizi && l ? (await accessoriDelLivello(admin, masterId, corriereRadice, s.servizi_accessori, l.nolo)).totale : 0
    const accG = await accessori(listino)
    const accM = listinoMoove === listino ? accG : await accessori(listinoMoove)
    const totG = r2(listino.totale + accG)                                   // listino di oggi al peso di GLS
    const totM = r2(listinoMoove.totale + accM)                              // e al peso di Moove

    // Il peso: solo se GLS ha tassato un peso diverso da quello di Moove, ed è quanto quel peso cambia il
    // prezzo del listino. Stesso peso, stesso listino: niente da girare a nessuno.
    let peso = 0
    if (Math.abs(r.pesoTassato - pesoMoove) >= 0.001) {
      peso = r2(totG - totM)
      const come = r.pesoVolume > r.pesoRilevato + 0.001 ? `misurato ${kg(r.pesoVolume)} kg di volume (reali ${kg(r.pesoRilevato)})` : `pesato ${kg(r.pesoRilevato)} kg`
      if (peso >= 0.01) motivi.push({ tipo: 'peso', importo: peso, gruppo: 'clienti', testo: `Moove ${kg(pesoMoove)} kg, GLS ha ${come}: col tuo listino il prezzo sale da ${euro(totM)} a ${euro(totG)}.` })
      else if (peso <= -0.01) motivi.push({ tipo: 'peso', importo: peso, gruppo: 'listino', testo: `GLS ha ${come}, meno dei ${kg(pesoMoove)} kg di Moove: col tuo listino il prezzo scende da ${euro(totM)} a ${euro(totG)}.` })
      else peso = 0
    }

    // Il carburante oltre quello del listino. GLS non lo stampa sulla riga: è la percentuale del contratto
    // (dal PDF) sul nolo della riga. Il listino ha la sua percentuale sulla fascia (fuel).
    let carburante = 0
    const pctListino = listino.fuel_pct ?? (listino.nolo > 0 ? listino.fuel / listino.nolo * 100 : null)
    if (pctListino != null && r.percentualeCarburante > pctListino + TOLLERANZA_CARBURANTE && r.nolo > 0) {
      carburante = r2(r.nolo * (r.percentualeCarburante - pctListino) / 100)
      // Listino senza carburante (lo 0% del "GLS NI W Europa"): è il listino che non lo ha, non GLS che sbaglia.
      if (carburante >= 0.01) motivi.push({ tipo: 'carburante', importo: carburante, gruppo: pctListino > 0 ? 'contestare' : 'listino',
        testo: pctListino > 0
          ? `Carburante: GLS ${pct(r.percentualeCarburante)} sul nolo di ${euro(r.nolo)}, il tuo listino ${pct(pctListino)}: ${euro(carburante)} in più.`
          : `Carburante: GLS ${pct(r.percentualeCarburante)} sul nolo di ${euro(r.nolo)}, il tuo listino per questa zona non ha carburante: ${euro(carburante)}.` })
    }

    // Le varie. Su isole minori e Venezia il listino ha la sua zona, col prezzo già più alto: lì la varia di
    // GLS è il supplemento dell'isola e si confronta col listino (va nella tariffa), come fa BRT con "ISOLA".
    let voci = 0
    const isola = /isol|venezia|lagun/i.test(listino.zona || '')
    if (r.varie >= 0.005 && !isola) {
      const d = descriviVoceGls('varie', r.varie, r.dettagli, conExchange(s))
      voci += r.varie
      motivi.push({ tipo: 'voce', importo: r2(r.varie), voce: d.nome, gruppo: d.gruppo, testo: `${d.nome}: ${d.nota}` })
    }
    if (r.voci.some(v => v.sigla === 'gls:assicurazione')) {
      const a = r.voci.find(v => v.sigla === 'gls:assicurazione')!.importo
      voci += a
      motivi.push({ tipo: 'voce', importo: r2(a), voce: 'Diritto assicurativo', gruppo: 'chiarire', testo: `Diritto assicurativo ${euro(a)}: il controllo non lo confronta col listino.` })
    }
    // I servizi: quello che GLS chiede contro il prezzo del servizio nel listino del detentore.
    const glsServizi = r2(r.voci.find(v => v.sigla === 'gls:servizi')?.importo ?? 0)
    const residuo = r2(glsServizi - accG)
    if (Math.abs(residuo) >= 0.01) {
      const d = descriviVoceGls('servizi', glsServizi, [], conExchange(s))
      voci += residuo
      motivi.push(glsServizi < 0.005
        ? { tipo: 'voce', importo: residuo, voce: 'Servizio a listino, GLS non lo fa pagare', gruppo: 'listino', testo: `Il tuo listino fa costare il servizio ${euro(accG)}, GLS non lo fa pagare.` }
        : accG > 0.005 || conServizi
          ? { tipo: 'voce', importo: residuo, voce: d.nome, gruppo: 'listino', testo: `${d.nome}: GLS ${euro(glsServizi)}, il tuo listino ${accG > 0.005 ? euro(accG) : 'non gli dà un costo'}.` }
          : Number(s.contrassegno || 0) > 0 && String(s.created_at || '') < FINE_ERRORE_ENTRO_12
            ? { tipo: 'voce', importo: residuo, voce: 'Entro ore 12, attivato per errore da Moove', gruppo: 'listino',
                testo: `Entro ore 12, attivato per errore da Moove: fino al 30/10 Moove lo chiedeva a GLS su ogni contrassegno (sull'etichetta "ENTRO ORE 12"). GLS l'ha fatto pagare ${euro(glsServizi)}: errore della piattaforma, non di GLS.` }
            : { tipo: 'voce', importo: residuo, voce: d.nome, gruppo: d.gruppo, testo: `${d.nome}: ${d.nota}` })
    }

    // GIÀ GIRATO CON LA RETTIFICA. Una rettifica confermata mette nel costo del detentore il peso e il supplemento che
    // GLS ha fatto pagare (movimenti RIPFORN-), e li fa pagare a chi sta sotto. Rifacendo il controllo dopo, quella
    // parte della differenza non c'è più, ma peso e voce si calcolano dai pesi della spedizione e restavano: la tariffa
    // andava in negativo dello stesso importo. NI665520237 di Wave, 27/11: dopo la rettifica di 22,66 € di peso e 15 €
    // di Oversize, «listino più alto del vero» per −37,67 €. La parte rettificata si toglie dal peso e dalle voci da
    // girare ai clienti, in quest'ordine; quello che resta rimane com'era.
    let coperto = rettificato, copertoVoci = 0
    if (coperto > 0.005) {
      for (const m of [...motivi.filter(x => x.gruppo === 'clienti' && x.tipo === 'peso'), ...motivi.filter(x => x.gruppo === 'clienti' && x.tipo === 'voce')]) {
        if (coperto <= 0.005 || m.importo <= 0.005) continue
        const togli = r2(Math.min(m.importo, coperto))
        m.importo = r2(m.importo - togli); coperto = r2(coperto - togli)
        if (m.tipo === 'peso') peso = r2(peso - togli); else { voci = r2(voci - togli); copertoVoci = r2(copertoVoci + togli) }
        m.testo += ` Già girat${m.tipo === 'peso' ? 'o' : 'a'} con la Rettifica: ${euro(togli)}.`
      }
      for (let i = motivi.length - 1; i >= 0; i--) if (Math.abs(motivi[i].importo) < 0.01 && (motivi[i].tipo === 'peso' || motivi[i].tipo === 'voce')) motivi.splice(i, 1)
    }

    const tariffa = r2(differenza - peso - carburante - voci)
    // Il costo registrato portato al peso di GLS, senza i supplementi già girati (stanno nel costo ma non nel listino).
    const mooveAlPeso = r2(moove + peso - copertoVoci)
    const glsTariffa = r2(mooveAlPeso + tariffa)           // quanto chiede GLS senza voci e carburante in più
    const scartoListino = r2(glsTariffa - totG)            // GLS contro il listino di oggi, stesso peso
    // «Il listino è cambiato dopo» si guarda sul costo della spedizione, senza le rettifiche venute dopo.
    const cambiato = Math.abs(totM - (moove - rettificato)) >= 0.01
    if (Math.abs(tariffa) >= 0.01) {
      const cosa = `nolo ${euro(r.nolo)} + carburante${isola && r.varie ? ', isola' : ''}${r.voci.some(v => v.sigla === 'gls:contrassegno') ? ', contrassegno' : ''}${accG > 0.005 ? ', servizi' : ''}`
      motivi.push({ tipo: 'tariffa', importo: tariffa, gruppo: 'listino', testo: `A parità di peso GLS chiede ${euro(glsTariffa)} (${cosa}), in Moove il costo registrato è ${euro(mooveAlPeso)}`
        + (cambiato ? `. Il tuo listino è cambiato dopo: oggi direbbe ${euro(totG)}${Math.abs(scartoListino) < 0.01 ? ', come GLS' : ''}.` : tariffa > 0 ? ': listino più basso del vero.' : ': listino più alto del vero.') })
    }

    // Lo scarto col listino di oggi, voce per voce (lib/fattura-gls, AllineaGls). Le parti di una riga sommano
    // lo scarto: quello che nolo e contrassegno non spiegano va in "altro". Sotto i 5 centesimi è il carburante
    // di GLS (2,97% sul contratto contro il 3% del listino), non una voce da correggere: resta sulla prima parte,
    // o non si mostra (sull'allegato di ottobre erano 15 righe "altro" da 1 centesimo).
    const parti: ParteAllinea[] = []
    if (Math.abs(scartoListino) >= 0.01) {
      const pctL = pctListino ?? 0
      const glsNolo = r2(r.nolo + (isola ? r.varie : 0))
      if (Math.abs(glsNolo - listino.nolo) >= 0.01) {
        const zone = await zoneColPrezzo(corriereRadice, listino.zona || '', r.pesoTassato, glsNolo)
        parti.push({ voce: 'nolo', listino: r2(listino.nolo), gls: glsNolo, euro: r2((glsNolo - listino.nolo) * (1 + pctL / 100)), ...(zone.length ? { zonaGls: zone.join(', ') } : {}) })
      }
      const glsCod = r2(r.voci.find(v => v.sigla === 'gls:contrassegno')?.importo ?? 0)
      const lCod = r2(Number(listino.contrassegno || 0))
      if (Math.abs(glsCod - lCod) >= 0.01) parti.push({ voce: 'contrassegno', listino: lCod, gls: glsCod, euro: r2(glsCod - lCod) })
      const resto = r2(scartoListino - parti.reduce((s, p) => s + p.euro, 0))
      if (parti.length && Math.abs(resto) < 0.05) parti[0].euro = r2(parti[0].euro + resto)
      else if (Math.abs(resto) >= 0.05) parti.push({ voce: 'altro', listino: totG, gls: glsTariffa, euro: resto })
    }
    // Il carburante che il listino non ha (la zona Europa): non è nello scarto, è un motivo a sé, ma è il listino
    // che va sistemato.
    if (carburante >= 0.01 && pctListino != null && !(pctListino > 0)) parti.push({ voce: 'carburante', listino: 0, gls: r2(r.percentualeCarburante), euro: carburante })
    const allinea: AllineaGls | undefined = parti.length
      ? { listino: nomeContratto.get(corriereRadice) || '', zona: listino.zona || '', peso: r.pesoTassato,
          luogo: [s.dest_citta || r.localita, s.dest_cap].filter(Boolean).join(' '), parti }
      : undefined
    return { ...conSped, moove, listino, differenza, motivi, scartoListino, ...(allinea ? { allinea } : {}) }
  })
}
