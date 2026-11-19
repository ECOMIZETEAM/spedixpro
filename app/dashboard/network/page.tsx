'use client'
import { useState, useEffect, useRef } from 'react'
import { frasePesoPagato } from '@/lib/peso-pagato-frase'
import BarraAvanzamento from '@/app/components/BarraAvanzamento'
import { sottoDi, sintesi, pagata } from '@/lib/network-sintesi'

const ACCENT = '#f97316'
const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const}
const th = {padding:'9px 12px',fontSize:'11px',fontWeight:700 as const,textTransform:'uppercase' as const,color:'#666',textAlign:'left' as const,whiteSpace:'nowrap' as const}
const td = {padding:'9px 12px',fontSize:'12.5px',color:'#1a1a1a',borderTop:'1px solid #f0f0f0'}

// L'ORA DELL'ADDEBITO, IN ORA ITALIANA: «alle 00:10» se il mittente ha confermato tutto insieme,
// «dalle 07:11 alle 21:20» se nello stesso giorno l'ha fatto in più riprese.
const ORA_IT = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
function orarioBlocco(b: { primo: number, ts: number }): string {
  if (!isFinite(b.primo) || !b.ts) return ''
  const da = ORA_IT.format(b.primo), a = ORA_IT.format(b.ts)
  return da === a ? ` alle ${da}` : ` dalle ${da} alle ${a}`
}

export default function NetworkRicevutiPage() {
  const [tab, setTab] = useState<'rettifiche'|'contrassegni'|'resi'>('rettifiche')
  const [dati, setDati] = useState<any>({rettifiche:[],contrassegni:[],resi:[]})
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [propagando, setPropagando] = useState<string>('')
  const [accettando, setAccettando] = useState<string>('')
  const [apertoBlocco, setApertoBlocco] = useState<string>('')
  const [avanz, setAvanz] = useState<{k:string,fatti:number,totale:number,da:number}|null>(null)
  // COSA DEVI FARE (/api/network/da-fare, lib/network-da-fare): le rettifiche da decidere che «Carica» non puo' girare,
  // raggruppate per cosa sistemare (listino di un cliente troppo corto, misure mancanti…), e accanto a ogni riga il suo
  // motivo. Si calcola a ogni apertura e resta finche' non e' sistemato: il messaggio dopo «Carica» spariva al «Carica»
  // successivo, e il 12/11/2026 Ecomize Solution non ha mai letto quello di 3UW1UHA334029.
  const [daFare, setDaFare] = useState<{azioni:any[],righe:Record<string,string>,pronte:number,totaleRighe:number,totaleEuro:number}>({azioni:[],righe:{},pronte:0,totaleRighe:0,totaleEuro:0})
  const [tutteAzioni, setTutteAzioni] = useState(false)

  // Le rettifiche nuove senza stima (il giro automatico passa ogni 5 minuti): si calcola adesso, una volta per apertura,
  // e la pagina si rilegge da sola (app/api/network/stima).
  const stimaAvviata = useRef(false)
  const [stimando, setStimando] = useState(false)
  async function carica() {
    setLoading(true)
    const d = await fetch('/api/network/ricevuti').then(r=>r.json()).catch(()=>null)
    if (d && !d.error) setDati(d)
    if (d && !d.error && !stimaAvviata.current && (d.rettifiche || []).some((r: any) => !r.propagazione && !r.propria && !r.perche?.stima)) {
      stimaAvviata.current = true; setStimando(true)
      fetch('/api/network/stima', { method: 'POST' })
        .then(() => fetch('/api/network/ricevuti').then(r => r.json()))
        .then(x => { if (x && !x.error) setDati(x) })
        .catch(() => {}).finally(() => setStimando(false))
    }
    fetch('/api/network/da-fare').then(r=>r.json()).then(x=>{ if (x && !x.error) setDaFare(x) }).catch(()=>{})
    setLoading(false)
  }
  useEffect(()=>{ carica() }, [])

  // UN BLOCCO, NON CINQUANTASETTE RIGHE.
  // Le rettifiche arrivano tutte insieme, dallo stesso mittente: si decidono insieme. Il dettaglio
  // resta, ma si apre solo se uno lo vuole vedere.
  // IL BLOCCO E' L'ADDEBITO, NON LA NASCITA DELLA RIGA: mittente + giorno in cui ha confermato (la
  // chiave la mette la rotta, lib/network-invii). Per giorno di nascita, le 299 righe che MULTIEXPRESS
  // ha addebitato in una volta a Ecomize Solution (531,88 €) si vedevano in tre blocchi da 366,99,
  // 163,24 e 1,65, e chi le riceveva pensava che il resto fosse sparito.
  const { blocchi, proprie } = (() => {
    const m = new Map<string, any>()
    const proprie: any[] = []
    const chiaveBlocco = (r: any) => r.blocco || ((r.masters?.nome || '—') + '|' + (r.invio_giorno || new Date(r.created_at).toLocaleDateString('it-IT')))
    for (const r of (dati.rettifiche || [])) {
      // LE TUE SPEDIZIONI PROPRIE (senza cliente, spedite da te) ancora da decidere NON vanno coi
      // blocchi da propagare: sotto di te non c'è nessuno, sono già a tuo carico. Sezione a parte,
      // niente "propaga / Le assorbo io" — che suona come accollarsi il costo di un altro.
      if (r.propria && !r.propagazione) { proprie.push(r); continue }
      const giorno = r.invio_giorno || new Date(r.created_at).toLocaleDateString('it-IT')
      const da = r.masters?.nome || '—'
      const k = chiaveBlocco(r)
      if (!m.has(k)) m.set(k, { k, da, giorno, ts: 0, primo: Infinity, righe: [], totale: 0, totaleDaDecidere: 0, daDecidere: [], parziale: false, proprie: [], totaleProprie: 0, altri: [] })
      const b = m.get(k)
      const t = Number(r.addebitata_ts) || new Date(r.created_at).getTime()
      b.ts = Math.max(b.ts, t)          // ultimo addebito del blocco: serve all'ordinamento
      b.primo = Math.min(b.primo, t)    // primo addebito: si scrive l'ora
      if (r.blocco_parziale) b.parziale = true
      const addebito = (Number(r.differenza) || 0) - (Number(r.fuori_sagoma) || 0)   // addebito vero = ripesatura + supplementi fissi
      b.righe.push(r); b.totale += addebito
      // Il totale che conta è quello del DA DECIDERE, non di tutto il blocco: 578 già decise + 2 nuove
      // mostravano "580 · €1957" accanto a "Accetta (2)" — sembrava un errore. Ora il blocco grida i 2.
      if (!r.propagazione) { b.daDecidere.push(r.id); b.totaleDaDecidere += addebito }
    }
    // MA FANNO PARTE DELLO STESSO ADDEBITO. L'11/11/2026 MULTIEXPRESS ha addebitato a Ecomize Solution 392 righe
    // per 517,55 €; una (1,04 €) era una spedizione di Ecomize stessa, finita nel riquadro delle proprie, e il
    // blocco diceva 391 righe per 516,51: di nuovo un totale diverso da quello del mittente. Le proprie restano
    // nel loro riquadro (e fuori da «Carica»), ma il blocco le conta e dice dove sono.
    for (const r of proprie) {
      const b = m.get(chiaveBlocco(r))
      if (!b) continue   // addebito fatto solo di spedizioni proprie: c'è già il loro riquadro
      const t = Number(r.addebitata_ts) || new Date(r.created_at).getTime()
      b.ts = Math.max(b.ts, t); b.primo = Math.min(b.primo, t)
      b.proprie.push(r); b.totaleProprie += (Number(r.differenza) || 0) - (Number(r.fuori_sagoma) || 0)
    }
    // GLI ALTRI ADDEBITI DEL GIORNO, che non sono ripesature (adeguamenti del contrassegno, correzioni): li manda la rotta
    // (altriAddebiti) e stanno nello stesso blocco, perche' il blocco deve tornare col totale della Lista movimenti.
    const nomeMittente = new Map<string, string>()
    for (const r of [...(dati.rettifiche || [])]) if (r.master_id && r.masters?.nome) nomeMittente.set(r.master_id, r.masters.nome)
    for (const a of (dati.altriAddebiti || [])) {
      if (!m.has(a.blocco)) m.set(a.blocco, { k: a.blocco, da: nomeMittente.get(a.master_id) || '—', giorno: a.invio_giorno, ts: 0, primo: Infinity, righe: [], totale: 0, totaleDaDecidere: 0, daDecidere: [], parziale: false, proprie: [], totaleProprie: 0, altri: [] })
      const b = m.get(a.blocco)
      b.altri.push(a); b.ts = Math.max(b.ts, a.addebitata_ts); b.primo = Math.min(b.primo, a.addebitata_ts)
    }
    // ORDINE come i contrassegni: prima i blocchi con rettifiche ANCORA DA DECIDERE (le NUOVE), poi per
    // DATA vera decrescente. Prima si ordinava per la STRINGA "GG/MM/AAAA" → ordinava per giorno del mese
    // (27/08 prima di 08/09) e le vecchie GIÀ DECISE finivano in cima, sembrando ri-addebitate.
    return {
      blocchi: Array.from(m.values()).sort((a, b) => {
        const an = a.daDecidere.length > 0 ? 1 : 0, bn = b.daDecidere.length > 0 ? 1 : 0
        return an !== bn ? bn - an : b.ts - a.ts
      }),
      proprie,
    }
  })()
  const totaleProprie = proprie.reduce((a: number, r: any) => a + ((Number(r.differenza) || 0) - (Number(r.fuori_sagoma) || 0)), 0)

  // CHIUDE LE TUE SPEDIZIONI PROPRIE. Non c'è niente da propagare (sono tue), e il credito ti è già
  // stato scalato quando il livello sopra le ha confermate: marcarle 'assorbita' NON muove un euro,
  // le toglie solo dal "da decidere". Riusa la stessa porta dell'assorbi, ma la parola è "sono mie".
  async function chiudiProprie(ids: string[]) {
    if (!ids.length) return
    setPropagando('__proprie__'); setMsg('')
    try {
      const res = await fetch('/api/network/rettifiche', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rettifica_ids: ids, decisione: 'assorbita' }),
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: ' + d.error)
      else setMsg(`✓ ${d.assorbite ?? ids.length} tue spedizioni proprie chiuse: erano già a tuo carico, le hai spedite tu.`)
    } catch { setMsg('Errore di rete') }
    carica(); setPropagando('')
  }

  // SCARICA: tutto l'addebito in Excel, una riga per movimento, con dove lo trovi in pagina e, per quelle girate, a chi
  // e quanto (Lorenzo, 19/11/2026: «così controlla se veramente a quel cliente è stata addebitata la rettifica»). Il
  // totale del file e' quello della Lista movimenti di quel giorno. Sono gia' addebitate: scaricarle non cambia niente.
  async function scaricaBlocco(b: any) {
    const { utils, writeFile } = await import('xlsx')
    const righe: any[] = []
    for (const v of vociDelBlocco(b)) {
      for (const r of v.righe) {
        if (v.k === 'altri') { righe.push({ 'Dove lo trovi': v.nome, 'LDV': r.numero_spedizione || '', 'Movimento': r.descrizione, 'Hai pagato (€)': r.euro }); continue }
        const pp = r.peso_pagato
        const vol = Number(r.peso_volume_reale) || 0, reale = Number(r.peso_reale) || 0
        righe.push({
          'Dove lo trovi': v.nome,
          'LDV': r.numero_spedizione,
          'Peso dichiarato (kg)': pp ? Math.round(Number(pp.prima) * 100) / 100 : Math.max(Number(r.peso_iniziale) || 0, Number(r.peso_volume_iniziale) || 0),
          'Peso su cui si paga (kg)': pp ? Math.round(Number(pp.dopo) * 100) / 100 : Math.max(reale, vol),
          'Hai pagato (€)': Math.round(pagata(r) * 100) / 100,
          'A chi': v.k === 'girate' ? (r.figlia?.a || '') : v.k === 'girare' ? (r.perche?.stima?.chi || '') : '',
          'Chiesto al cliente (€)': v.k === 'girate' ? r.figlia?.euro ?? '' : v.k === 'girare' ? Number(r.perche?.stima?.chiede) || '' : '',
          'Stato': v.k === 'girate' ? statoFiglia(r.figlia) : (daFare.righe[r.id] || sottoDi(r).testo || ''),
        })
      }
    }
    righe.push({ 'Dove lo trovi': 'Totale', 'Hai pagato (€)': Math.round(righe.reduce((t, x) => t + (Number(x['Hai pagato (€)']) || 0), 0) * 100) / 100 })
    const wb = utils.book_new(); utils.book_append_sheet(wb, utils.json_to_sheet(righe), 'Addebito')
    writeFile(wb, `addebito-${String(b.da || 'network').replace(/[^\w-]+/g, '_')}-${String(b.giorno || '').replace(/\//g, '-')}.xlsx`)
  }

  // CARICARE (prima si chiamava "Accetta") NON E' ADDEBITARE.
  // Caricare vuol dire "va bene, me la prendo in carico": le righe finiscono nella MIA pagina
  // Rettifica Costi, riprezzate col MIO listino e gia' divise per cliente e sotto-master. Li'
  // guardo, scelgo a CHI caricarle, e solo premendo Conferma il credito scende di un gradino.
  // Sono due gesti distinti, come per i contrassegni: chi carica non sta ancora addebitando
  // nessuno, e finche' non carica non e' uscito un euro dalla sua rete.
  async function decidiBlocco(b: any, decisione: 'propagata' | 'assorbita') {
    if (!b.daDecidere.length) return
    setPropagando(b.k); setMsg('')
    const ids: string[] = b.daDecidere
    try {
      // ASSORBI: solo un'etichetta sulle righe, una query sola → veloce, niente barra.
      if (decisione === 'assorbita') {
        const res = await fetch('/api/network/rettifiche', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ rettifica_ids: ids, decisione })
        })
        const d = await res.json()
        if (d.error) setMsg('Errore: ' + d.error)
        else setMsg(`✓ ${d.assorbite ?? ids.length} rettifiche tenute a tuo carico: non le chiedi a nessuno.`)
        carica(); setPropagando(''); return
      }
      // ACCETTA/PROPAGA: ognuna ricostruisce la cascata (lento). Si lavora A LOTTI con una barra,
      // così su 196 rettifiche si vede l'avanzamento invece di sembrare piantato — e un lotto lungo
      // non rischia il timeout della funzione.
      // CINQUANTA PER VOLTA (erano 12). Dal 29/09/2026 il riprezzo gira a sedici righe insieme e
      // costa ~0,6 s a riga invece di 4,7: con lotti da dodici il tempo se ne andava nelle andate e
      // ritorni (186 richieste per 2.228 rettifiche). Cinquanta stanno dentro il tempo massimo della
      // richiesta (~30 s contro i 300 concessi) e la barra continua a muoversi.
      const BATCH = 50
      let create = 0, nonProp = 0, giaDecise = 0, inAttesa = 0, scart = 0, aZero = 0
      const dettaglio: any[] = []
      setAvanz({ k: b.k, fatti: 0, totale: ids.length, da: Date.now() })
      for (let i = 0; i < ids.length; i += BATCH) {
        const fetta = ids.slice(i, i + BATCH)
        const res = await fetch('/api/network/rettifiche', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ rettifica_ids: fetta, decisione })
        })
        const d = await res.json()
        // "In attesa sopra" NON è un errore: la 404 con inAttesaSopra dice solo che quel lotto era tutto
        // da confermare più in alto → si conta e si continua. Ci si ferma solo su un errore vero.
        if (d.error && !d.inAttesaSopra) { setMsg('Errore: ' + d.error); break }
        create += d.create || 0; aZero += d.aZero || 0; nonProp += d.nonPropagate || 0; giaDecise += d.giaDecise || 0; inAttesa += d.inAttesaSopra || 0; scart += Array.isArray(d.scartate) ? d.scartate.length : 0
        if (Array.isArray(d.dettaglio)) dettaglio.push(...d.dettaglio)
        setAvanz(a => a ? { ...a, fatti: Math.min(i + BATCH, ids.length) } : a)
      }
      const parti: string[] = []
      if (create > 0) parti.push(`✓ Girate ${create} ai tuoi clienti: sono in Spedizioni › Rettifica Costi, divise per cliente e sotto-master. I clienti pagano solo quando le confermi.`)
      // A zero: il livello sotto non deve niente, ma chi sta sotto di lui si'. Si dice perche' esistono.
      if (aZero > 0) parti.push(`✓ Di queste, ${aZero} sono a zero: a chi le riceve non costano niente, ma più sotto qualcuno deve ancora pagare la differenza — confermale insieme alle altre, servono a farla arrivare fin lì.`)
      // Scartate = il cliente pagherebbe uguale (stesso scaglione): niente da recuperare. NON è un
      // problema né una perdita da sistemare — si dice con calma, non fra gli avvisi ⚠️.
      if (scart) parti.push(`✓ ${scart} restano a te: col suo listino il cliente paga uguale (stessa fascia di peso), non c'è niente da chiedergli.`)
      if (nonProp) {
        // TUTTE, non solo le prime 30: oltre il taglio "sparivano" e sembravano perse. Cap alto + conteggio.
        // Il motivo è per RIGA (il listino non copre quel peso/zona, misure mancanti, catena incompleta):
        // non si mette più un consiglio unico "alza la fascia" a tappeto, che era sbagliato per metà dei casi.
        // Il motivo di ognuna resta anche nel riquadro «Cosa devi fare», che non sparisce al «Carica» dopo: qui se ne
        // mostrano le prime, la' ci sono tutte, raggruppate per cosa sistemare.
        const CAP = 10
        const elenco = dettaglio.slice(0, CAP).map((x: any) => `${x.ldv} — ${x.perche}`).join('\n• ')
        const extra = dettaglio.length > CAP ? `\n• … e altre ${dettaglio.length - CAP}` : ''
        parti.push(`⚠️ ${nonProp} bloccate. Le trovi tutte nel riquadro «Cosa devi fare» qui sotto, con cosa sistemare; resta lì finché non passano:\n• ${elenco}${extra}`)
      }
      if (inAttesa) parti.push(`⏳ ${inAttesa} in attesa che il livello sopra le confermi: NON sono perse — riprova quando saranno confermate.`)
      if (!create && !nonProp && !inAttesa && !scart) parti.push(giaDecise ? 'Queste rettifiche erano già state decise.' : 'Nessuna rettifica da decidere.')
      setMsg(parti.join('\n\n'))
      carica()
    } catch { setMsg('Errore di connessione') }
    setPropagando(''); setAvanz(null)
  }

  // Accetta un reso ricevuto: propaga (distinte reso verso clienti e/o sotto-master)
  async function accettaReso(r: any) {
    setAccettando(r.id); setMsg('')
    try {
      const res = await fetch('/api/network/resi/accetta', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ distintaId: r.id })
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: ' + d.error)
      else setMsg('✓ Reso #' + r.numero + ' accettato — create ' + (d.distinteCreate||0) + ' distinte reso' + (d.giaCaricate ? ' ('+d.giaCaricate+' già in reso, saltate)' : '') + ' (verso i tuoi clienti/sotto-master)')
      carica()
    } catch { setMsg('Errore di connessione') }
    setAccettando('')
  }

  // Accetta una rimessa contrassegni ricevuta: crea le distinte verso i miei clienti
  async function accettaContrassegno(c: any) {
    setAccettando(c.id); setMsg('')
    try {
      const res = await fetch('/api/network/contrassegni/accetta', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ distintaId: c.id })
      })
      const d = await res.json()
      if (d.error) setMsg('Errore: ' + d.error)
      else setMsg('✓ Rimessa #' + c.numero + ' accettata — vai in Contrassegni › Distinte Contrassegni: lì la selezioni e la CARICHI verso i tuoi clienti/sotto-master quando vuoi.')
      carica()
    } catch { setMsg('Errore di connessione') }
    setAccettando('')
  }

  // Il numero sul tab = azioni ANCORA DA FARE, non il totale ricevuto: appena si accetta/decide
  // deve sparire. Prima contava TUTTO (dati.x.length) e restava "(1)"/"(11)" anche dopo aver
  // accettato tutto. Pending: rettifica non ancora decisa (!propagazione — vale sulle RIGHE, così
  // un blocco accettato in parte conta solo quelle rimaste); rimessa/reso non ancora accettati.
  const tabs: [typeof tab, string, number][] = [
    ['rettifiche', 'Rettifiche ricevute', (dati.rettifiche||[]).filter((r:any)=>!r.propagazione).length],
    ['contrassegni', 'Rimesse COD ricevute', (dati.contrassegni||[]).filter((c:any)=>!c.accettata_target).length],
    ['resi', 'Resi ricevuti', (dati.resi||[]).filter((r:any)=>!r.accettata_target).length],
  ]

  // ── LA PAGINA SI LEGGE IN TRE PASSI (Lorenzo, 18/11/2026: «la grafica dal mio network è fatta proprio male.. si capisce
  // di merda»; bozza approvata lo stesso giorno). Prima ogni addebito era un riquadro con quattro numeri per riga («girate
  // sotto · chiedi € 205,17 · incassati € 96,67 · € 108,50 da confermare · le hai pagate € 166,08»), quelli da fare
  // mescolati a quelli gia' fatti, e parole del portale («Carica», «Assorbi»). Ora: in cima quanto c'e' da girare, da
  // confermare, bloccato e a tuo carico; sotto un riquadro per ogni addebito (vedi «OGNI ADDEBITO SI CONTROLLA DA SOLO»).
  // I conti sono gli stessi di prima (lib/network-sintesi), cambia solo come si leggono.
  // Il punto delle migliaia a mano: in italiano toLocaleString lo mette solo da 10.000 in su («€ 2762,86»).
  const eurIt = (n: number) => '€ ' + Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const nSped = (n: number) => `${n.toLocaleString('it-IT')} ${n === 1 ? 'spedizione' : 'spedizioni'}`
  const conSintesi = blocchi.map((b: any) => ({ b, s: sintesi(b.righe, b.proprie) }))
  const daGirare = conSintesi.filter(x => x.b.daDecidere.length > 0)
  const tot = daGirare.reduce((t, { s }) => ({
    chiede: t.chiede + s.recupera.chiede, nRecupera: t.nRecupera + s.recupera.n, pagateRecupera: t.pagateRecupera + s.recupera.euro,
    nFerme: t.nFerme + s.ferme.n, ferme: t.ferme + s.ferme.euro, nUguale: t.nUguale + s.ugualeStima.n, uguale: t.uguale + s.ugualeStima.euro,
    nCalcolo: t.nCalcolo + s.inCalcolo.n,
  }), { chiede: 0, nRecupera: 0, pagateRecupera: 0, nFerme: 0, ferme: 0, nUguale: 0, uguale: 0, nCalcolo: 0 })
  const daConfermare = conSintesi.reduce((t, { s }) => t + s.girate.daConfermare, 0)
  const restanoN = tot.nUguale + proprie.length, restanoEuro = tot.uguale + Math.abs(totaleProprie)
  const mittenti = Array.from(new Set(blocchi.map((b: any) => b.da)))
  const chiSopra = mittenti.length === 1 ? mittenti[0] : 'Il livello sopra'
  const tuttiDaDecidere: string[] = daGirare.flatMap(x => x.b.daDecidere)
  const thR = { ...th, textAlign: 'right' as const }
  const tdR = { ...td, textAlign: 'right' as const, whiteSpace: 'nowrap' as const }
  const btnPrimario = { background: '#ea580c', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }
  const btnSecondario = { background: '#fff', color: '#1a1a1a', border: '1px solid #d4d4d8', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }

  // ── OGNI ADDEBITO SI CONTROLLA DA SOLO (Lorenzo, 19/11/2026: «quando multi addebita 907,59 €, su dal mio network deve
  // vedere questa tabellina in modo tale che capisce cosa è successo e può controllarla lui stesso»). Ecomize Solution
  // aveva sommato dalla Lista movimenti le rettifiche del 17/11 e le confrontava col «da girare» di quel giorno (663,96):
  // erano due cose diverse, e la pagina non diceva dove fosse il resto. Ora ogni addebito ha la sua tabellina: in testa
  // il totale (lo stesso della Lista movimenti), sotto dove sta ogni parte, e ogni voce si apre spedizione per spedizione.
  type Voce = 'girare' | 'bloccate' | 'calcolo' | 'girate' | 'uguale' | 'assorbite' | 'cancellate' | 'proprie' | 'annullate' | 'altri'
  const VOCI: [Voce, string][] = [
    ['girare', 'Da girare ai tuoi clienti'], ['bloccate', 'Bloccate: c\'è qualcosa da sistemare'], ['calcolo', 'In calcolo'],
    ['girate', 'Già girate ai clienti'], ['uguale', 'Restano a te: il cliente paga uguale'], ['assorbite', 'Tenute a tuo carico'],
    ['cancellate', 'Girate e poi cancellate'], ['proprie', 'Tue spedizioni senza cliente'], ['annullate', 'Annullate: importo restituito'],
    ['altri', 'Altri addebiti, non sono ripesature'],
  ]
  function voceDi(r: any): Voce {
    if (r.propria) return 'proprie'
    if (!r.propagazione) { const st = r.perche?.stima; return !st ? 'calcolo' : st.esito === 'recupera' ? 'girare' : st.esito === 'uguale' ? 'uguale' : 'bloccate' }
    if (r.propagazione === 'propagata') return r.figlia ? 'girate' : 'cancellate'
    if (r.propagazione === 'assorbita') return r.perche?.tipo === 'paga_uguale' ? 'uguale' : 'assorbite'
    return 'annullate'
  }
  function vociDelBlocco(b: any): { k: Voce; nome: string; righe: any[]; euro: number }[] {
    const per = new Map<Voce, any[]>()
    for (const r of [...b.righe, ...b.proprie]) { const k = voceDi(r); if (!per.has(k)) per.set(k, []); per.get(k)!.push(r) }
    if ((b.altri || []).length) per.set('altri', b.altri)
    return VOCI.filter(([k]) => per.has(k)).map(([k, nome]) => {
      const rr = per.get(k)!
      return { k, nome, righe: rr, euro: rr.reduce((t: number, x: any) => t + (k === 'altri' ? Number(x.euro) || 0 : pagata(x)), 0) }
    })
  }
  function statoFiglia(f: any): string {
    if (!f) return ''
    if (f.stato === 'in_contestazione') return 'In contestazione col fornitore'
    return f.confermata ? 'Confermata: addebitata' : 'Da confermare in Rettifica Costi'
  }
  // Una frase per voce, con i soldi che contano per quella voce.
  function notaVoce(v: { k: Voce; righe: any[] }): string {
    const somma = (f: (r: any) => number) => v.righe.reduce((t, r) => t + f(r), 0)
    switch (v.k) {
      case 'girare': return `chiedi ${eurIt(somma(r => Number(r.perche?.stima?.chiede) || 0))}, ognuno col suo listino`
      case 'girate': {
        const chiesto = somma(r => Number(r.figlia?.euro) || 0), incassato = somma(r => r.figlia?.confermata ? Number(r.figlia.euro) || 0 : 0)
        return `chiesto ${eurIt(chiesto)} · confermate ${eurIt(incassato)}${chiesto - incassato > 0.005 ? ` · da confermare ${eurIt(chiesto - incassato)}` : ''}`
      }
      case 'bloccate': return 'apri «Vedi» o «Cosa devi fare» per cosa sistemare'
      case 'calcolo': return 'fra qualche minuto si vede quanto chiedi'
      case 'uguale': return 'col suo listino resta nella stessa fascia: niente da chiedere'
      case 'assorbite': return 'hai scelto di non chiederle'
      case 'cancellate': return 'girate e poi cancellate in Rettifica Costi'
      case 'proprie': return 'spedite da te senza un cliente'
      case 'annullate': return 'l\'addebito ti è stato restituito'
      case 'altri': {
        const tipi = new Map<string, number>()
        for (const a of v.righe) { const t = String(a.descrizione || '').split(/\s+/).slice(0, 2).join(' '); tipi.set(t, (tipi.get(t) || 0) + 1) }
        return Array.from(tipi.entries()).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t, n]) => `${t} (${n})`).join(' · ')
      }
    }
  }
  // Il peso su cui si paga, prima e dopo: collo per collo sulle multicollo (peso_pagato dalla rotta), altrimenti il
  // maggiore fra reale e volume. Con un collo leggero ma ingombrante e' il volume a far salire il costo.
  function pesoTesto(r: any) {
    const vol = Number(r.peso_volume_reale) || 0, reale = Number(r.peso_reale) || 0
    const pp = r.peso_pagato
    const kg2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('it-IT')
    const prima = pp ? Number(pp.prima) : Math.max(Number(r.peso_iniziale) || 0, Number(r.peso_volume_iniziale) || 0)
    const dopo = pp ? Number(pp.dopo) : Math.max(reale, vol)
    return <>{kg2(prima)} → <strong>{kg2(dopo)}</strong> kg{pp ? <span title={frasePesoPagato(pp)} style={{display:'block',fontSize:'10px',color:'#1e40af'}}>collo per collo</span> : vol > reale ? <span style={{color:'#ea580c'}}> (vol.)</span> : null}</>
  }
  function tabellaVoce(k: Voce, rr: any[]) {
    if (k === 'altri') return (
      <table style={{width:'100%',borderCollapse:'collapse',background:'#fcfcfc'}}>
        <thead><tr style={{background:'#f9fafb'}}><th style={th}>LDV</th><th style={th}>Movimento</th><th style={thR}>Hai pagato</th></tr></thead>
        <tbody>{rr.map((a: any) => (
          <tr key={a.id}><td style={{...td,fontWeight:600}}>{a.numero_spedizione || '—'}</td><td style={td}>{a.descrizione}</td><td style={tdR}>{eurIt(a.euro)}</td></tr>
        ))}</tbody>
      </table>
    )
    return (
      <table style={{width:'100%',borderCollapse:'collapse',background:'#fcfcfc'}}>
        <thead><tr style={{background:'#f9fafb'}}>
          <th style={th}>LDV</th><th style={th}>Peso su cui si paga</th><th style={thR}>Hai pagato</th>
          {k === 'girate' ? <><th style={th}>A chi</th><th style={thR}>Chiesto</th><th style={th}>Stato</th></>
            : k === 'girare' ? <><th style={th}>A chi</th><th style={thR}>Chiedi</th></>
            : <th style={th}>Perché</th>}
        </tr></thead>
        <tbody>{rr.map((r: any) => (
          <tr key={r.id}>
            <td style={{...td,fontWeight:600}}>{r.numero_spedizione}</td>
            <td style={td}>{pesoTesto(r)}</td>
            <td style={tdR}>{eurIt(pagata(r))}</td>
            {k === 'girate' ? <>
                <td style={td}>{r.figlia?.a || '—'}</td>
                <td style={tdR}>{eurIt(Number(r.figlia?.euro) || 0)}</td>
                <td style={{...td,color:r.figlia?.confermata ? '#166534' : '#9a3412',fontWeight:600}}>{statoFiglia(r.figlia)}</td>
              </>
              : k === 'girare' ? <>
                <td style={td}>{r.perche?.stima?.chi || '—'}</td>
                <td style={{...tdR,color:'#166534',fontWeight:700}}>{eurIt(Number(r.perche?.stima?.chiede) || 0)}</td>
              </>
              : <td style={{...td,color:'#475569'}}>{daFare.righe[r.id] || sottoDi(r).testo || ''}</td>}
          </tr>
        ))}</tbody>
      </table>
    )
  }

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Dal mio network</h1>
        <p style={{color:'#52525b',fontSize:'13px',marginTop:'4px'}}>
          {tab==='rettifiche'
            ? `Le rettifiche che ${mittenti.length === 1 ? mittenti[0] : 'il livello sopra'} ti ha addebitato. Le hai già pagate: qui le giri ai tuoi clienti.`
            : 'Rimesse contrassegni e resi ricevuti dal livello sopra. Qui si accettano: a chi caricarli si decide dopo, dalle rispettive pagine.'}
        </p>
      </div>

      <div style={{display:'flex',gap:'8px',marginBottom:'16px',flexWrap:'wrap'}}>
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={()=>setTab(k)} style={{background:tab===k?ACCENT:'#fff',color:tab===k?'#fff':'#1a1a1a',border:'1px solid '+(tab===k?ACCENT:'#e8e8e8'),borderRadius:'8px',padding:'8px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>
            {label}{n>0?` (${n})`:''}
          </button>
        ))}
      </div>

      {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#ea580c',whiteSpace:'pre-line' as const}}>{msg}</div>}

      {loading ? <div style={card}><div style={{padding:'40px',textAlign:'center',color:'#999'}}>Caricamento…</div></div> : tab==='rettifiche' ? (
        (blocchi.length===0 && proprie.length===0) ? <div style={card}><div style={{padding:'32px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessuna rettifica ricevuta</div></div> :
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
          {/* I TRE PASSI: chi riceve una rettifica deve sapere che l'ha gia' pagata e che il cliente paga solo alla conferma. */}
          <div style={{...card,display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))'}}>
            {([['1', `${chiSopra} ti addebita`, 'L\'importo è già scalato dal tuo credito.'],
               ['2', 'Tu la giri ai tuoi clienti', 'Si fa qui: ogni cliente paga col suo listino.'],
               ['3', 'La confermi in Rettifica Costi', 'Solo allora il cliente paga.']] as [string, string, string][]).map(([n, titolo, testo]) => (
              <div key={n} style={{padding:'14px 18px',display:'flex',gap:'12px',alignItems:'flex-start',background:n==='2'?'#fff7ed':'#fff',borderRight:'1px solid #f0f0f0'}}>
                <span style={{flex:'none',width:'26px',height:'26px',borderRadius:'999px',background:n==='2'?'#ea580c':'#1a1a1a',color:'#fff',fontSize:'13px',fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{n}</span>
                <div><div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>{titolo}</div><div style={{fontSize:'12.5px',color:'#52525b',marginTop:'2px'}}>{testo}</div></div>
              </div>
            ))}
          </div>

          {/* QUATTRO NUMERI: quanto si puo' ancora chiedere, quanto aspetta la conferma, quanto e' fermo e perche', quanto resta
              a te perche' sotto non c'e' niente da chiedere. */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',gap:'12px'}}>
            <div style={{...card,border:'2px solid #ea580c',padding:'16px 18px'}}>
              <div style={{fontSize:'11.5px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em',color:'#9a3412'}}>Da girare ai clienti</div>
              <div style={{fontSize:'28px',fontWeight:800,color:'#1a1a1a',marginTop:'4px'}}>{eurIt(tot.chiede)}</div>
              <div style={{fontSize:'12.5px',color:'#3f3f46',marginTop:'4px'}}>{nSped(tot.nRecupera)} · le hai pagate {eurIt(tot.pagateRecupera)}{tot.nCalcolo ? ` · ${tot.nCalcolo} ancora in calcolo` : ''}</div>
            </div>
            <div style={{...card,padding:'16px 18px'}}>
              <div style={{fontSize:'11.5px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em',color:'#52525b'}}>Da confermare</div>
              <div style={{fontSize:'28px',fontWeight:800,color:'#1a1a1a',marginTop:'4px'}}>{eurIt(daConfermare)}</div>
              <div style={{fontSize:'12.5px',color:'#3f3f46',marginTop:'4px'}}>già girate, aspettano te in <a href="/dashboard/spedizioni/rettifica" style={{color:'#c2410c'}}>Rettifica Costi</a></div>
            </div>
            <div style={{...card,padding:'16px 18px'}}>
              <div style={{fontSize:'11.5px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em',color:'#92400e'}}>Bloccate</div>
              <div style={{fontSize:'28px',fontWeight:800,color:'#1a1a1a',marginTop:'4px'}}>{eurIt(tot.ferme)}</div>
              <div style={{fontSize:'12.5px',color:'#3f3f46',marginTop:'4px'}}>{nSped(tot.nFerme)}{tot.nFerme ? (daFare.azioni.length ? ' · cosa sistemare qui sotto' : ' · apri «Vedi» per il motivo') : ''}</div>
            </div>
            <div style={{...card,padding:'16px 18px'}}>
              <div style={{fontSize:'11.5px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em',color:'#52525b'}}>Restano a te</div>
              <div style={{fontSize:'28px',fontWeight:800,color:'#1a1a1a',marginTop:'4px'}}>{eurIt(restanoEuro)}</div>
              <div style={{fontSize:'12.5px',color:'#3f3f46',marginTop:'4px'}}>{nSped(restanoN)} · sotto paga uguale, o sono spedizioni tue</div>
            </div>
          </div>

          {/* COSA DEVI FARE: appare solo se c'e' qualcosa da sistemare perche' le rettifiche scendano. Una riga per cosa da
              fare (per cliente o sotto-master e contratto), col peso che serve e gli euro fermi; dal listino di un tuo
              cliente si va dritti alla sua pagina. Resta finche' non e' sistemato. */}
          {(daFare.azioni.length > 0 || daFare.pronte > 0) && (
            <div style={{...card,background:'#fef2f2',border:'1px solid #fecaca',padding:'14px 16px'}}>
              {daFare.azioni.length > 0 && <>
                <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>
                  ⚠ Cosa devi fare · {daFare.totaleRighe} {daFare.totaleRighe===1?'rettifica bloccata':'rettifiche bloccate'} · <span style={{color:'#dc2626'}}>€ {daFare.totaleEuro.toFixed(2)}</span>
                </div>
                <div style={{fontSize:'12px',color:'#7f1d1d',marginTop:'3px',maxWidth:'720px'}}>
                  Queste rettifiche non si possono girare ai tuoi clienti finché non sistemi quello che c'è scritto. Te le hanno già scalate: finché restano qui sono a tuo carico.
                </div>
                <div style={{marginTop:'10px',display:'flex',flexDirection:'column',gap:'6px'}}>
                  {(tutteAzioni ? daFare.azioni : daFare.azioni.slice(0, 6)).map((g:any,i:number)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',flexWrap:'wrap',background:'#fff',border:'1px solid #fecaca',borderRadius:'8px',padding:'9px 12px'}}>
                      <div style={{fontSize:'13px',color:'#1a1a1a',maxWidth:'760px'}}>
                        {g.testo}
                        <div style={{fontSize:'11.5px',color:'#8a8a8a',marginTop:'2px'}}>
                          {g.righe} {g.righe===1?'rettifica':'rettifiche'} · € {g.euro.toFixed(2)} · {g.esempi.join(', ')}{g.righe>g.esempi.length?'…':''}
                        </div>
                      </div>
                      {g.link && (
                        <a href={g.link} style={{background:ACCENT,color:'#fff',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:700,textDecoration:'none',whiteSpace:'nowrap' as const}}>
                          Apri il listino
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                {daFare.azioni.length > 6 && (
                  <button onClick={()=>setTutteAzioni(v=>!v)}
                    style={{marginTop:'8px',background:'#fff',color:'#666',border:'1px solid #e8e8e8',borderRadius:'6px',padding:'5px 12px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>
                    {tutteAzioni ? 'Mostra meno' : `Mostra tutte (${daFare.azioni.length})`}
                  </button>
                )}
              </>}
              {daFare.pronte > 0 && (
                <div style={{marginTop:daFare.azioni.length?'10px':0,fontSize:'13px',color:'#166534',fontWeight:600}}>
                  ✓ {daFare.pronte} {daFare.pronte===1?'rettifica adesso passa':'rettifiche adesso passano'}: il listino è stato sistemato. Ripremi «Gira ai clienti» sulla {daFare.pronte===1?'sua riga':'loro riga'}.
                </div>
              )}
            </div>
          )}

          {/* LE TUE SPEDIZIONI PROPRIE: non è una scelta, sono tue. Riconosciute in automatico (senza cliente + spedite da te),
              un solo tasto per chiuderle: non muove un euro, le toglie solo da quelle da girare. */}
          {proprie.length>0 && (
            <div style={{...card,background:'#fff7ed',border:'1px solid #fed7aa',padding:'14px 16px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                <div>
                  <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>
                    Tue spedizioni senza cliente · {proprie.length} · {eurIt(totaleProprie)}
                  </div>
                  <div style={{fontSize:'12.5px',color:'#8a5a2b',marginTop:'3px',maxWidth:'640px'}}>
                    Le hai spedite tu, senza un cliente: non c'è nessuno a cui girarle, sono già un tuo costo.
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  <button onClick={()=>setApertoBlocco(apertoBlocco==='__proprie__'?'':'__proprie__')} style={btnSecondario}>
                    {apertoBlocco==='__proprie__'?'Chiudi':'Vedi le '+proprie.length}
                  </button>
                  <button onClick={()=>chiudiProprie(proprie.map((r:any)=>r.id))} disabled={propagando==='__proprie__'}
                    style={{...btnPrimario,background:'#1a1a1a',opacity:propagando==='__proprie__'?.6:1}}>
                    {propagando==='__proprie__'?'…':'Ho capito, chiudile'}
                  </button>
                </div>
              </div>
              {apertoBlocco==='__proprie__' && (
                <table style={{width:'100%',borderCollapse:'collapse',background:'#fcfcfc',marginTop:'10px'}}>
                  <thead><tr style={{background:'#f9fafb'}}><th style={th}>LDV</th><th style={th}>Addebito</th></tr></thead>
                  <tbody>
                    {proprie.map((r:any)=>(
                      <tr key={r.id}>
                        <td style={{...td,fontWeight:600}}>{r.numero_spedizione}</td>
                        <td style={{...td,fontWeight:700,color:'#dc2626'}}>€ {(Math.round(((Number(r.differenza)||0)-(Number(r.fuori_sagoma)||0))*100)/100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* GLI ADDEBITI: uno per volta che il livello sopra ti ha addebitato, col totale della Lista movimenti di quel giorno
              e sotto dove sta ogni parte. «Gira ai clienti» e' il vecchio «Carica» (le righe vanno in Rettifica Costi,
              riprezzate col listino di ognuno: nessuno paga finche' non confermi); «Tienile a carico tuo» e' il vecchio
              «Assorbi», dentro la voce «Da girare» perche' e' la scelta rara. */}
          {blocchi.length > 0 && (
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
              <div>
                <div style={{fontSize:'16px',fontWeight:700,color:'#1a1a1a'}}>I tuoi addebiti</div>
                <div style={{fontSize:'12.5px',color:'#52525b',marginTop:'2px'}}>Uno per ogni volta che {mittenti.length === 1 ? mittenti[0] : 'il livello sopra'} ti ha addebitato: il totale è lo stesso della tua Lista movimenti di quel giorno.</div>
              </div>
              {daGirare.length > 1 && (
                <button onClick={()=>decidiBlocco({ k: '__tutte__', daDecidere: tuttiDaDecidere }, 'propagata')} disabled={!!propagando}
                  style={{...btnPrimario,fontSize:'14px',padding:'10px 18px',opacity:propagando?.6:1}}>
                  {propagando==='__tutte__' ? (avanz&&avanz.k==='__tutte__'?`${avanz.fatti}/${avanz.totale}…`:'…') : 'Gira tutte ai clienti'}
                </button>
              )}
            </div>
          )}
          {propagando==='__tutte__' && avanz && avanz.k==='__tutte__' && (
            <BarraAvanzamento fatti={avanz.fatti} totale={avanz.totale} iniziatoIl={avanz.da} etichetta="Giro le rettifiche ai tuoi clienti" sottotitolo="Ogni spedizione viene riprezzata col listino del tuo cliente." />
          )}
          {blocchi.map((b: any) => {
            const voci = vociDelBlocco(b)
            const totN = voci.reduce((t, v) => t + v.righe.length, 0)
            const totE = voci.reduce((t, v) => t + v.euro, 0)
            return (
              <div key={b.k} style={card}>
                <div style={{padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap',borderBottom:'1px solid #f0f0f0'}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:'15px',fontWeight:700,color:'#1a1a1a'}}>{b.da} ti ha addebitato il {b.giorno}{orarioBlocco(b)}</div>
                    <div style={{fontSize:'13px',color:'#3f3f46',marginTop:'3px'}}>
                      {b.parziale
                        ? 'Qui c\'è solo una parte di quel giorno: il resto è più indietro nello storico.'
                        : <>{totN.toLocaleString('it-IT')} {totN === 1 ? 'movimento' : 'movimenti'} per <strong>{eurIt(totE)}</strong>: è il totale della tua Lista movimenti di quel giorno, tipo «rettifica».</>}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                    {b.daDecidere.length > 0 && (
                      <button onClick={()=>decidiBlocco(b,'propagata')} disabled={!!propagando} style={{...btnPrimario,opacity:propagando===b.k?.6:1}}>
                        {propagando===b.k?(avanz&&avanz.k===b.k?`${avanz.fatti}/${avanz.totale}…`:'…'):`Gira ai clienti (${b.daDecidere.length})`}
                      </button>
                    )}
                    <button onClick={()=>scaricaBlocco(b)} style={btnSecondario}>⬇ Excel</button>
                  </div>
                </div>
                {propagando===b.k && avanz && avanz.k===b.k && (
                  <div style={{padding:'12px 16px'}}>
                    <BarraAvanzamento fatti={avanz.fatti} totale={avanz.totale} iniziatoIl={avanz.da} etichetta="Giro le rettifiche ai tuoi clienti" sottotitolo="Ogni spedizione viene riprezzata col listino del tuo cliente." />
                  </div>
                )}
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',minWidth:'720px'}}>
                    <thead><tr style={{background:'#f9fafb'}}>
                      <th style={th}>Dove sono</th><th style={thR}>Movimenti</th><th style={thR}>Hai pagato</th><th style={th}>Dettaglio</th><th style={th}></th>
                    </tr></thead>
                    <tbody>
                      {voci.map(v => {
                        const chiave = b.k + '|' + v.k
                        const aperta = apertoBlocco === chiave
                        return [
                          <tr key={chiave} style={{background:v.k === 'bloccate' ? '#fffbeb' : v.k === 'girare' ? '#fff7ed' : '#fff'}}>
                            <td style={{...td,fontWeight:700}}>{v.nome}</td>
                            <td style={tdR}>{v.righe.length}</td>
                            <td style={{...tdR,fontWeight:600}}>{eurIt(v.euro)}</td>
                            <td style={{...td,color:'#52525b'}}>{notaVoce(v)}</td>
                            <td style={{...td,textAlign:'right'}}>
                              <button onClick={()=>setApertoBlocco(aperta ? '' : chiave)} style={{...btnSecondario,padding:'5px 10px',fontSize:'12px'}}>{aperta ? 'Chiudi' : 'Vedi'}</button>
                            </td>
                          </tr>,
                          aperta ? (
                            <tr key={chiave + ':aperta'}><td colSpan={5} style={{padding:0,borderTop:'1px solid #f0f0f0'}}>
                              {v.k === 'girare' && (
                                <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center',padding:'10px 16px',background:'#fafafa'}}>
                                  <button onClick={()=>decidiBlocco(b,'assorbita')} disabled={!!propagando} style={btnSecondario}>Tienile a carico tuo ({b.daDecidere.length})</button>
                                  <span style={{fontSize:'12px',color:'#71717a'}}>Non le chiedi a nessuno: restano un tuo costo.</span>
                                </div>
                              )}
                              <div style={{maxHeight:'420px',overflowY:'auto'}}>{tabellaVoce(v.k, v.righe)}</div>
                            </td></tr>
                          ) : null,
                        ]
                      })}
                      <tr style={{background:'#f4f4f5'}}>
                        <td style={{...td,fontWeight:800}}>Totale</td>
                        <td style={{...tdR,fontWeight:800}}>{totN}</td>
                        <td style={{...tdR,fontWeight:800}}>{eurIt(totE)}</td>
                        <td style={{...td,color:'#52525b'}} colSpan={2}>{b.parziale ? '' : 'uguale alla Lista movimenti di quel giorno'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
      <div style={card}>
          <>
          {tab==='contrassegni' && (
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                <th style={th}>Data</th><th style={th}>Da</th><th style={th}>Distinta</th><th style={th}>LDV incluse</th><th style={th}>Totale dovuto</th><th style={th}>Stato</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {dati.contrassegni.length===0 ? <tr><td colSpan={7} style={{...td,textAlign:'center',color:'#999',padding:'32px'}}>Nessuna rimessa ricevuta</td></tr> :
                dati.contrassegni.map((c:any)=>(
                  <tr key={c.id}>
                    <td style={td}>{new Date(c.created_at).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{c.masters?.nome||'—'}</td>
                    <td style={{...td,fontWeight:600}}>#{c.numero}</td>
                    <td style={td}>{(c.distinte_contrassegni_righe||[]).map((x:any)=>x.numero_spedizione).join(', ')||'—'}</td>
                    <td style={{...td,fontWeight:700,color:'#16a34a'}}>€ {Number(c.totale_rimborsato ?? c.totale_iniziale).toFixed(2)}</td>
                    <td style={td}>
                      <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:c.stato==='pagata'?'#dcfce7':'#fef3c7',color:c.stato==='pagata'?'#166534':'#92400e'}}>
                        {c.stato==='pagata'?('Pagata'+(c.data_pagamento?' il '+new Date(c.data_pagamento).toLocaleDateString('it-IT'):'')):'Da ricevere'}
                      </span>
                    </td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {c.accettata_target ? (
                        <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#dcfce7',color:'#166534'}}>✓ Accettata</span>
                      ) : (
                        <button onClick={()=>accettaContrassegno(c)} disabled={accettando===c.id}
                          style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',padding:'5px 10px',fontSize:'12px',fontWeight:600,cursor:'pointer',opacity:accettando===c.id?.6:1}}>
                          {accettando===c.id?'…':'✓ Accetta e carica'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab==='resi' && (
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f9fafb'}}>
                <th style={th}>Data</th><th style={th}>Da</th><th style={th}>Distinta</th><th style={th}>LDV incluse</th><th style={th}>Totale</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {dati.resi.length===0 ? <tr><td colSpan={6} style={{...td,textAlign:'center',color:'#999',padding:'32px'}}>Nessun reso ricevuto</td></tr> :
                dati.resi.map((r:any)=>(
                  <tr key={r.id}>
                    <td style={td}>{new Date(r.created_at).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{r.masters?.nome||'—'}</td>
                    <td style={{...td,fontWeight:600}}>#{r.numero}</td>
                    <td style={td}>{(Array.isArray(r.voci)?r.voci:[]).map((x:any)=>x.numero).join(', ')||('—')}</td>
                    <td style={{...td,fontWeight:700,color:'#dc2626'}}>€ {Number(r.totale||0).toFixed(2)}</td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {r.accettata_target ? (
                        <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#dcfce7',color:'#166534'}}>✓ Accettato</span>
                      ) : (
                        <button onClick={()=>accettaReso(r)} disabled={accettando===r.id}
                          style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',borderRadius:'6px',padding:'5px 10px',fontSize:'12px',fontWeight:600,cursor:'pointer',opacity:accettando===r.id?.6:1}}>
                          {accettando===r.id?'…':'✓ Accetta e propaga'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </>
      </div>
      )}
    </div>
  )
}
