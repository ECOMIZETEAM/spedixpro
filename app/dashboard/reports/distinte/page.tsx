'use client'
import { useState, useEffect } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import ReportTable from '@/app/components/ReportTable'
import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'
import { giornoRoma, inizioGiornoRomaISO, fineGiornoRomaISO } from '@/lib/date-roma'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}
const giornoIt = (v: any) => v ? new Date(v).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '—'
const TIPI: Record<string, string> = { spedizione: 'Distinte di spedizione', reso: 'Distinte di reso' }

type Colonna = { titolo: string; valore: (d: any) => any; pdf?: (d: any) => string }

export default function ReportDistintePage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [erroreStorico, setErroreStorico] = useState('')
  const [generating, setGenerating] = useState(false)
  // Primo del mese DI ROMA: `new Date(anno, mese, 1).toISOString()` dava l'ultimo giorno del mese prima.
  const [filtri, setFiltri] = useState(() => ({
    tipo: 'spedizione',
    clienteId: '',
    dal: giornoRoma().slice(0, 8) + '01',
    al: giornoRoma(),
    formato: 'PDF'
  }))

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(Array.isArray(d)?d:[])).catch(()=>{})
    caricaStorico()
  }, [])

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  // Lo storico dei report: se la rotta risponde con un errore lo si dice, invece di mostrare
  // "Nessun report generato" come se non ce ne fossero.
  async function caricaStorico() {
    const d = await fetch('/api/reports/lista?tipo=distinte').then(r=>r.json()).catch((e:any)=>({ error: String(e?.message||e) }))
    setErroreStorico(d && !Array.isArray(d) && d.error ? String(d.error) : '')
    setReports(Array.isArray(d) ? d : [])
  }

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = 'tipo=' + filtri.tipo + ' dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
    const j = await inviaReport({ tipo: 'distinte', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    await caricaStorico()
  }

  // DUE TIPI DI DISTINTA, DUE FONTI.
  // Prima il report leggeva SOLO le distinte di RESO (distinte_resi) sotto il nome "Distinte", che nel
  // portale sono quelle di SPEDIZIONE; e con `al` senza orario l'ultimo giorno restava fuori
  // (MULTIEXPRESS 1-14/10: 72 invece di 75, e con "al" = oggi quelle di oggi non uscivano mai).
  // - Spedizione: la rotta dell'Elenco Distinte (stesso perimetro: rete, niente distinte dei fornitori,
  //   agente sui suoi clienti). Il suo `al` aggiunge le 23:59:59 di Greenwich, cioe' fino alle 2 di notte
  //   italiane del giorno dopo: il taglio esatto al giorno di Roma si fa qui.
  // - Reso: la rotta delle distinte di reso, che usa i confini cosi' come arrivano.
  async function caricaDistinte(): Promise<{ ok: true; righe: any[] } | { ok: false; errore: string }> {
    if (filtri.tipo === 'reso') {
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('cliente_id', filtri.clienteId)
      if (filtri.dal) params.set('dal', inizioGiornoRomaISO(filtri.dal))
      if (filtri.al) params.set('al', fineGiornoRomaISO(filtri.al))
      const res = await fetch(`/api/resi/distinte?${params}`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(j)) return { ok: false, errore: (j && j.error) || `Le distinte di reso non si sono caricate (errore ${res.status}).` }
      return { ok: true, righe: j }
    }
    const params = new URLSearchParams()
    if (filtri.dal) params.set('dal', inizioGiornoRomaISO(filtri.dal))
    if (filtri.al) params.set('al', filtri.al)
    const res = await fetch(`/api/distinte?${params}`)
    const j = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(j)) return { ok: false, errore: (j && j.error) || `Le distinte non si sono caricate (errore ${res.status}).` }
    const fine = filtri.al ? Date.parse(fineGiornoRomaISO(filtri.al)) : Infinity
    let righe = j.filter((d: any) => Date.parse(d.created_at) <= fine)
    // La rotta dell'Elenco non filtra per cliente: lo si fa qui. Un sotto-master ("m:<id>") raccoglie
    // le distinte fatte da lui e dalla sua rete (etichetta "Rete") e quelle fatte da me per lui.
    if (filtri.clienteId.startsWith('m:')) {
      const id = filtri.clienteId.slice(2)
      const nome = clienti.find((c: any) => c.id === filtri.clienteId)?.ragione_sociale
      righe = righe.filter((d: any) => d.master_rete_id === id || (!!nome && d.master_rete === nome))
    } else if (filtri.clienteId) {
      righe = righe.filter((d: any) => d.cliente_id === filtri.clienteId)
    }
    return { ok: true, righe }
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const esito = await caricaDistinte()
      if (!esito.ok) { await dialog.alert({ title: 'Errore', message: esito.errore }); return }
      const distinte = esito.righe
      if (!distinte.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessuna distinta trovata.' }); return }

      // Colonne per tipo. Sulle distinte di spedizione niente prezzo: su quelle dei sotto-master e' il
      // prezzo del LORO cliente, non quello che il diretto paga a me, e sommarlo farebbe un totale falso.
      const colonne: Colonna[] = filtri.tipo === 'reso' ? [
        { titolo: 'Nr', valore: d => d.numero },
        { titolo: 'Data', valore: d => giornoIt(d.created_at) },
        { titolo: 'Cliente', valore: d => d.clienti?.ragione_sociale || (d.sottomaster ? 'Rete: ' + d.sottomaster : '—') },
        { titolo: 'Totale LDV', valore: d => Number(d.totale_ldv || 0) },
        { titolo: 'Stato', valore: d => d.stato || '—' },
        { titolo: 'Totale (€)', valore: d => Number(d.totale || 0), pdf: d => `€${Number(d.totale || 0).toFixed(2)}` },
      ] : [
        { titolo: 'Nr', valore: d => d.numero },
        { titolo: 'Data', valore: d => giornoIt(d.created_at) },
        { titolo: 'Cliente', valore: d => (d.cliente_label || d.clienti?.ragione_sociale || '—') + (d.master_rete ? ` (Rete: ${d.master_rete})` : '') },
        { titolo: 'Contratto', valore: d => d.contratto_label || d.corrieri?.nome_contratto || '—' },
        { titolo: 'Vettore', valore: d => d.vettore || '—' },
        { titolo: 'Totale LDV', valore: d => Number(d.totale_ldv || 0) },
        { titolo: 'Colli', valore: d => Number(d.totale_colli || 0) },
        { titolo: 'Peso (kg)', valore: d => Number(d.totale_peso || 0), pdf: d => Number(d.totale_peso || 0).toFixed(2) },
        { titolo: 'Confermata al vettore', valore: d => d.confermata_vettore ? ('Sì' + (d.data_conferma ? ' ' + giornoIt(d.data_conferma) : '')) : 'No' },
      ]
      const somma = (k: string) => distinte.reduce((acc: number, d: any) => acc + Number(d[k] || 0), 0)
      const riepilogo = filtri.tipo === 'reso'
        ? `${distinte.length} distinte di reso — ${somma('totale_ldv')} LDV — totale €${somma('totale').toFixed(2)}`
        : `${distinte.length} distinte di spedizione — ${somma('totale_ldv')} LDV — ${somma('totale_colli')} colli`
      const nomeBase = `report_distinte_${filtri.tipo}_${filtri.dal}_${filtri.al}`

      const formato = filtri.formato.toLowerCase()
      if (formato === 'xlsx' || formato === 'csv') {
        const XLSX = await import('xlsx')
        const rows = distinte.map((d: any) => Object.fromEntries(colonne.map(c => [c.titolo, c.valore(d)])))
        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Distinte')
        const b64str = XLSX.write(wb, { bookType: formato==='csv'?'csv':'xlsx', type: 'base64' })
        await salvaReport(b64str, `${nomeBase}.${formato==='xlsx'?'xlsx':'csv'}`, formato)
      } else {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        const doc = new jsPDF({ orientation: filtri.tipo === 'reso' ? 'portrait' : 'landscape' })
        doc.setFontSize(14)
        doc.text(`Report ${TIPI[filtri.tipo]} — ${giornoIt(filtri.dal + 'T12:00:00Z')} / ${giornoIt(filtri.al + 'T12:00:00Z')}`, 14, 15)
        doc.setFontSize(10)
        doc.text(riepilogo, 14, 22)
        autoTable(doc, {
          startY: 27,
          head: [colonne.map(c => c.titolo)],
          body: distinte.map((d: any) => colonne.map(c => c.pdf ? c.pdf(d) : String(c.valore(d) ?? '—'))),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [249, 115, 22] },
        })
        if (filtri.tipo === 'reso') {
          const pageH = doc.internal.pageSize.getHeight()
          const pageW = doc.internal.pageSize.getWidth()
          let fy = (doc as any).lastAutoTable.finalY + 16
          if (fy + 12 > pageH - 12) { doc.addPage(); fy = 24 }
          doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30)
          doc.text('TOTALE', pageW - 80, fy)
          doc.text(`EUR ${somma('totale').toFixed(2)}`, pageW - 14, fy, {align:'right'})
        }
        await salvaReport(doc.output('datauristring'), `${nomeBase}.pdf`, 'pdf')
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
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Distinte</h1>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Tipo</label>
            <select value={filtri.tipo} onChange={e=>setF('tipo',e.target.value)} style={sel}>
              {Object.entries(TIPI).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
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
      {erroreStorico && <div style={{background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:'6px',padding:'8px 12px',fontSize:'12px',marginBottom:'10px'}}>Storico dei report non caricato: {erroreStorico}</div>}
      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
