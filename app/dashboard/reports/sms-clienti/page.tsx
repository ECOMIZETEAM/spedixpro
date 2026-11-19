'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'
import { giornoRoma } from '@/lib/date-roma'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportSmsClientiPage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [erroreElenco, setErroreElenco] = useState('')
  const [generating, setGenerating] = useState(false)
  // Dal primo del mese di Roma a oggi. Con new Date(y, m, 1).toISOString() il "dal" diventava l'ultimo
  // giorno del mese prima (mezzanotte italiana = 22:00 UTC del giorno prima). Nessun cliente
  // preselezionato: prima si partiva sempre dal primo dell'elenco, e "tutti" non si poteva chiedere.
  const [filtri, setFiltri] = useState({
    clienteId: '',
    dal: giornoRoma().slice(0, 8) + '01',
    al: giornoRoma(),
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(Array.isArray(d)?d:[])).catch(()=>{})
    caricaReports()
  }, [])

  // L'elenco dei report, quando non si legge, risponde { error }: si dice, invece di mostrare
  // "Nessun report generato" come se non ce ne fossero.
  async function caricaReports() {
    const d = await fetch('/api/reports/lista?tipo=sms-clienti').then(x => x.json()).catch(() => null)
    setReports(Array.isArray(d) ? d : [])
    setErroreElenco(Array.isArray(d) ? '' : 'Elenco dei report non letto: ' + (d?.error || 'errore di rete'))
  }

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Prima il file veniva solo scaricato al volo e la riga in elenco nasceva senza allegato:
  // niente file_path, quindi "Scarica" non aveva nulla da dare. Ora il PDF viaggia in base64
  // verso /api/reports/salva, che lo mette sul bucket riservato e scrive la riga completa.
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const c = clienti.find((x: any) => x.id === filtri.clienteId)
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
      + (filtri.clienteId ? ' cliente=' + String(c?.ragione_sociale || filtri.clienteId).replace(/\s+/g, '_') : '')
    const j = await inviaReport({ tipo: 'sms-clienti', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    // Il file e' gia' scaricato: l'errore di archiviazione si dice, senza toglierlo.
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Report scaricato ma non archiviato: ' + (j.error || '') }); return }
    await caricaReports()
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al)
      // Solo le spedizioni con l'SMS inviato (notifica_sms si accende a invio riuscito), e solo il
      // movimento della spedizione: il resto del report qui non serve.
      params.set('notificaSms', '1')
      params.set('rettifiche', 'escluse')
      const res = await fetch('/api/reports/spedizioni?' + params.toString())
      const sped = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(sped)) { await dialog.alert({ title: 'Errore', message: 'Report SMS non generato: ' + (sped?.error || ('risposta ' + res.status)) }); return }
      const conSms = sped.filter((s: any) => s.notifica_sms === true)

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
        // Per cliente che ha chiesto (e pagato) l'SMS; senza cliente e' una spedizione propria del master
        // o del sotto-master da cui scende (il nome lo porta la rotta).
        const per = new Map<string, number>()
        for (const s of conSms) {
          const nome = s.clienti?.ragione_sociale || s.diretto_nome || 'Senza cliente'
          per.set(nome, (per.get(nome) || 0) + 1)
        }
        testata = ['Cliente', 'SMS']
        corpo = [...per.entries()].sort((a, b) => b[1] - a[1]).map(([nome, n]) => [nome, n])
      }

      // Il foglio diceva "la notifica al destinatario non e' attiva su questa piattaforma": falso, gli
      // SMS partono (lib/sms.ts) e notifica_sms si accende solo quando l'invio riesce. Zero vuol dire
      // solo che nel periodo, per questi clienti, non ne e' partito nessuno.
      const riepilogo = conSms.length
        ? `${conSms.length} SMS nel periodo`
        : 'Nessun SMS inviato ai destinatari nel periodo, per i clienti scelti.'
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
        // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
        const doc = new jsPDF({ compress: true })
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
      await dialog.alert({ title: 'Errore', message: 'Report SMS non riuscito: ' + (e?.message || '') })
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
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i clienti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile>
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
      {erroreElenco && <div style={{padding:'10px 16px',marginBottom:'10px',border:'1px solid #fecaca',borderRadius:'8px',background:'#fef2f2',color:'#b91c1c',fontSize:'12px'}}>{erroreElenco}</div>}
      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
