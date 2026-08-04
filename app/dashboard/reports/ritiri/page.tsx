'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { inviaReport } from '@/lib/report-client'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportRitiriPage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState({
    clienteId:'', vettore:'', contratto:'',
    dal: new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/reports/lista?tipo=ritiri').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Prima il report veniva solo scaricato al volo e la riga in elenco nasceva senza file:
  // restava un record vuoto, non riscaricabile. Ora il file parte davvero verso il bucket
  // riservato, che risponde con file_path e file_url (link a /api/file, non allo storage).
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo: 'ritiri', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    // qui non c'e' il DialogProvider: l'errore finisce in console, senza inventare import
    if (!j.success) { console.error('Errore salvataggio report ritiri: ' + (j.error||'')); return }
    const lista = await fetch('/api/reports/lista?tipo=ritiri').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
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
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al)
      const res = await fetch('/api/ritiri?' + params.toString())
      let ritiri: any[] = await res.json()
      if (!Array.isArray(ritiri)) ritiri = []

      // Il filtro Vettore lavora sul nome del contratto (sda, brt, gls, poste): il contratto si
      // chiama come il corriere, ed e' l'unica cosa che il ritiro porta con se'.
      if (filtri.vettore) {
        const v = filtri.vettore.toLowerCase()
        ritiri = ritiri.filter(r => String(r.corrieri?.nome_contratto || '').toLowerCase().includes(v))
      }

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
      console.error('Report ritiri non riuscito:', e?.message || e)
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
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="sda">SDA</option><option value="gls">GLS</option>
              <option value="brt">BRT</option><option value="poste">Poste Italiane</option>
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
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
      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
