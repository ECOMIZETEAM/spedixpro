'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import BarraAvanzamento from '@/app/components/BarraAvanzamento'
import { useDialog } from '@/app/components/DialogProvider'
import { leggiFatturaBrt, descriviVoce, type RigaFatturaBrt } from '@/lib/fattura-brt'

/* CONTROLLO FATTURA CORRIERE. Il detentore carica la fattura di BRT (il file TIVAF) e vede spedizione per
 * spedizione quanto ha fatturato BRT, quanto Moove gli ha registrato come costo, e il perché di ogni
 * differenza: peso rimisurato, voci che il listino non ha, listino non allineato, spedizioni annullate che
 * BRT ha fatturato lo stesso.
 *
 * L'addebito ai clienti NON si fa qui: le differenze di peso si mandano alla Rettifica Costi come un file
 * "solo pesi", e lì si confermano come ogni altra rettifica. Una porta sola per i soldi dei pesi. */

type Motivo = { tipo: 'peso' | 'voce' | 'tariffa' | 'annullata' | 'non_calcolabile'; importo: number; testo: string }
type Esito = {
  riga: RigaFatturaBrt
  spedizione: { id: string; numero: string; stato: string; data: string; colli: number; peso: number; contrassegno: number; chi: string } | null
  abbinataPer: 'riferimento' | 'segnacollo' | null
  brt: number; moove: number | null; listino: number | null; zona: string | null; differenza: number | null
  motivi: Motivo[]; voci: Record<string, number>
}
type Filtro = 'tutte' | 'perdita' | 'peso' | 'voce' | 'tariffa' | 'annullata' | 'non_trovata' | 'rientri'

const PACCHETTO = 200
const euro = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const kg = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' kg'
const r2 = (n: number) => Math.round(n * 100) / 100
const FASCE = [3, 5, 10, 20, 30, 50, 100]
const fascia = (p: number) => { const f = FASCE.find(x => p <= x); return f ? `fino a ${f} kg` : 'oltre 100 kg' }
const ARANCIO = '#f97316', ROSSO = '#dc2626', VERDE = '#16a34a', GRIGIO = '#475569'

export default function ControlloFatturaPage() {
  const dialog = useDialog()
  const [contratti, setContratti] = useState<{ id: string; nome: string; attivo: boolean }[] | null>(null)
  const [contrattoId, setContrattoId] = useState('')
  const [nomeFile, setNomeFile] = useState('')
  const [esiti, setEsiti] = useState<Esito[]>([])
  const [avvisi, setAvvisi] = useState<string[]>([])
  const [avanz, setAvanz] = useState<{ fatti: number; totale: number; da: number; etichetta: string } | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('perdita')
  const [cerca, setCerca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [inviando, setInviando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/fatture-corriere/analizza').then(r => r.json()).then(d => {
      const c = d.contratti || []
      setContratti(c); if (c.length === 1) setContrattoId(c[0].id)
    }).catch(() => setContratti([]))
  }, [])

  async function caricaFile(file: File) {
    if (!contrattoId) { await dialog.alert({ title: 'Scegli il contratto', message: 'Prima scegli il contratto BRT a cui si riferisce la fattura.' }); return }
    // BRT scrive il file in ISO-8859-1: letto come UTF-8, le accentate dei destinatari diventerebbero rombi.
    const testo = new TextDecoder('iso-8859-1').decode(await file.arrayBuffer())
    const { righe, errori } = leggiFatturaBrt(testo)
    if (!righe.length) { await dialog.alert({ title: 'File non letto', message: errori.join(' ') || 'Nessuna riga nel file.' }); return }
    setNomeFile(file.name); setEsiti([]); setAvvisi(errori); setPagina(1)
    const tutti: Esito[] = []
    const inizio = Date.now()
    setAvanz({ fatti: 0, totale: righe.length, da: inizio, etichetta: 'Sto confrontando la fattura con le spedizioni' })
    for (let i = 0; i < righe.length; i += PACCHETTO) {
      const res = await fetch('/api/fatture-corriere/analizza', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contrattoId, righe: righe.slice(i, i + PACCHETTO) }),
      })
      const d = await res.json().catch(() => ({ error: 'Risposta non valida' }))
      // A metà: si ferma e lo dice. Un controllo parziale presentato come completo farebbe credere che
      // le spedizioni mancanti non ci siano.
      if (!res.ok || d.error) {
        setAvanz(null)
        await dialog.alert({ title: 'Controllo interrotto', message: `${d.error || 'Errore'} — controllate ${tutti.length} righe su ${righe.length}. Riprova a caricare il file.` })
        setEsiti(tutti); return
      }
      tutti.push(...d.esiti)
      setAvanz({ fatti: Math.min(i + PACCHETTO, righe.length), totale: righe.length, da: inizio, etichetta: 'Sto confrontando la fattura con le spedizioni' })
    }
    setAvanz(null); setEsiti(tutti)
    if (fileRef.current) fileRef.current.value = ''
  }

  const andate = useMemo(() => esiti.filter(e => e.riga.andata), [esiti])
  const trovate = useMemo(() => esiti.filter(e => e.spedizione), [esiti])
  const daRettificare = useMemo(() => trovate.filter(e => e.riga.andata && e.spedizione?.stato !== 'annullata'
    && e.motivi.some(m => m.tipo === 'peso' && m.importo > 0.005)), [trovate])

  const totali = useMemo(() => {
    const t = { brt: 0, brtTrovate: 0, moove: 0, nonTrovate: 0, nNonTrovate: 0, rientri: 0, nRientri: 0 }
    const perMotivo: Record<string, { n: number; euro: number }> = {}
    for (const e of esiti) {
      t.brt += e.brt
      if (!e.riga.andata) { t.rientri += e.brt; t.nRientri++ }
      if (!e.spedizione) { t.nonTrovate += e.brt; t.nNonTrovate++; continue }
      t.brtTrovate += e.brt; t.moove += e.moove || 0
      for (const m of e.motivi) {
        const k = m.tipo === 'voce' ? 'voce:' + (m.testo.match(/sigla BRT "([^"]+)"/)?.[1] || '?') : m.tipo
        const v = perMotivo[k] || { n: 0, euro: 0 }; v.n++; v.euro += m.importo; perMotivo[k] = v
      }
    }
    return { ...t, perMotivo }
  }, [esiti])

  // COSA ALLINEARE NEL LISTINO: a parità di peso, quanto chiede BRT e quanto dice il listino, per zona e fascia.
  // Si guarda la media solo dove ci sono abbastanza spedizioni da non scambiare un caso per una regola.
  const allineare = useMemo(() => {
    const g = new Map<string, { zona: string; fascia: string; n: number; tariffa: number }>()
    for (const e of trovate) {
      const t = e.motivi.find(m => m.tipo === 'tariffa'); if (!t || !e.zona) continue
      const k = e.zona + '|' + fascia(e.riga.pesoTassato)
      const v = g.get(k) || { zona: e.zona, fascia: fascia(e.riga.pesoTassato), n: 0, tariffa: 0 }
      v.n++; v.tariffa += t.importo; g.set(k, v)
    }
    return Array.from(g.values()).filter(v => v.n >= 3).sort((a, b) => Math.abs(b.tariffa) - Math.abs(a.tariffa))
  }, [trovate])

  const filtrate = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return esiti.filter(e => {
      if (filtro === 'perdita' && !((e.differenza ?? 0) > 0.005)) return false
      if (filtro === 'non_trovata' && e.spedizione) return false
      if (filtro === 'rientri' && e.riga.andata) return false
      if (['peso', 'voce', 'tariffa', 'annullata'].includes(filtro) && !e.motivi.some(m => m.tipo === filtro && Math.abs(m.importo) >= 0.01)) return false
      if (!q) return true
      return [e.riga.segnacollo, e.riga.rifNumerico, e.spedizione?.numero, e.spedizione?.chi, e.riga.destinatario, e.riga.localita, e.riga.cap]
        .some(x => String(x || '').toLowerCase().includes(q))
    }).sort((a, b) => (b.differenza ?? b.brt) - (a.differenza ?? a.brt))
  }, [esiti, filtro, cerca])
  const PER_PAGINA = 50
  const pagine = Math.max(1, Math.ceil(filtrate.length / PER_PAGINA))
  const visibili = filtrate.slice((Math.min(pagina, pagine) - 1) * PER_PAGINA, Math.min(pagina, pagine) * PER_PAGINA)

  async function mandaAllaRettifica() {
    const euroPeso = r2(daRettificare.reduce((s, e) => s + (e.motivi.find(m => m.tipo === 'peso')?.importo || 0), 0))
    const ok = await dialog.confirm({
      title: 'Mandare le differenze di peso alla Rettifica?',
      message: `${daRettificare.length} spedizioni che BRT ha tassato più del peso registrato in Moove (col tuo listino ${euro(euroPeso)} in più). `
        + 'Diventano rettifiche "da confermare" nella pagina Rettifica Costi, col peso tassato da BRT: lì ognuno paga col proprio listino, '
        + 'cliente o sotto-master che sia. Finché non le confermi non si muove un euro. Le spedizioni già rettificate vengono saltate.',
      confirmText: 'Manda alla Rettifica',
    })
    if (!ok) return
    setInviando(true)
    // Lo stesso formato e lo stesso giro della pagina Rettifica: due colonne, lettera di vettura e peso.
    // La rotta li riconosce come file "solo pesi" e li passa dal motore delle rettifiche, coi suoi controlli.
    // Il peso come NUMERO: la Rettifica legge i chili col punto decimale e un numero lo prende così com'è.
    const righe = daRettificare.map(e => ({ ldv: e.spedizione!.numero, peso: r2(e.riga.pesoTassato) }))
    const nome = `Fattura BRT ${esiti[0]?.riga.numeroFattura || ''} - differenze di peso`
    const quante = 50
    let da = 0, fileId: string | undefined, creati = 0, gia = 0, nonTrovate = 0, errore = ''
    const inizio = Date.now()
    setAvanz({ fatti: 0, totale: righe.length, da: inizio, etichetta: 'Sto creando le rettifiche' })
    while (da < righe.length) {
      const res = await fetch('/api/rettifiche/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeFile: nome, righe, da, quante, fileId }),
      })
      const d = await res.json().catch(() => ({ error: 'Risposta non valida' }))
      if (d?.error) { errore = d.error; break }
      if (d?.tipo !== 'ripesature') { errore = 'La Rettifica non ha riconosciuto le righe come file di pesi.'; break }
      creati += d.creato || 0; gia += d.giaCaricate || 0; nonTrovate += d.totali?.nonTrovate || 0
      fileId = d.fileId || fileId
      const avanti = (d.da || 0) + (d.quante || 0)
      if (avanti <= da) break
      da = avanti
      setAvanz({ fatti: Math.min(da, righe.length), totale: righe.length, da: inizio, etichetta: 'Sto creando le rettifiche' })
      if (d.finito) break
    }
    setAvanz(null); setInviando(false)
    await dialog.alert({
      title: errore ? 'Invio interrotto' : 'Rettifiche create',
      message: (errore ? errore + ' — ' : '') + `Create ${creati} rettifiche su ${righe.length} spedizioni.`
        + (gia ? ` ${gia} erano già state rettificate e sono state saltate.` : '')
        + (nonTrovate ? ` ${nonTrovate} non sono state trovate dalla Rettifica.` : '')
        + ' Le trovi in Spedizioni → Rettifica Costi: controllale e premi Conferma.',
    })
  }

  async function scaricaExcel() {
    const { utils, writeFile } = await import('xlsx')
    const righe = filtrate.map(e => ({
      'Segnacollo BRT': e.riga.segnacollo, 'Spedizione Moove': e.spedizione?.numero || '', 'Chi ha spedito': e.spedizione?.chi || '',
      'Destinazione': `${e.riga.cap} ${e.riga.localita} (${e.riga.provincia})`, 'Bolla': e.riga.tipoBolla,
      'Peso Moove (kg)': e.spedizione?.peso ?? '', 'Peso tassato BRT (kg)': r2(e.riga.pesoTassato),
      'BRT (€)': e.brt, 'Nolo BRT (€)': e.riga.nolo,
      'Voci BRT': e.riga.voci.map(v => `${descriviVoce(v.sigla).nome} ${v.importo.toFixed(2)}`).join(' + '),
      'Costo Moove (€)': e.moove ?? '', 'Listino al peso BRT (€)': e.listino ?? '', 'Differenza (€)': e.differenza ?? '',
      'Perché': e.spedizione ? e.motivi.map(m => m.testo).join(' | ') : 'Non trovata in Moove',
    }))
    const wb = utils.book_new(); utils.book_append_sheet(wb, utils.json_to_sheet(righe), 'Controllo fattura')
    writeFile(wb, `controllo-fattura-brt-${esiti[0]?.riga.numeroFattura || 'export'}.xlsx`)
  }

  const scheda = (titolo: string, valore: string, nota: string, colore = '#1a1a1a') => (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px', minWidth: '170px', flex: '1 1 170px' }}>
      <div style={{ fontSize: '11px', color: GRIGIO, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{titolo}</div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: colore, marginTop: '4px' }}>{valore}</div>
      <div style={{ fontSize: '11.5px', color: GRIGIO, marginTop: '2px' }}>{nota}</div>
    </div>
  )
  const NOMI_MOTIVO: Record<string, string> = {
    peso: 'Peso o volume rimisurato da BRT', tariffa: 'Listino non allineato a BRT (nolo, carburante, isole, contrassegno)',
    annullata: 'Annullate in Moove ma fatturate da BRT', non_calcolabile: 'Listino senza prezzo per la destinazione',
  }
  const diff = r2(totali.brtTrovate - totali.moove)

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Controllo fattura corriere</h1>
        <p style={{ fontSize: '13px', color: GRIGIO, margin: '4px 0 0' }}>
          Carica il dettaglio della fattura BRT (file TIVAF, .csv): per ogni spedizione vedi quanto ha fatturato BRT, quanto ti ha registrato Moove e perché sono diversi.
        </p>
      </div>

      {contratti && !contratti.length ? (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', fontSize: '13px', color: GRIGIO }}>
          Non hai contratti BRT tuoi: la fattura del corriere la controlla chi detiene il contratto con BRT.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>Contratto</label>
          <select value={contrattoId} onChange={e => setContrattoId(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }}>
            <option value="">Scegli…</option>
            {(contratti || []).map(c => <option key={c.id} value={c.id}>{c.nome}{c.attivo ? '' : ' (non attivo)'}</option>)}
          </select>
          <input ref={fileRef} type="file" accept=".csv,.CSV,text/csv" disabled={!!avanz}
            onChange={e => { const f = e.target.files?.[0]; if (f) caricaFile(f) }} style={{ fontSize: '13px' }} />
          {nomeFile && <span style={{ fontSize: '12px', color: GRIGIO }}>{nomeFile}</span>}
        </div>
      )}

      {avanz && <BarraAvanzamento fatti={avanz.fatti} totale={avanz.totale} iniziatoIl={avanz.da} etichetta={avanz.etichetta} />}
      {avvisi.map((a, i) => <div key={i} style={{ fontSize: '12.5px', color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', padding: '8px 10px', marginBottom: '10px' }}>{a}</div>)}

      {esiti.length > 0 && !avanz && (<>
        <div style={{ fontSize: '13px', color: GRIGIO, marginBottom: '8px' }}>
          Fattura {esiti[0].riga.numeroFattura}{esiti[0].riga.dataFattura ? ` del ${new Date(esiti[0].riga.dataFattura).toLocaleDateString('it-IT')}` : ''}: {esiti.length} righe, {andate.length} andate e {totali.nRientri} rientri.
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {scheda('Fatturato da BRT', euro(totali.brt), `${esiti.length} righe`)}
          {scheda('Costo in Moove', euro(totali.moove), `sulle ${trovate.length} spedizioni trovate`)}
          {scheda('Differenza', (diff > 0 ? '+' : '') + euro(diff), diff > 0 ? 'BRT ti costa più di quanto vedi' : 'vedi un costo più alto del vero', diff > 0.005 ? ROSSO : VERDE)}
          {scheda('Non trovate in Moove', String(totali.nNonTrovate), `${euro(totali.nonTrovate)} di spedizioni fatte altrove`, totali.nNonTrovate ? ARANCIO : '#1a1a1a')}
          {scheda('Da girare ai clienti', String(daRettificare.length), 'spedizioni con peso BRT più alto', daRettificare.length ? ARANCIO : '#1a1a1a')}
        </div>

        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <div style={{ flex: '1 1 380px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>Dove nasce la differenza</div>
            {Object.entries(totali.perMotivo).sort((a, b) => b[1].euro - a[1].euro).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span>{k.startsWith('voce:') ? `Voce BRT non presente nel listino: ${descriviVoce(k.slice(5)).nome} ("${k.slice(5)}")` : NOMI_MOTIVO[k] || k} <span style={{ color: GRIGIO }}>· {v.n}</span></span>
                <span style={{ fontWeight: 700, color: v.euro > 0.005 ? ROSSO : VERDE }}>{v.euro > 0 ? '+' : ''}{euro(r2(v.euro))}</span>
              </div>
            ))}
            {totali.nRientri > 0 && <div style={{ fontSize: '12px', color: GRIGIO, marginTop: '8px' }}>I {totali.nRientri} rientri ({euro(r2(totali.rientri))}) non si confrontano col nolo dell'andata: il reso si addebita col suo flusso.</div>}
          </div>
          <div style={{ flex: '1 1 380px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>Cosa allineare nel listino</div>
            {allineare.length ? allineare.slice(0, 10).map(a => (
              <div key={a.zona + a.fascia} style={{ fontSize: '13px', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
                <b>{a.zona}, {a.fascia}</b>: su {a.n} spedizioni il tuo listino è in media {euro(Math.abs(r2(a.tariffa / a.n)))} {a.tariffa > 0 ? 'più basso' : 'più alto'} di BRT
                {a.tariffa > 0 ? <span style={{ color: ROSSO }}> (perdi {euro(r2(a.tariffa))})</span> : <span style={{ color: GRIGIO }}> (vedi un costo gonfiato di {euro(r2(-a.tariffa))})</span>}
              </div>
            )) : <div style={{ fontSize: '13px', color: GRIGIO }}>Nessuno scarto ricorrente tra listino e BRT.</div>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
          {([['perdita', 'Con perdita'], ['tutte', 'Tutte'], ['peso', 'Peso'], ['voce', 'Voci fuori listino'], ['tariffa', 'Listino'], ['annullata', 'Annullate'], ['non_trovata', 'Non trovate'], ['rientri', 'Rientri']] as [Filtro, string][]).map(([k, l]) => (
            <button key={k} onClick={() => { setFiltro(k); setPagina(1) }}
              style={{ padding: '6px 11px', borderRadius: '6px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (filtro === k ? ARANCIO : '#d1d5db'), background: filtro === k ? ARANCIO : '#fff', color: filtro === k ? '#fff' : '#1a1a1a' }}>{l}</button>
          ))}
          <input value={cerca} onChange={e => { setCerca(e.target.value); setPagina(1) }} placeholder="Cerca segnacollo, spedizione, cliente, località…"
            style={{ flex: '1 1 220px', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }} />
          <button onClick={scaricaExcel} style={{ padding: '7px 12px', borderRadius: '6px', fontSize: '12.5px', fontWeight: 600, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Scarica Excel</button>
          <button onClick={mandaAllaRettifica} disabled={!daRettificare.length || inviando}
            style={{ padding: '7px 12px', borderRadius: '6px', fontSize: '12.5px', fontWeight: 700, border: 'none', background: daRettificare.length ? ARANCIO : '#e5e7eb', color: daRettificare.length ? '#fff' : GRIGIO, cursor: daRettificare.length ? 'pointer' : 'default' }}>
            Manda alla Rettifica ({daRettificare.length})
          </button>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left', color: GRIGIO }}>
                {['Spedizione', 'Chi', 'Destinazione', 'Peso Moove → BRT', 'BRT', 'Moove', 'Differenza', 'Perché'].map(h => <th key={h} style={{ padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibili.map((e, i) => (
                <tr key={e.riga.segnacollo + e.riga.rifNumerico + i} style={{ borderTop: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    <div style={{ color: ARANCIO, fontWeight: 600 }}>{e.spedizione?.numero || e.riga.segnacollo}</div>
                    <div style={{ fontSize: '11px', color: GRIGIO }}>{e.riga.andata ? 'andata' : `rientro (${e.riga.tipoBolla})`}{e.spedizione?.stato === 'annullata' ? ' · annullata' : ''}</div>
                  </td>
                  <td style={{ padding: '8px 10px' }}>{e.spedizione?.chi || <span style={{ color: GRIGIO }}>non in Moove</span>}</td>
                  <td style={{ padding: '8px 10px' }}>{e.riga.cap} {e.riga.localita} ({e.riga.provincia})</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{e.spedizione ? kg(e.spedizione.peso) : '—'} → <b>{kg(r2(e.riga.pesoTassato))}</b></td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }} title={`Nolo ${euro(e.riga.nolo)}` + e.riga.voci.map(v => ` + ${descriviVoce(v.sigla).nome} ${euro(v.importo)}`).join('')}>{euro(e.brt)}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{e.moove != null ? euro(e.moove) : '—'}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontWeight: 700, color: (e.differenza ?? 0) > 0.005 ? ROSSO : (e.differenza ?? 0) < -0.005 ? VERDE : GRIGIO }}>
                    {e.differenza != null ? ((e.differenza > 0 ? '+' : '') + euro(e.differenza)) : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', minWidth: '320px' }}>
                    {!e.spedizione ? <span style={{ color: GRIGIO }}>Nessuna spedizione con riferimento {e.riga.rifNumerico || '—'} o segnacollo {e.riga.segnacollo || '—'} sui tuoi contratti.</span>
                      : !e.riga.andata ? <span style={{ color: GRIGIO }}>Rientro: il reso si addebita col suo flusso.</span>
                      : e.motivi.length ? e.motivi.map((m, j) => <div key={j} style={{ marginBottom: '3px' }}><b style={{ color: m.importo > 0.005 ? ROSSO : VERDE }}>{m.importo > 0 ? '+' : ''}{euro(m.importo)}</b> {m.testo}</div>)
                      : <span style={{ color: VERDE }}>Torna al centesimo.</span>}
                  </td>
                </tr>
              ))}
              {!visibili.length && <tr><td colSpan={8} style={{ padding: '16px', textAlign: 'center', color: GRIGIO }}>Nessuna riga con questo filtro.</td></tr>}
            </tbody>
          </table>
        </div>
        {pagine > 1 && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center', marginTop: '10px', fontSize: '12.5px' }}>
            <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina <= 1} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', cursor: 'pointer' }}>Precedente</button>
            <span>Pagina {Math.min(pagina, pagine)} di {pagine} · {filtrate.length} righe</span>
            <button onClick={() => setPagina(p => Math.min(pagine, p + 1))} disabled={pagina >= pagine} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', cursor: 'pointer' }}>Successiva</button>
          </div>
        )}
      </>)}
    </div>
  )
}
