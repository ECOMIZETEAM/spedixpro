'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { inviaReport } from '@/lib/report-client'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%',boxSizing:'border-box' as const}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportSmsClientiPage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState({
    clienteId: clienti[0]?.id || '',
    dal: new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>{ setClienti(d||[]); if(d?.[0]) setFiltri(f=>({...f,clienteId:d[0].id})) })
    fetch('/api/reports/lista?tipo=sms-clienti').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Prima il file veniva solo scaricato al volo e la riga in elenco nasceva senza allegato:
  // niente file_path, quindi "Scarica" non aveva nulla da dare. Ora il PDF viaggia in base64
  // verso /api/reports/salva, che lo mette sul bucket riservato e scrive la riga completa.
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo: 'sms-clienti', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { console.error('Errore salvataggio report: ' + (j.error||'')); return }
    const lista = await fetch('/api/reports/lista?tipo=sms-clienti').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al + 'T23:59:59')
      const sped: any[] = await fetch('/api/reports/spedizioni?' + params.toString()).then(r => r.json())
      // L'SMS al destinatario si chiede spedizione per spedizione: il conto e' quello.
      const conSms = (Array.isArray(sped) ? sped : []).filter(s => s.notifica_sms === true)

      const unCliente = !!filtri.clienteId && !filtri.clienteId.startsWith('m:')
      const c = clienti.find((x: any) => x.id === filtri.clienteId)
      const intestazione = unCliente
        ? `SMS di ${c?.ragione_sociale || c?.nome || 'cliente'}`
        : 'SMS per cliente'

      let testata: string[]
      let corpo: (string | number)[][]
      if (unCliente) {
        testata = ['Data', 'Spedizione', 'Destinatario', 'Numero avvisato']
        corpo = conSms
          .slice()
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
          .map(s => [
            s.created_at ? new Date(s.created_at).toLocaleDateString('it-IT') : '—',
            s.numero || '—', s.dest_nome || '—', s.dest_telefono || '—',
          ])
      } else {
        const per = new Map<string, number>()
        for (const s of conSms) {
          const nome = s.clienti?.ragione_sociale || 'Senza cliente'
          per.set(nome, (per.get(nome) || 0) + 1)
        }
        testata = ['Cliente', 'SMS']
        corpo = [...per.entries()].sort((a, b) => b[1] - a[1]).map(([nome, n]) => [nome, n])
      }

      // ZERO E' LA RISPOSTA GIUSTA, OGGI.
      // L'avviso via SMS al destinatario si accende dalle impostazioni del cliente, ma non c'e'
      // nessun operatore telefonico collegato e nessuno spedisce davvero quei messaggi: su tutte
      // le spedizioni fatte finora la casella e' spenta. Il report quindi e' corretto e conta le
      // spedizioni con l'avviso richiesto — il giorno che gli SMS partiranno davvero, qui si
      // vedranno da soli. Ma il foglio deve dirlo, altrimenti sembra un guasto.
      const riepilogo = conSms.length
        ? `${conSms.length} SMS nel periodo`
        : 'Nessun SMS: la notifica al destinatario non e\' attiva su questa piattaforma.'
      if (!corpo.length) corpo = [['Nessun SMS nel periodo', ...Array(testata.length - 1).fill('')]]

      const base = `report_sms_clienti_${filtri.dal}`
      const formato = (filtri.formato || 'PDF').toLowerCase()

      if (formato === 'xlsx' || formato === 'csv') {
        const { utils, writeFile, write } = await import('xlsx')
        const ws = utils.aoa_to_sheet([[intestazione], [riepilogo], [], testata, ...corpo])
        const wb = utils.book_new()
        utils.book_append_sheet(wb, ws, 'SMS')
        const nomeFile = `${base}.${formato}`
        writeFile(wb, nomeFile)
        await salvaReport(write(wb, { bookType: formato === 'csv' ? 'csv' : 'xlsx', type: 'base64' }), nomeFile, formato)
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF()
        doc.setFontSize(14)
        doc.text(`${intestazione} — ${filtri.dal} / ${filtri.al}`, 14, 15)
        doc.setFontSize(10)
        doc.text(riepilogo, 14, 22)
        autoTable(doc, { startY: 28, head: [testata], body: corpo, styles: { fontSize: 9 }, headStyles: { fillColor: [249, 115, 22] } })
        const nomeFile = `${base}.pdf`
        doc.save(nomeFile)
        await salvaReport(doc.output('datauristring'), nomeFile, 'pdf')
      }
    } catch (e: any) {
      console.error('Report SMS non riuscito:', e?.message || e)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report SMS per Cliente</h1></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Cliente</label>
            <select value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
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
