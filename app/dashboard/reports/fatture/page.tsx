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

export default function ReportFatturePage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [erroreElenco, setErroreElenco] = useState('')
  const [generating, setGenerating] = useState(false)
  // Oggi = il giorno di Roma (toISOString da' quello di Greenwich: fra mezzanotte e le 2 era ieri).
  const [filtri, setFiltri] = useState({
    clienteId:'',
    dal: giornoRoma(),
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
    const d = await fetch('/api/reports/lista?tipo=fatture').then(x => x.json()).catch(() => null)
    setReports(Array.isArray(d) ? d : [])
    setErroreElenco(Array.isArray(d) ? '' : 'Elenco dei report non letto: ' + (d?.error || 'errore di rete'))
  }

  const setF = (k:string,v:string) => setFiltri(f=>({...f,[k]:v}))

  // Prima il report veniva solo scaricato al volo e "registrato" senza allegare nulla: nell'elenco
  // restava una riga con il tasto Scarica che non puntava a niente. Ora il file viaggia in base64
  // verso /api/reports/salva, che lo mette sul bucket riservato e scrive file_path/file_url.
  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const c = clienti.find((x: any) => x.id === filtri.clienteId)
    const filtriTxt = 'dalla_data=' + (filtri.dal||'') + ' alla_data=' + (filtri.al||'')
      + (filtri.clienteId ? ' cliente=' + String(c?.ragione_sociale || filtri.clienteId).replace(/\s+/g, '_') : '')
    const j = await inviaReport({ tipo: 'fatture', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    // Il file e' gia' scaricato: l'errore di archiviazione si dice, senza toglierlo.
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Report scaricato ma non archiviato: ' + (j.error || '') }); return }
    await caricaReports()
  }

  // QUANTO HA DA PAGARE OGNUNO, NON QUALI FILTRI HO SCELTO.
  //
  // Due fonti, una per voce, entrambe dalla rotta del report spedizioni (stesso perimetro di chi guarda):
  //  - le SPEDIZIONI create nel periodo, al prezzo della sola spedizione (come il Report Spedizioni);
  //  - le RETTIFICHE ADDEBITATE nel periodo al diretto (?vista=rettifiche), per data dell'addebito:
  //    prese per data della spedizione, le ripesature di settembre arrivate a ottobre non finivano in
  //    nessuna fattura (1-14/10/2026: 4.623 rettifiche, 14.833 €) e cambiavano a posteriori quella di
  //    settembre. Dentro ci sono anche i POD.
  // Importo = spedizioni + rettifiche, e la colonna "di cui rettifiche" viene dalla stessa lettura: prima
  // erano due conti diversi (MULTIEXPRESS 1-7/10: 5.804,33 nella colonna, 3.104,42 dentro l'importo).
  // Una riga per DIRETTO: il cliente diretto o il sotto-master di prima linea, cioe' chi il master fattura.
  // Su un cliente solo, voce per voce, che e' l'allegato da mandargli quando chiede il dettaglio.
  async function generaReport() {
    setGenerating(true)
    try {
      const base = new URLSearchParams()
      if (filtri.clienteId) base.set('clienteId', filtri.clienteId)
      if (filtri.dal) base.set('dal', filtri.dal)
      if (filtri.al) base.set('al', filtri.al)
      const pS = new URLSearchParams(base); pS.set('rettifiche', 'escluse')
      const pR = new URLSearchParams(base); pR.set('vista', 'rettifiche')
      const [resS, resR] = await Promise.all([fetch('/api/reports/spedizioni?' + pS.toString()), fetch('/api/reports/spedizioni?' + pR.toString())])
      const [sped, rett] = await Promise.all([resS.json().catch(() => null), resR.json().catch(() => null)])
      if (!resS.ok || !Array.isArray(sped)) { await dialog.alert({ title: 'Errore', message: 'Spedizioni non lette: ' + (sped?.error || ('risposta ' + resS.status)) }); return }
      if (!resR.ok || !Array.isArray(rett)) { await dialog.alert({ title: 'Errore', message: 'Rettifiche non lette: ' + (rett?.error || ('risposta ' + resR.status)) }); return }

      const c2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
      const eur = (n: number) => c2(n).toFixed(2).replace('.', ',')
      const aliq = (v: any) => (v != null && Number.isFinite(Number(v))) ? Number(v) : 22
      const unCliente = !!filtri.clienteId && !filtri.clienteId.startsWith('m:')
      const c = clienti.find((x: any) => x.id === filtri.clienteId)
      const intestazione = unCliente
        ? `Da fatturare a ${c?.ragione_sociale || c?.nome || 'cliente'}`
        : 'Da fatturare per cliente'

      // Per diretto: spedizioni del periodo + rettifiche addebitate nel periodo, con la sua aliquota.
      type Voce = { nome: string; n: number; sped: number; rett: number; aliquota: number }
      const per = new Map<string, Voce>()
      const voce = (id: string, nome: string, aliquota: any) => {
        let v = per.get(id)
        if (!v) { v = { nome: nome || '—', n: 0, sped: 0, rett: 0, aliquota: aliq(aliquota) }; per.set(id, v) }
        return v
      }
      for (const s of sped) { const v = voce(s.diretto_id, s.diretto_nome, s.aliquota_iva); v.n++; v.sped += Number(s.costo_totale) || 0 }
      for (const r of rett) { const v = voce(r.diretto_id, r.diretto_nome, r.aliquota_iva); v.rett += Number(r.importo) || 0 }
      const voci = [...per.values()]
      const imponibile = voci.reduce((t, v) => t + v.sped + v.rett, 0)
      const rettifiche = voci.reduce((t, v) => t + v.rett, 0)
      const iva = voci.reduce((t, v) => t + (v.sped + v.rett) * v.aliquota / 100, 0)

      let testata: string[]
      let corpo: (string | number)[][]
      if (unCliente) {
        testata = ['Data', 'Spedizione', 'Destinatario / voce', 'Importo €', 'di cui rettifica €']
        const righe = [
          ...sped.map((r: any) => ({ data: r.created_at, riga: [r.numero || '—', r.dest_nome || '—', eur(r.costo_totale), ''] })),
          ...rett.map((r: any) => ({ data: r.created_at, riga: [r.numero || '—', 'Rettifica: ' + (r.descrizione || ''), eur(r.importo), eur(r.importo)] })),
        ].sort((a, b) => String(a.data).localeCompare(String(b.data)))
        corpo = righe.map(x => [x.data ? new Date(x.data).toLocaleDateString('it-IT') : '—', ...x.riga])
        if (corpo.length) {
          const al = voci[0]?.aliquota ?? aliq(c?.aliquota_iva)
          corpo.push([], ['', '', 'IMPONIBILE', eur(imponibile), rettifiche ? eur(rettifiche) : ''], ['', '', `IVA (${al}%)`, eur(iva), ''], ['', '', 'TOTALE', eur(imponibile + iva), ''])
        }
      } else {
        testata = ['Cliente', 'Spedizioni', 'Importo €', 'di cui rettifiche €', 'IVA %', 'IVA €', 'Totale €']
        corpo = voci.sort((a, b) => (b.sped + b.rett) - (a.sped + a.rett))
          .map(v => { const imp = v.sped + v.rett; const i = imp * v.aliquota / 100; return [v.nome, v.n, eur(imp), v.rett ? eur(v.rett) : '', v.aliquota, eur(i), eur(imp + i)] })
        if (corpo.length) corpo.push(['TOTALE', sped.length, eur(imponibile), rettifiche ? eur(rettifiche) : '', '', eur(iva), eur(imponibile + iva)])
      }
      if (!corpo.length) corpo = [['Nessuna spedizione e nessuna rettifica nel periodo', ...Array(testata.length - 1).fill('')]]
      const riepilogo = `${sped.length} spedizioni · imponibile € ${eur(imponibile)}${rettifiche ? ` (di cui rettifiche € ${eur(rettifiche)})` : ''} · IVA € ${eur(iva)} · totale € ${eur(imponibile + iva)}`

      const nomeBase = `report_fatture_${filtri.dal}`
      const formato = (filtri.formato || 'PDF').toLowerCase()

      if (formato === 'xlsx' || formato === 'csv') {
        const { utils, writeFile, write } = await import('xlsx')
        const ws = utils.aoa_to_sheet([[intestazione], [riepilogo], [], testata, ...corpo])
        const wb = utils.book_new()
        utils.book_append_sheet(wb, ws, 'Fatture')
        const nomeFile = `${nomeBase}.${formato}`
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
        autoTable(doc, { startY: 28, head: [testata], body: corpo.map(r => r.map(x => String(x ?? ''))), styles: { fontSize: 9 }, headStyles: { fillColor: [249, 115, 22] } })
        const nomeFile = `${nomeBase}.pdf`
        doc.save(nomeFile)
        await salvaReport(doc.output('datauristring'), nomeFile, 'pdf')
      }
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Report fatture non riuscito: ' + (e?.message || '') })
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
      {erroreElenco && <div style={{padding:'10px 16px',marginBottom:'10px',border:'1px solid #fecaca',borderRadius:'8px',background:'#fef2f2',color:'#b91c1c',fontSize:'12px'}}>{erroreElenco}</div>}
      <ReportTable reports={reports} onScarica={generaReport}/>
    </div>
  )
}
