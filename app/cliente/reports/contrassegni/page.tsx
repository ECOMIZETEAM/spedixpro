'use client'
import { useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import DateRangePicker from '@/app/components/DateRangePicker'
import { giornoRoma } from '@/lib/date-roma'

const dataIt = (g: string) => (g || '').slice(0, 10).split('-').reverse().join('/')

// Stati della spedizione con le etichette dell'elenco spedizioni del portale.
const STATI: Record<string, string> = {
  in_lavorazione: 'In Lavorazione', spedita: 'Spedita', in_transito: 'In transito', in_consegna: 'In Consegna',
  consegnata: 'Consegnata', in_giacenza: 'In Giacenza', reso_mittente: 'Reso al mittente',
  non_consegnato: 'Non consegnato', annullamento_pending: 'In annullamento', annullamento_manuale: 'Annullo in corso',
  storno_richiesto: 'Annullo richiesto', annullata: 'Annullata',
}
// Stati del contrassegno: le chiavi sono quelle della rotta (calcolo.ts), che decide anche l'etichetta.
const STATI_CONTR: [string, string][] = [
  ['in_attesa', 'In attesa'], ['in_distinta', 'In lavorazione'], ['pagato', 'Pagato'],
  ['reso', 'Annullato (reso)'], ['annullata', 'Annullata'],
]

export default function ReportContrassegniCliente() {
  const dialog = useDialog()
  // Default = oggi, giorno di ROMA (con toISOString() fra mezzanotte e le 2 "oggi" era ieri).
  const [dal, setDal] = useState(giornoRoma())
  const [al, setAl] = useState(giornoRoma())
  const [statoSped, setStatoSped] = useState('tutti')
  const [statoContr, setStatoContr] = useState('tutti')
  const [generating, setGenerating] = useState(false)
  async function genera() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (dal) params.set('dal', dal)
      if (al) params.set('al', al)
      if (statoSped) params.set('statoSpedizione', statoSped)
      // Prima questo filtro c'era a video ma non partiva mai: il report usciva con tutti gli stati.
      if (statoContr) params.set('statoContrassegno', statoContr)
      const res = await fetch('/api/cliente/reports/contrassegni?' + params.toString())
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { await dialog.alert({ title: 'Errore', message: 'Report non generato: ' + (j?.error || 'errore ' + res.status) }); return }
      const { righe, master, cliente } = j
      if (!righe || !righe.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessun contrassegno trovato nel periodo.' }); return }
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
      const doc = new jsPDF({ compress: true })
      if (master?.logo_url) {
        try {
          const img = await fetch(master.logo_url).then(r=>r.blob()).then(b=>new Promise<string>((res)=>{const fr=new FileReader();fr.onload=()=>res(fr.result as string);fr.readAsDataURL(b)}))
          doc.addImage(img, 'PNG', 14, 12, 55, 22)
        } catch {}
      }
      doc.setFontSize(15); doc.setFont('helvetica','bold'); doc.setTextColor(60,60,60)
      doc.text(master?.nome || '', 196, 22, { align: 'right' })
      doc.setFontSize(9); doc.setFont('helvetica','normal')
      const ind = [master?.indirizzo, master?.cap, master?.citta, master?.provincia].filter(Boolean).join(', ')
      let hy = 30
      if (ind) { doc.text(ind, 196, hy, { align: 'right' }); hy += 5 }
      if (master?.email || master?.email_sede) { doc.text('e-mail : ' + (master?.email_sede||master?.email||''), 196, hy, { align: 'right' }); hy += 5 }
      const piva = master?.piva || master?.partita_iva
      if (piva) { doc.text('PIVA ' + piva, 196, hy, { align: 'right' }); hy += 5 }
      doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(40,40,40)
      doc.text(cliente.ragione_sociale || '', 14, 52)
      doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(90,90,90)
      doc.text('( ' + dataIt(dal) + ' - ' + dataIt(al) + ' )', 14, 60)
      doc.setDrawColor(200,200,200); doc.line(14, 68, 196, 68)
      autoTable(doc, {
        startY: 74,
        styles: { fontSize: 9, cellPadding: 2.5, textColor: [80,80,80] },
        headStyles: { fillColor: [255,255,255], textColor: [80,80,80], fontStyle: 'bold', lineWidth: 0 },
        head: [['Data','Spedizione','Contrassegno','Stato contr.','Stato spedizione']],
        body: righe.map((r: any) => [
          new Date(r.data).toLocaleDateString('it-IT'),
          r.spedizione,
          Number(r.contrassegno||0).toFixed(2) + ' €',
          r.statoContr,
          STATI[r.statoSpedizione] || r.statoSpedizione,
        ]),
      })
      doc.save('report_contrassegni_' + dal + '_' + al + '.pdf')
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Errore nella generazione del report: ' + (e?.message || e) })
    } finally {
      setGenerating(false)
    }
  }
  const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const,marginBottom:'16px'}
  const lbl = {fontSize:'12px',fontWeight:'700' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'6px'}
  const inp = {padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',width:'100%',boxSizing:'border-box' as const}
  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Contrassegni PDF</h1>
      </div>
      <div style={card}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Nuovo report</div>
        <div style={{padding:'20px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'16px'}}>
          <DateRangePicker dal={dal} al={al} onChange={(d,a)=>{setDal(d);setAl(a)}} />
          <div>
            <label style={lbl}>Stato spedizione</label>
            <select value={statoSped} onChange={e=>setStatoSped(e.target.value)} style={inp}>
              <option value="tutti">Tutti</option>
              {Object.entries(STATI).map(([k, v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Stato Contrassegni</label>
            <select value={statoContr} onChange={e=>setStatoContr(e.target.value)} style={inp}>
              <option value="tutti">Tutti</option>
              {STATI_CONTR.map(([k, v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>
      <button onClick={genera} disabled={generating} style={{padding:'10px 22px',border:'none',borderRadius:'6px',background:'#f97316',color:'#fff',fontSize:'14px',fontWeight:'700',cursor:'pointer',opacity:generating?0.6:1}}>
        {generating ? 'Generazione...' : 'Genera Report'}
      </button>
    </div>
  )
}
