'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'
import { giornoRoma } from '@/lib/date-roma'
import { vettoreFisico } from '@/lib/vettore'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

// Le stesse etichette della pagina Giacenze del menu. Le giacenze appena rilevate hanno lo stato
// vuoto: sono "in attesa di istruzioni".
const STATO_GIACENZA: Record<string, string> = {
  aperta: 'In attesa di istruzioni', in_gestione: 'In gestione', svincolata: 'Svincolata', chiusa: 'Chiusa',
}
const statoGiacenza = (g: any) => STATO_GIACENZA[g.giacenza_stato || 'aperta'] || String(g.giacenza_stato)
const giornoIt = (v: any) => v ? new Date(v).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '—'
const euro = (v: any) => v == null ? '—' : `€${Number(v).toFixed(2)}`
// Lo storico divide i filtri sugli spazi: dentro un valore ("Q GLS NL STANDARD") lo spazio diventa
// indivisibile, cosi' ogni filtro resta su una riga sola.
const valoreFiltro = (v: string) => String(v).replace(/ /g, '\u00A0')

export default function ReportGiacenzePage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [agenti, setAgenti] = useState<string[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [erroreStorico, setErroreStorico] = useState('')
  const [generating, setGenerating] = useState(false)
  const [filtri, setFiltri] = useState(() => ({
    dal: giornoRoma(),
    al: giornoRoma(),
    clienteId: '', vettore: '', contratto: '', stato: '', agente: '', formato: 'PDF'
  }))

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(Array.isArray(d)?d:[])).catch(()=>{})
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d)?d:[])).catch(()=>{})
    fetch('/api/reports/opzioni-filtri').then(r=>r.json()).then(d=>setAgenti(Array.isArray(d?.agenti)?d.agenti:[])).catch(()=>{})
    caricaStorico()
  }, [])

  // Vettore FISICO (GLS, BRT, POSTE, SDA, UPS...) e nomi dei contratti dai MIEI contratti: la prima
  // parola del nome non e' il vettore (i GLS di QUICK si chiamano "Q GLS ..." e "PF CK ...").
  const vettori = Array.from(new Set(corrieri.map((c:any)=>vettoreFisico(c)).filter(Boolean))).sort()
  const contratti = Array.from(new Set(corrieri.map((c:any)=>String(c.nome_contratto||'').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'it'))

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  // Lo storico dei report: se la rotta risponde con un errore lo si dice, invece di mostrare
  // "Nessun report generato" come se non ce ne fossero.
  async function caricaStorico() {
    const d = await fetch('/api/reports/lista?tipo=giacenze').then(r=>r.json()).catch((e:any)=>({ error: String(e?.message||e) }))
    setErroreStorico(d && !Array.isArray(d) && d.error ? String(d.error) : '')
    setReports(Array.isArray(d) ? d : [])
  }

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = ['dalla_data=' + (filtri.dal||''), 'alla_data=' + (filtri.al||''),
      ...(['vettore','contratto','stato','agente'] as const).filter(k=>filtri[k]).map(k=>k + '=' + valoreFiltro(k==='stato' ? (STATO_GIACENZA[filtri.stato]||filtri.stato) : filtri[k]))].join(' ')
    const j = await inviaReport({ tipo: 'giacenze', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    await caricaStorico()
  }

  // IL REPORT DICE LE GIACENZE APERTE NEL PERIODO E QUANTO LE HA PAGATE IL DIRETTO.
  // Prima prendeva le spedizioni CREATE nel periodo e ANCORA in giacenza: una giacenza svincolata il
  // giorno dopo spariva (MULTIEXPRESS 1-14/10: 82 righe su 671 giacenze aperte, misurato il 15/10), e il
  // "Totale" era il nolo della spedizione. Ora il periodo e' la data di apertura della giacenza (giorni di Roma), lo
  // stato di oggi non conta, e l'importo e' la giacenza addebitata al cliente diretto o al sotto-master
  // di prima linea (dai movimenti).
  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams({ report: '1' })
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al)
      if (filtri.vettore) params.set('vettore', filtri.vettore)
      if (filtri.contratto) params.set('contratto', filtri.contratto)
      if (filtri.stato) params.set('stato', filtri.stato)
      if (filtri.agente) params.set('agente', filtri.agente)

      const res = await fetch(`/api/giacenze?${params}`)
      const giacenze = await res.json().catch(() => null)
      // Un errore NON e' "nessun risultato": va detto con il suo messaggio.
      if (!res.ok || !Array.isArray(giacenze)) {
        await dialog.alert({ title: 'Errore', message: (giacenze && giacenze.error) || `Le giacenze non si sono caricate (errore ${res.status}).` })
        return
      }
      if (!giacenze.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessuna giacenza aperta nel periodo per i filtri scelti.' }); return }

      const totGiacenze = Math.round(giacenze.reduce((acc: number, g: any) => acc + Number(g.importo_giacenza||0), 0) * 100) / 100
      const cliente = (g: any) => g.clienti?.ragione_sociale || g.mitt_nome || '—'
      const formato = filtri.formato.toLowerCase()
      if (formato === 'xlsx' || formato === 'csv') {
        const XLSX = await import('xlsx')
        const rows = giacenze.map((g: any) => ({
          'N. Spedizione': g.numero, 'Cliente': cliente(g), 'Rete (sotto-master)': g.master_rete || '',
          'Destinatario': g.dest_nome, 'Città': g.dest_citta, 'Provincia': g.dest_provincia,
          'Contratto': g.corrieri?.nome_contratto || '', 'Vettore': g.vettore || '',
          'Apertura giacenza': giornoIt(g.giacenza_data), 'Stato giacenza': statoGiacenza(g),
          'Motivo': g.giacenza_motivo || '', 'Stato spedizione': String(g.stato||'').replace(/_/g,' '),
          'Importo giacenza addebitato (€)': g.importo_giacenza == null ? '' : Number(g.importo_giacenza),
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Giacenze')
        const b64str = XLSX.write(wb, { bookType: formato==='csv'?'csv':'xlsx', type: 'base64' })
        await salvaReport(b64str, `report_giacenze_${filtri.dal}_${filtri.al}.${formato==='xlsx'?'xlsx':'csv'}`, formato)
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
        const doc = new jsPDF({ orientation: 'landscape', compress: true })
        doc.setFontSize(14)
        doc.text(`Report Giacenze — aperte dal ${giornoIt(filtri.dal + 'T12:00:00Z')} al ${giornoIt(filtri.al + 'T12:00:00Z')}`, 14, 15)
        doc.setFontSize(9)
        doc.text(`${giacenze.length} giacenze aperte nel periodo, qualunque sia lo stato di oggi. Importo = giacenza addebitata al tuo cliente diretto o al sotto-master di prima linea.`, 14, 22)
        autoTable(doc, {
          startY: 27,
          head: [['N. Spedizione','Cliente','Destinatario','Città','Contratto','Apertura','Stato giacenza','Motivo','Stato spedizione','Importo €']],
          body: giacenze.map((g: any) => [
            g.numero, cliente(g) + (g.master_rete ? `\nRete: ${g.master_rete}` : ''), g.dest_nome,
            `${g.dest_citta||''}${g.dest_provincia ? ` (${g.dest_provincia})` : ''}`, g.corrieri?.nome_contratto || '—',
            giornoIt(g.giacenza_data), statoGiacenza(g), g.giacenza_motivo || '—',
            String(g.stato||'').replace(/_/g,' '), euro(g.importo_giacenza),
          ]),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [249, 115, 22] },
        })
        const pageH = doc.internal.pageSize.getHeight()
        const pageW = doc.internal.pageSize.getWidth()
        let fy = (doc as any).lastAutoTable.finalY + 16
        if (fy + 12 > pageH - 12) { doc.addPage(); fy = 24 }
        doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30)
        doc.text('TOTALE ADDEBITATO', pageW - 110, fy)
        doc.text(`EUR ${totGiacenze.toFixed(2)}`, pageW - 14, fy, {align:'right'})
        const pdfB64 = doc.output('datauristring')
        await salvaReport(pdfB64, `report_giacenze_${filtri.dal}_${filtri.al}.pdf`, 'pdf')
      }
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Report non generato: ' + (e?.message || e) })
    } finally {
      // Il bottone torna cliccabile anche quando qualcosa va storto: prima restava su "Generazione...".
      setGenerating(false)
    }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Giacenze</h1>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{marginBottom:'12px'}}>
          <label style={lbl}>Data apertura giacenza</label>
          <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
        </div>
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
          <div><label style={lbl}>Stato giacenza</label>
            <select value={filtri.stato} onChange={e=>setF('stato',e.target.value)} style={sel}>
              <option value="">Tutte</option>
              {Object.entries(STATO_GIACENZA).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Agente</label>
            <select value={filtri.agente} onChange={e=>setF('agente',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {agenti.map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Formato</label>
            <select value={filtri.formato} onChange={e=>setF('formato',e.target.value)} style={sel}>
              <option value="PDF">PDF</option>
              <option value="XLSX">Excel (XLSX)</option>
              <option value="CSV">CSV</option>
            </select>
          </div>
        </div>
        <button onClick={generaReport} disabled={generating}
          style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:generating?0.7:1}}>
          {generating?'Generazione...':'Genera Report'}
        </button>
      </div>
      {/* Lo storico e' quello comune agli altri report: numerazione giusta anche dopo la prima pagina
          (prima ripartiva da capo) e "non conservato" al posto di un link vuoto sulle righe senza file. */}
      {erroreStorico && <div style={{background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:'6px',padding:'8px 12px',fontSize:'12px',marginBottom:'10px'}}>Storico dei report non caricato: {erroreStorico}</div>}
      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
