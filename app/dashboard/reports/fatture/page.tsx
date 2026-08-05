'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { inviaReport } from '@/lib/report-client'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const inp = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function ReportFatturePage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState({
    clienteId:'',
    dal: new Date().toISOString().split('T')[0],
    al: new Date().toISOString().split('T')[0],
    formato:'PDF'
  })

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(d||[]))
    fetch('/api/reports/lista?tipo=fatture').then(r=>r.json()).then(d=>setReports(d||[]))
  }, [])

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Prima il report veniva solo scaricato al volo e "registrato" senza allegare nulla: nell'elenco
  // restava una riga con il tasto Scarica che non puntava a niente. Ora il file viaggia in base64
  // verso /api/reports/salva, che lo mette sul bucket riservato e scrive file_path/file_url.
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo: 'fatture', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    // Qui non c'e' il DialogProvider: l'errore va in console, senza rompere il download gia' avvenuto.
    if (!j.success) { console.error('Errore salvataggio report fatture:', j.error || ''); return }
    const lista = await fetch('/api/reports/lista?tipo=fatture').then(x=>x.json())
    setReports(Array.isArray(lista) ? lista : [])
  }

  // QUANTO HA DA PAGARE OGNUNO, NON QUALI FILTRI HO SCELTO.
  //
  // Prima usciva un foglio con dentro "Cliente / Periodo / Formato": il riepilogo della domanda.
  // Ora ci sono gli importi veri, e vengono dalla stessa fonte del report spedizioni — che e'
  // l'unico posto dove il prezzo verso il cliente e' gia' calcolato come si deve, rettifiche
  // comprese, e con il perimetro giusto per chi sta guardando.
  //
  // Due forme: senza un cliente scelto, una riga per cliente con il totale del periodo, che e' il
  // documento da cui si fattura; su un cliente solo, spedizione per spedizione, che e' l'allegato
  // da mandargli quando chiede il dettaglio.
  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al + 'T23:59:59')
      const sped: any[] = await fetch('/api/reports/spedizioni?' + params.toString()).then(r => r.json())
      const righe = Array.isArray(sped) ? sped : []

      const eur = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',')
      const unCliente = !!filtri.clienteId && !filtri.clienteId.startsWith('m:')
      const c = clienti.find((x: any) => x.id === filtri.clienteId)
      const intestazione = unCliente
        ? `Da fatturare a ${c?.ragione_sociale || c?.nome || 'cliente'}`
        : 'Da fatturare per cliente'

      // Il totale e' gia' comprensivo delle rettifiche: la colonna "di cui rettifiche" e' li' per
      // spiegare uno scostamento, non per essere sommata di nuovo.
      const totale = righe.reduce((t, r) => t + (Number(r.costo_totale) || 0), 0)
      const rettifiche = righe.reduce((t, r) => t + (Number(r.rettifica) || 0), 0)

      let testata: string[]
      let corpo: (string | number)[][]
      if (unCliente) {
        testata = ['Data', 'Spedizione', 'Destinatario', 'Importo €', 'di cui rettifica €']
        corpo = righe
          .slice()
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
          .map(r => [
            r.created_at ? new Date(r.created_at).toLocaleDateString('it-IT') : '—',
            r.numero || '—',
            r.dest_nome || '—',
            eur(r.costo_totale),
            Number(r.rettifica) ? eur(r.rettifica) : '',
          ])
      } else {
        const per = new Map<string, { n: number; tot: number; rett: number }>()
        for (const r of righe) {
          const nome = r.clienti?.ragione_sociale || 'Senza cliente'
          const v = per.get(nome) || { n: 0, tot: 0, rett: 0 }
          v.n++; v.tot += Number(r.costo_totale) || 0; v.rett += Number(r.rettifica) || 0
          per.set(nome, v)
        }
        testata = ['Cliente', 'Spedizioni', 'Importo €', 'di cui rettifiche €']
        corpo = [...per.entries()].sort((a, b) => b[1].tot - a[1].tot)
          .map(([nome, v]) => [nome, v.n, eur(v.tot), v.rett ? eur(v.rett) : ''])
      }
      if (!corpo.length) corpo = [['Nessuna spedizione nel periodo', ...Array(testata.length - 1).fill('')]]
      const riepilogo = `${righe.length} spedizioni · totale € ${eur(totale)}${rettifiche ? ` (di cui rettifiche € ${eur(rettifiche)})` : ''}`

      const base = `report_fatture_${filtri.dal}`
      const formato = (filtri.formato || 'PDF').toLowerCase()

      if (formato === 'xlsx' || formato === 'csv') {
        const { utils, writeFile, write } = await import('xlsx')
        const ws = utils.aoa_to_sheet([[intestazione], [riepilogo], [], testata, ...corpo])
        const wb = utils.book_new()
        utils.book_append_sheet(wb, ws, 'Fatture')
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
      console.error('Report fatture non riuscito:', e?.message || e)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}><h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Fatture</h1></div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti i Clienti</option>
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
      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
