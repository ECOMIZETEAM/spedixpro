'use client'
import { useState, useEffect } from 'react'
import BarraAvanzamento from '@/app/components/BarraAvanzamento'

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

  async function carica() {
    setLoading(true)
    const d = await fetch('/api/network/ricevuti').then(r=>r.json()).catch(()=>null)
    if (d && !d.error) setDati(d)
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
      if (!m.has(k)) m.set(k, { k, da, giorno, ts: 0, primo: Infinity, righe: [], totale: 0, totaleDaDecidere: 0, daDecidere: [], parziale: false, proprie: [], totaleProprie: 0 })
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

  // SCARICA: le righe del blocco in Excel, cosi' chi le riceve puo' controllarle (o girarle a chi
  // misura) prima di decidere. Sono gia' addebitate: scaricarle non cambia niente.
  async function scaricaBlocco(b: any) {
    const { utils, writeFile } = await import('xlsx')
    // Anche le tue spedizioni proprie dello stesso addebito: il file deve tornare col totale del mittente.
    const righe = [...b.righe, ...(b.proprie || [])].map((r: any) => {
      const vol = Number(r.peso_volume_reale) || 0, reale = Number(r.peso_reale) || 0
      return {
        'LDV': r.numero_spedizione,
        'Peso dichiarato (kg)': Math.max(Number(r.peso_iniziale) || 0, Number(r.peso_volume_iniziale) || 0),
        'Peso rilevato (kg)': Math.max(reale, vol),
        'Volumetrico': vol > reale ? 'si' : '',
        'Costo prima (€)': Number(r.costo_iniziale) || 0,
        'Costo dopo (€)': Number(r.costo_finale) || 0,
        'Addebito (€)': Math.round((Number(r.differenza || 0) - Number(r.fuori_sagoma || 0)) * 100) / 100,
        'di cui supplementi (€)': Number(r.fuori_sagoma) || 0,
        'Stato': r.propria && !r.propagazione ? 'Tua spedizione (già a tuo carico)' : r.propagazione === 'propagata' ? 'Caricata' : r.propagazione === 'assorbita' ? 'Assorbita' : r.propagazione === 'annullata' ? 'Annullata' : 'Da decidere',
      }
    })
    const wb = utils.book_new(); utils.book_append_sheet(wb, utils.json_to_sheet(righe), 'Rettifiche')
    writeFile(wb, `rettifiche-da-${String(b.da || 'network').replace(/[^\w-]+/g, '_')}-${String(b.giorno || '').replace(/\//g, '-')}.xlsx`)
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
        else setMsg(`✓ ${d.assorbite ?? ids.length} rettifiche assorbite: restano a tuo carico, la tua rete non viene toccata.`)
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
      if (create > 0) parti.push(`✓ Caricate ${create}: sono in Spedizioni › Rettifica Costi, divise per cliente e sotto-master — da lì scegli a chi caricarle (fino ad allora non scende niente a nessuno).`)
      // A zero: il livello sotto non deve niente, ma chi sta sotto di lui si'. Si dice perche' esistono.
      if (aZero > 0) parti.push(`✓ Di queste, ${aZero} sono a zero: a chi le riceve non costano niente, ma più sotto qualcuno deve ancora pagare la differenza — caricale insieme alle altre, servono a farla arrivare fin lì.`)
      // Scartate = il cliente pagherebbe uguale (stesso scaglione): niente da recuperare. NON è un
      // problema né una perdita da sistemare — si dice con calma, non fra gli avvisi ⚠️.
      if (scart) parti.push(`✓ ${scart} scartate: col suo listino il cliente pagherebbe uguale (stesso scaglione di peso) — niente da recuperare, niente da fare.`)
      if (nonProp) {
        // TUTTE, non solo le prime 30: oltre il taglio "sparivano" e sembravano perse. Cap alto + conteggio.
        // Il motivo è per RIGA (il listino non copre quel peso/zona, misure mancanti, catena incompleta):
        // non si mette più un consiglio unico "alza la fascia" a tappeto, che era sbagliato per metà dei casi.
        // Il motivo di ognuna resta anche nel riquadro «Cosa devi fare», che non sparisce al «Carica» dopo: qui se ne
        // mostrano le prime, la' ci sono tutte, raggruppate per cosa sistemare.
        const CAP = 10
        const elenco = dettaglio.slice(0, CAP).map((x: any) => `${x.ldv} — ${x.perche}`).join('\n• ')
        const extra = dettaglio.length > CAP ? `\n• … e altre ${dettaglio.length - CAP}` : ''
        parti.push(`⚠️ ${nonProp} non girate. Le trovi tutte nel riquadro «Cosa devi fare» qui sotto, con cosa sistemare; resta lì finché non passano:\n• ${elenco}${extra}`)
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

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Dal mio network</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>Rettifiche, rimesse contrassegni e resi ricevuti dal livello superiore. Qui si ACCETTA: a chi caricarli si decide dopo, dalle rispettive pagine — e solo allora il credito scende di un gradino.</p>
      </div>

      <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={()=>setTab(k)} style={{background:tab===k?ACCENT:'#fff',color:tab===k?'#fff':'#1a1a1a',border:'1px solid '+(tab===k?ACCENT:'#e8e8e8'),borderRadius:'8px',padding:'8px 16px',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>
            {label}{n>0?` (${n})`:''}
          </button>
        ))}
      </div>

      {msg && <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#ea580c',whiteSpace:'pre-line' as const}}>{msg}</div>}

      <div style={card}>
        {loading ? <div style={{padding:'40px',textAlign:'center',color:'#999'}}>Caricamento…</div> : (
          <>
          {tab==='rettifiche' && (
            (blocchi.length===0 && proprie.length===0) ? <div style={{padding:'32px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessuna rettifica ricevuta</div> :
            <div>
              {/* COSA DEVI FARE: appare solo se c'e' qualcosa da sistemare perche' le rettifiche scendano. Una riga per cosa da
                  fare (per cliente o sotto-master e contratto), col peso che serve e gli euro fermi; dal listino di un tuo
                  cliente si va dritti alla sua pagina. Resta finche' non e' sistemato. */}
              {(daFare.azioni.length > 0 || daFare.pronte > 0) && (
                <div style={{borderTop:'1px solid #f0f0f0',background:'#fef2f2',padding:'14px 16px'}}>
                  {daFare.azioni.length > 0 && <>
                    <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>
                      ⚠ Cosa devi fare · {daFare.totaleRighe} {daFare.totaleRighe===1?'rettifica ferma':'rettifiche ferme'} · <span style={{color:'#dc2626'}}>€ {daFare.totaleEuro.toFixed(2)}</span>
                    </div>
                    <div style={{fontSize:'12px',color:'#7f1d1d',marginTop:'3px',maxWidth:'720px'}}>
                      Queste rettifiche non si possono girare a chi sta sotto finché non sistemi quello che c'è scritto. Te le hanno già scalate: finché restano qui sono a tuo carico.
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
                      ✓ {daFare.pronte} {daFare.pronte===1?'rettifica adesso passa':'rettifiche adesso passano'}: il listino è stato sistemato. Ripremi «Carica» sul {daFare.pronte===1?'suo blocco':'loro blocco'}.
                    </div>
                  )}
                </div>
              )}
              {/* LE TUE SPEDIZIONI PROPRIE: non è una scelta, sono tue. Riconosciute in automatico
                  (senza cliente + spedite da te), mostrate come tali, un solo tasto per chiuderle. */}
              {proprie.length>0 && (
                <div style={{borderTop:'1px solid #f0f0f0',background:'#fff7ed',padding:'14px 16px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                    <div>
                      <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>
                        📦 Tue spedizioni proprie · {proprie.length} · <span style={{color:'#dc2626'}}>€ {Math.abs(totaleProprie).toFixed(2)}</span>
                      </div>
                      <div style={{fontSize:'12px',color:'#8a5a2b',marginTop:'3px',maxWidth:'640px'}}>
                        Le hai spedite <strong>tu</strong>, senza cliente finale: la ripesatura è <strong>già a tuo carico</strong> (te l'hanno scalata). Non c'è nessuno a valle a cui girarla — è tua e basta, niente da propagare.
                      </div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                      <button onClick={()=>setApertoBlocco(apertoBlocco==='__proprie__'?'':'__proprie__')}
                        style={{background:'#fff',color:'#666',border:'1px solid #e8e8e8',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>
                        {apertoBlocco==='__proprie__'?'Nascondi':'Vedi le '+proprie.length}
                      </button>
                      <button onClick={()=>chiudiProprie(proprie.map((r:any)=>r.id))} disabled={propagando==='__proprie__'}
                        style={{background:'#1a1a1a',color:'#fff',border:'none',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:700,cursor:'pointer',opacity:propagando==='__proprie__'?.6:1}}>
                        {propagando==='__proprie__'?'…':'✓ Ho capito, chiudile'}
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
              {blocchi.map((b:any)=>(
                <div key={b.k} style={{borderTop:'1px solid #f0f0f0'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',flexWrap:'wrap',padding:'14px 16px'}}>
                    <div>
                      <div style={{fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>
                        Da {b.da} · {b.daDecidere.length > 0
                          ? <><span style={{color:ACCENT}}>{b.daDecidere.length} da caricare</span> · <span style={{color:'#dc2626'}}>€ {Math.abs(b.totaleDaDecidere).toFixed(2)}</span>
                            {(() => { const n = b.daDecidere.filter((id:string)=>daFare.righe[id]).length
                              return n ? <span style={{color:'#dc2626'}}> · ⚠ {n} {n===1?'ferma':'ferme'}: vedi «Cosa devi fare»</span> : null })()}</>
                          : <>{b.righe.length} rettifiche · € {Math.abs(b.totale).toFixed(2)} · <span style={{color:'#999'}}>già decise</span></>}
                      </div>
                      <div style={{fontSize:'12px',color:'#8a8a8a',marginTop:'3px'}}>
                        {/* QUANDO E QUANTO TI E' STATO ADDEBITATO, come lo vede chi te l'ha mandato: e' il numero
                            da confrontare col mittente. Su un blocco a meta' (il giorno piu' vecchio dello storico,
                            vedi lib/network-invii) il totale intero non si scrive: sarebbe sbagliato. */}
                        Addebitate il {b.giorno}{orarioBlocco(b)}
                        {b.parziale ? '' : ` · ${b.righe.length + b.proprie.length} ${b.righe.length + b.proprie.length === 1 ? 'riga' : 'righe'} per € ${Math.abs(b.totale + b.totaleProprie).toFixed(2)}`}
                        {b.proprie.length === 0 ? '' : b.proprie.length === 1
                          ? ` — 1 è una tua spedizione (€ ${Math.abs(b.totaleProprie).toFixed(2)}), la trovi in «Tue spedizioni proprie»`
                          : ` — ${b.proprie.length} sono tue spedizioni (€ ${Math.abs(b.totaleProprie).toFixed(2)}), le trovi in «Tue spedizioni proprie»`}
                        {' '}· già scalate dal tuo credito.
                        {b.daDecidere.length
                          ? (b.righe.length > b.daDecidere.length ? ` Le altre ${b.righe.length - b.daDecidere.length} le hai già decise.` : '') + ' Caricandole vanno nella tua Rettifica Costi, divise per cliente e sotto-master: da lì scegli a chi addebitarle.'
                          : ' Già decise.'}
                      </div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                      <button onClick={()=>setApertoBlocco(apertoBlocco===b.k?'':b.k)}
                        style={{background:'#fff',color:'#666',border:'1px solid #e8e8e8',borderRadius:'6px',padding:'6px 12px',fontSize:'12px',fontWeight:600,cursor:'pointer'}}>
                        {apertoBlocco===b.k?'Nascondi il dettaglio':'Vedi le '+b.righe.length}
                      </button>
                      {b.daDecidere.length>0 && <>
                        <button onClick={()=>decidiBlocco(b,'propagata')} disabled={propagando===b.k}
                          style={{background:ACCENT,color:'#fff',border:'none',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:700,cursor:'pointer',opacity:propagando===b.k?.6:1}}>
                          {propagando===b.k?(avanz&&avanz.k===b.k?`${avanz.fatti}/${avanz.totale}…`:'…'):'Carica ('+b.daDecidere.length+')'}
                        </button>
                        <button onClick={()=>decidiBlocco(b,'assorbita')} disabled={propagando===b.k}
                          style={{background:'#f0fdf4',color:'#166534',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:600,cursor:'pointer'}}>
                          ✓ Assorbi
                        </button>
                      </>}
                      <button onClick={()=>scaricaBlocco(b)}
                        style={{background:'#fff',color:'#1a1a1a',border:'1px solid #e8e8e8',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:600,cursor:'pointer'}}>
                        ⬇ Scarica
                      </button>
                    </div>
                  </div>
                  {propagando===b.k && avanz && avanz.k===b.k && (
                    <div style={{padding:'0 16px 14px'}}>
                      <BarraAvanzamento fatti={avanz.fatti} totale={avanz.totale} iniziatoIl={avanz.da}
                        etichetta="Carico le rettifiche"
                        sottotitolo="Ogni spedizione viene riprezzata sul listino del livello sotto." />
                    </div>
                  )}
                  {apertoBlocco===b.k && (
                    <table style={{width:'100%',borderCollapse:'collapse',background:'#fcfcfc'}}>
                      <thead><tr style={{background:'#f9fafb'}}>
                        <th style={th}>LDV</th><th style={th}>Peso fatturato (vol.)</th><th style={th}>Costo → ricalcolo</th><th style={th}>Differenza</th><th style={th}>Stato</th>
                      </tr></thead>
                      <tbody>
                        {b.righe.map((r:any)=>(
                          <tr key={r.id}>
                            <td style={{...td,fontWeight:600}}>{r.numero_spedizione}</td>
                            {/* Si mostra il peso che FATTURA (max fra reale e volume): con un collo
                                leggero ma ingombrante e' il volume a far salire il costo, e va scritto
                                — altrimenti "14 kg" sembra un peso sceso e la rettifica pare un furto. */}
                            {(() => {
                              const vol = Number(r.peso_volume_reale) || 0
                              const reale = Number(r.peso_reale) || 0
                              const fatt = Math.max(reale, vol)
                              // Il "prima" è il FATTURATO iniziale = max(reale, volume) dichiarati (non il solo
                              // peso_iniziale, che ora è il reale dichiarato): così è coerente col "dopo" (fatt).
                              const iniz = Math.max(Number(r.peso_iniziale) || 0, Number(r.peso_volume_iniziale) || 0)
                              return <td style={td}>{iniz.toFixed(1)} → <strong>{fatt.toFixed(1)}</strong> kg{vol > reale ? <span style={{color:'#ea580c'}}> (vol.)</span> : ''}</td>
                            })()}
                            <td style={td}>€ {Number(r.costo_iniziale).toFixed(2)} → € {Number(r.costo_finale).toFixed(2)}</td>
                            {(() => {
                              // Addebito vero = ripesatura (differenza) + fuori sagoma (fisso, in aggiunta).
                              const add = Math.round((Number(r.differenza || 0) - Number(r.fuori_sagoma || 0)) * 100) / 100
                              return (
                                <td style={{...td,fontWeight:700,color:add<0?'#dc2626':'#16a34a'}}>
                                  € {add.toFixed(2)}
                                  {Number(r.fuori_sagoma || 0) > 0 && (
                                    <span style={{display:'block',fontSize:'10px',fontWeight:600,color:'#7c2d12'}}>di cui supplementi € {Number(r.fuori_sagoma).toFixed(2)}</span>
                                  )}
                                </td>
                              )
                            })()}
                            <td style={td}>
                              {r.propagazione === 'propagata' ? (
                                <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#ffedd5',color:'#ea580c'}}>✓ Caricata — è in Rettifica Costi</span>
                              ) : r.propagazione === 'assorbita' ? (
                                <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#dcfce7',color:'#166534'}}>✓ Assorbita da me</span>
                              ) : r.propagazione === 'annullata' ? (
                                // ANNULLATA non e' ASSORBITA: chi l'ha ricevuta non la paga affatto, l'addebito gli e' stato
                                // restituito con uno storno (file di rettifiche sbagliato, 22/10/2026). Scriverla "assorbita"
                                // diceva che il costo era rimasto a lui.
                                <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#f3f4f6',color:'#4b5563'}}>✕ Annullata — addebito restituito</span>
                              ) : (
                                <>
                                  <span style={{fontSize:'11px',fontWeight:600,padding:'2px 8px',borderRadius:'999px',background:'#fef3c7',color:'#92400e'}}>Da decidere</span>
                                  {daFare.righe[r.id] && <span style={{display:'block',fontSize:'11px',fontWeight:600,color:'#dc2626',marginTop:'3px'}}>⚠ {daFare.righe[r.id]}</span>}
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          )}
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
        )}
      </div>
    </div>
  )
}
