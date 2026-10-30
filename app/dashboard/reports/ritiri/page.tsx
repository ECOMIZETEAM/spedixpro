'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'
import { giornoRoma, inizioGiornoRomaISO, fineGiornoRomaISO } from '@/lib/date-roma'
import { vettoreFisico } from '@/lib/vettore'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportRitiriPage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [erroreStorico, setErroreStorico] = useState('')
  const [generating, setGenerating] = useState(false)
  // Primo del mese DI ROMA. `new Date(anno, mese, 1).toISOString()` dava l'ultimo giorno del mese
  // prima: a ottobre MULTIEXPRESS si ritrovava dentro 591 ritiri del 30/09 (misurati il 15/10).
  const [filtri, setFiltri] = useState(() => ({
    clienteId:'', vettore:'', contratto:'',
    dal: giornoRoma().slice(0, 8) + '01',
    al: giornoRoma(),
    formato:'PDF'
  }))

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(Array.isArray(d)?d:[])).catch(()=>{})
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d)?d:[])).catch(()=>{})
    caricaStorico()
  }, [])

  // Vettore FISICO del contratto (GLS, BRT, POSTE, SDA, UPS...) letto dai MIEI contratti per nome: il
  // ritiro porta solo il nome, e i GLS/BRT diretti hanno nomi senza il marchio ("PF CE LIGHT").
  const vettoreDiNome = new Map<string, string>()
  for (const c of corrieri) vettoreDiNome.set(String(c.nome_contratto||'').trim(), vettoreFisico(c))
  const vettori = Array.from(new Set(vettoreDiNome.values())).filter(Boolean).sort()
  const contratti = Array.from(vettoreDiNome.keys()).filter(Boolean).sort((a,b)=>a.localeCompare(b,'it'))
  const nomeContratto = (r: any) => String(r.corrieri?.nome_contratto||'').trim()
  const vettoreDi = (r: any) => vettoreDiNome.get(nomeContratto(r)) || vettoreFisico({ nome_contratto: nomeContratto(r) })

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Lo storico dei report: se la rotta risponde con un errore lo si dice, invece di mostrare
  // "Nessun report generato" come se non ce ne fossero.
  async function caricaStorico() {
    const d = await fetch('/api/reports/lista?tipo=ritiri').then(r=>r.json()).catch((e:any)=>({ error: String(e?.message||e) }))
    setErroreStorico(d && !Array.isArray(d) && d.error ? String(d.error) : '')
    setReports(Array.isArray(d) ? d : [])
  }

  // Prima il report veniva solo scaricato al volo e la riga in elenco nasceva senza file:
  // restava un record vuoto, non riscaricabile. Ora il file parte davvero verso il bucket
  // riservato, che risponde con file_path e file_url (link a /api/file, non allo storage).
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo: 'ritiri', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    // L'errore si mostra: in console non lo vedeva nessuno (il DialogProvider e' nel layout della dashboard).
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    await caricaStorico()
  }

  // IL REPORT DICE QUANTI RITIRI, NON QUALI FILTRI HO SCELTO.
  //
  // Prima questa pagina stampava una tabella con dentro le date e il cliente selezionato: il
  // riepilogo di cosa avevi chiesto, non la risposta. Non interrogava nessuna fonte.
  //
  // Ora ha due forme, e sono due domande diverse:
  // - senza un cliente scelto (o su un sotto-master): QUANTI ritiri ha fatto ognuno, in classifica;
  // - su un cliente solo: QUALI sono, uno per riga, con data, corriere e dove passare a ritirare.
  async function generaReport() {
    setGenerating(true)
    try {
      // Giorni di ROMA. La rotta usa `dal` cosi' com'e', ma a `al` aggiunge le 23:59:59 di Greenwich
      // (fino alle 2 di notte italiane del giorno dopo): il taglio esatto si fa qui sotto.
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', inizioGiornoRomaISO(filtri.dal))
      if (filtri.al) params.set('al', filtri.al)
      const res = await fetch('/api/ritiri?' + params.toString())
      const dati: any = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(dati)) {
        await dialog.alert({ title: 'Errore', message: (dati && dati.error) || `I ritiri non si sono caricati (errore ${res.status}).` })
        return
      }
      let ritiri: any[] = dati
      if (filtri.al) { const fine = Date.parse(fineGiornoRomaISO(filtri.al)); ritiri = ritiri.filter((r: any) => Date.parse(r.created_at) <= fine) }

      // Vettore FISICO, non il nome: "ups" per sottostringa non trovava i contratti UPS (247 ritiri
      // dall'1/08 su MULTIEXPRESS) e "gls" perdeva i GLS diretti con nomi senza il marchio.
      if (filtri.vettore) ritiri = ritiri.filter((r: any) => vettoreDi(r) === filtri.vettore)
      if (filtri.contratto) ritiri = ritiri.filter((r: any) => nomeContratto(r) === filtri.contratto)

      // Un sotto-master (id "m:...") raccoglie piu' clienti: li' la classifica serve, il dettaglio no.
      const unCliente = !!filtri.clienteId && !filtri.clienteId.startsWith('m:')
      const nomeCliente = clienti.find((c: any) => c.id === filtri.clienteId)
      const intestazione = unCliente
        ? `Ritiri di ${nomeCliente?.ragione_sociale || nomeCliente?.nome || 'cliente'}`
        : 'Ritiri per cliente'

      let testata: string[]
      let corpo: (string | number)[][]
      if (unCliente) {
        testata = ['Data', 'Corriere', 'Indirizzo di ritiro', 'Colli', 'Codice', 'Stato']
        corpo = ritiri
          .slice()
          .sort((a, b) => String(a.data_ritiro || a.created_at).localeCompare(String(b.data_ritiro || b.created_at)))
          .map(r => [
            r.data_ritiro ? new Date(r.data_ritiro).toLocaleDateString('it-IT') : '—',
            r.corrieri?.nome_contratto || '—',
            [r.mitt_indirizzo, [r.mitt_cap, r.mitt_citta].filter(Boolean).join(' '), r.mitt_provincia ? '(' + r.mitt_provincia + ')' : '']
              .filter(Boolean).join(', '),
            r.colli ?? '—',
            r.cod_ritiro || '—',
            r.stato || '—',
          ])
      } else {
        const perCliente = new Map<string, number>()
        for (const r of ritiri) {
          const nome = r.clienti?.ragione_sociale || r.master_rete || 'Senza cliente'
          perCliente.set(nome, (perCliente.get(nome) || 0) + 1)
        }
        testata = ['Cliente', 'Ritiri']
        corpo = [...perCliente.entries()].sort((a, b) => b[1] - a[1]).map(([nome, n]) => [nome, n])
      }
      // Una riga vuota e' una risposta legittima, ma va detta: un foglio bianco sembra un guasto.
      if (!corpo.length) corpo = [['Nessun ritiro nel periodo', ...Array(testata.length - 1).fill('')]]
      const totale = `Totale ritiri: ${ritiri.length}`

      const base = `report_ritiri_${filtri.dal}`
      const formato = (filtri.formato || 'PDF').toLowerCase()

      if (formato === 'xlsx' || formato === 'csv') {
        const { utils, writeFile, write } = await import('xlsx')
        const ws = utils.aoa_to_sheet([[intestazione], [totale], [], testata, ...corpo])
        const wb = utils.book_new()
        utils.book_append_sheet(wb, ws, 'Ritiri')
        const nomeFile = `${base}.${formato}`
        writeFile(wb, nomeFile)
        const b64 = write(wb, { bookType: formato === 'csv' ? 'csv' : 'xlsx', type: 'base64' })
        await salvaReport(b64, nomeFile, formato)
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF()
        doc.setFontSize(14)
        doc.text(`${intestazione} — ${filtri.dal} / ${filtri.al}`, 14, 15)
        doc.setFontSize(10)
        doc.text(totale, 14, 22)
        autoTable(doc, { startY: 28, head: [testata], body: corpo, styles: { fontSize: 9 }, headStyles: { fillColor: [249, 115, 22] } })
        const nomeFile = `${base}.pdf`
        doc.save(nomeFile)
        // jsPDF restituisce gia' un data: URI, quindi va passato cosi' com'e'.
        await salvaReport(doc.output('datauristring'), nomeFile, 'pdf')
      }
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Report non generato: ' + (e?.message || e) })
    } finally {
      // Il bottone deve tornare cliccabile anche quando qualcosa va storto: prima, se la rete
      // falliva, restava per sempre su "Generazione...".
      setGenerating(false)
    }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Ritiri</h1></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {vettori.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {contratti.map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Data</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Formato</label>
            <select value={filtri.formato} onChange={e=>setF('formato',e.target.value)} style={sel}>
              <option value="PDF">PDF</option><option value="XLSX">Excel</option><option value="CSV">CSV</option>
            </select>
          </div>
        </div>
        <button onClick={generaReport} disabled={generating} style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:generating?0.7:1}}>
          {generating?'Generazione...':'Genera Report'}
        </button>
      </div>
      {erroreStorico && <div style={{background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:'6px',padding:'8px 12px',fontSize:'12px',marginBottom:'10px'}}>Storico dei report non caricato: {erroreStorico}</div>}
      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
