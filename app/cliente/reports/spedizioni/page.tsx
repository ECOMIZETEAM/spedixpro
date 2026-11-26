'use client'
import { useState, useEffect, useContext } from 'react'
import { GraficaNuova } from '@/app/components/grafica/contesto'
import DateRangePicker from '@/app/components/DateRangePicker'
import { useDialog } from '@/app/components/DialogProvider'
import { inviaReport } from '@/lib/report-client'
import { giornoRoma } from '@/lib/date-roma'
import { PROVINCE_ITALIANE } from '@/lib/province-italiane'

const sel = {padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',background:'#fff',color:'#1a1a1a',width:'100%'}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

// Gli stati con le STESSE etichette dell'elenco spedizioni del portale. Mancavano quelli
// dell'annullamento (In annullamento, Annullo in corso, Annullo richiesto): non si potevano filtrare.
const STATI: Record<string, string> = {
  in_lavorazione: 'In Lavorazione', spedita: 'Spedita', in_transito: 'In transito', in_consegna: 'In Consegna',
  consegnata: 'Consegnata', in_giacenza: 'In Giacenza', reso_mittente: 'Reso al mittente',
  non_consegnato: 'Non consegnato', annullamento_pending: 'In annullamento', annullamento_manuale: 'Annullo in corso',
  storno_richiesto: 'Annullo richiesto', annullata: 'Annullata',
}
const etichettaStato = (s: string) => STATI[s] || String(s || '').replace(/_/g, ' ')

const NOTA_ANNULLATE = 'Le spedizioni annullate e rimborsate sono elencate con importo 0,00 € e non entrano nel totale.'
const eur = (n: number) => '€ ' + (Math.round(n * 100) / 100).toFixed(2)

export default function ReportSpedizioniPage() {
  // con la grafica nuova niente emoji: icone a linea dove servono (il foglio delle icone lo carica solo la cornice nuova)
  const nuova = useContext(GraficaNuova).attiva
  const dialog = useDialog()
  const [reports, setReports] = useState<any[]>([])
  const [erroreLista, setErroreLista] = useState('')
  const [vettori, setVettori] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [perPage, setPerPage] = useState(10)
  const [pagina, setPagina] = useState(1)
  // Default = oggi, giorno di ROMA: con toISOString() fra mezzanotte e le 2 "oggi" era ancora ieri.
  // Niente filtri ricordati: un report si chiede ogni volta per il periodo che serve.
  const [filtri, setFiltri] = useState({
    vettore: '', dal: giornoRoma(), al: giornoRoma(),
    provincia: '', stato: '', contrassegno: '', formato: 'PDF'
  })

  useEffect(() => {
    caricaReports()
    // Voci del filtro Vettore: i marchi dei contratti con cui il cliente ha spedito davvero.
    fetch('/api/cliente/reports/vettori').then(r => r.ok ? r.json() : { vettori: [] })
      .then(j => setVettori(Array.isArray(j?.vettori) ? j.vettori : [])).catch(() => {})
  }, [])

  async function caricaReports() {
    const res = await fetch('/api/cliente/reports/lista?tipo=spedizioni').catch(() => null)
    const d = res ? await res.json().catch(() => null) : null
    setReports(Array.isArray(d) ? d : [])
    // Un elenco che non si legge non e' un elenco vuoto: si dice perche'.
    setErroreLista(Array.isArray(d) ? '' : (d?.error || 'Elenco dei report non disponibile'))
  }

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))
  const paginaCorr = Math.min(pagina, totalePagine)
  const _pagReports = reports.slice((paginaCorr-1)*perPage, paginaCorr*perPage)

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const parti = ['dalla_data=' + (filtri.dal||''), 'alla_data=' + (filtri.al||'')]
    if (filtri.vettore) parti.push('vettore=' + filtri.vettore.replace(/\s+/g, '_'))
    if (filtri.stato) parti.push('stato=' + filtri.stato)
    if (filtri.provincia) parti.push('provincia=' + filtri.provincia)
    if (filtri.contrassegno) parti.push('contrassegno=' + filtri.contrassegno)
    const j = await inviaReport({ tipo: 'spedizioni', filtri: parti.join(' '), formato, fileBase64, nomeFile })
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    // L'elenco si rilegge dalla rotta del CLIENTE: prima si chiedeva quella del master.
    await caricaReports()
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (filtri.stato) params.set('stato', filtri.stato)
      if (filtri.dal) params.set('dal', filtri.dal)
      if (filtri.al) params.set('al', filtri.al)
      if (filtri.contrassegno) params.set('contrassegno', filtri.contrassegno)
      if (filtri.provincia) params.set('provincia', filtri.provincia)
      if (filtri.vettore) params.set('vettore', filtri.vettore)

      const res = await fetch(`/api/cliente/reports/spedizioni?${params}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { await dialog.alert({ title: 'Errore', message: 'Report non generato: ' + (j?.error || 'errore ' + res.status) }); return }
      const spedizioni: any[] = Array.isArray(j?.spedizioni) ? j.spedizioni : []
      const aliquota = Number(j?.aliquotaIva ?? 22)
      if (!spedizioni.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessuna spedizione trovata con i filtri selezionati.' }); return }

      // Le annullate arrivano gia' con l'importo rimasto pagato, cioe' 0 se rimborsate (rotta): il
      // totale e' quanto il cliente ha pagato.
      const subtotale = spedizioni.reduce((a: number, s: any) => a + Number(s.costo_totale || 0), 0)
      const nAnnullate = spedizioni.filter((s: any) => s.stato === 'annullata').length
      const formato = filtri.formato.toLowerCase()
      const base = 'report_spedizioni_' + filtri.dal + '_' + filtri.al

      // Excel/CSV (anche dentro lo ZIP): STESSE colonne del report master (builder condiviso), MA con
      // master:false: niente prezzo_corriere, Margine, Rettifica — sono affari del master.
      const foglio = async (tipo: 'xlsx' | 'csv') => {
        const XLSX = await import('xlsx')
        const { righeReportSpedizioni } = await import('@/lib/report-spedizioni-cols')
        const { aggiungiColonneIva, totaliColonneIva } = await import('@/lib/report-spedizioni-cols')
        const rows = righeReportSpedizioni(spedizioni, { master: false })
        rows.forEach((r: any, i: number) => { r.status = etichettaStato(spedizioni[i].stato) })
        const sommaIva = aggiungiColonneIva(rows, spedizioni, aliquota)
        rows.push({} as any)
        rows.push({
          status: 'TOTALE', costo_cliente: Math.round(subtotale * 100) / 100, costo: Math.round(subtotale * 100) / 100,
          ...totaliColonneIva(sommaIva),
        } as any)
        if (nAnnullate) rows.push({ status: NOTA_ANNULLATE } as any)
        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Spedizioni')
        return XLSX.write(wb, { bookType: tipo, type: 'base64' }) as string
      }

      if (formato === 'xlsx' || formato === 'csv') {
        await salvaReport(await foglio(formato), base + '.' + formato, formato)
      } else if (formato === 'pdf') {
        const { default: jsPDF } = await import('jspdf')
        const { default: autoTable } = await import('jspdf-autotable')
        // compress: senza, il PDF esce 12 volte piu' grosso e oltre i 25 MB l'archivio lo rifiuta (lib/report-client.ts).
        const doc = new jsPDF({ orientation: 'landscape', compress: true })
        doc.setFontSize(14)
        doc.text(`Report Spedizioni — ${filtri.dal} / ${filtri.al}`, 14, 15)
        doc.setFontSize(10)
        doc.text(`Totale: ${spedizioni.length} spedizioni` + (nAnnullate ? ` (di cui ${nAnnullate} annullate)` : ''), 14, 22)
        autoTable(doc, {
          startY: 28,
          head: [['N. Spedizione','Cliente','Destinatario','Città','Peso','Colli','Contrassegno','Data','Stato','Extra','Totale €']],
          body: spedizioni.map((s: any) => [
            s.numero, s.clienti?.ragione_sociale||s.mitt_nome, s.dest_nome,
            `${s.dest_citta} (${s.dest_provincia})`, `${s.peso_reale}kg`, s.colli,
            Number(s.contrassegno)>0?`€${s.contrassegno}`:'—',
            new Date(s.created_at).toLocaleDateString('it-IT'),
            etichettaStato(s.stato),
            (s.servizi_accessori||[]).map((e:any)=>`${e.nome} €${Number(e.importo||0).toFixed(2)}`).join('\n') || '-',
            `€${Number(s.costo_totale).toFixed(2)}`
          ]),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [249, 115, 22] },
        })
        // Riepilogo subtotale/IVA/totale. L'aliquota e' quella della scheda del cliente (vuota = 22):
        // prima era 22% per tutti, anche per chi e' allo 0%.
        // Le spedizioni che il master gli ha venduto IVA INCLUSA hanno gia' l'IVA nel prezzo: si
        // scorporano invece di aggiungerla sopra (Lorenzo, 20/11/2026). Quelle ESENTI non hanno IVA
        // (21/11/2026). Senza nessuna delle due i numeri sono quelli di sempre: subtotale, IVA sopra, totale.
        const { sommaVuota, aggiungiRiga, regimeDi } = await import('@/lib/iva-calcolo')
        const somma = spedizioni.reduce((t: any, s: any) => aggiungiRiga(t, Number(s.costo_totale || 0), aliquota, regimeDi(s.iva_regime ?? s.iva_inclusa)), sommaVuota())
        const conInclusa = somma.nInclusa > 0 || somma.nEsente > 0
        // La riga "di cui esente IVA" solo se qualcosa e' esente: senza, il riquadro e' quello di ieri.
        const h = somma.nEsente > 0 ? 6 : 0
        const iva = conInclusa ? somma.iva : subtotale * aliquota / 100
        const totale = conInclusa ? somma.totale : subtotale + iva
        let finalY = (doc as any).lastAutoTable.finalY + 20
        if (finalY + (conInclusa ? 50 + h : 40) > doc.internal.pageSize.getHeight()) { doc.addPage(); finalY = 20 }
        const pageW = doc.internal.pageSize.getWidth()
        const col1 = pageW - 120
        const col2 = pageW - 20
        if (conInclusa) {
          // Pagato dal credito, l'IVA gia' dentro, quella che il master chiede a parte, il totale.
          doc.setDrawColor(200,200,200)
          doc.line(col1 - 10, finalY - 4, col2, finalY - 4)
          doc.setFontSize(9); doc.setTextColor(100,100,100); doc.setFont('helvetica','normal')
          doc.text('SCALATO DAL CREDITO', col1, finalY); doc.text(eur(somma.scalato), col2, finalY, {align:'right'})
          doc.setFontSize(8.5)
          doc.text("di cui IVA gia' compresa", col1 + 4, finalY + 6); doc.text(eur(somma.ivaCompresa), col2, finalY + 6, {align:'right'})
          if (h) { doc.text('di cui esente IVA', col1 + 4, finalY + 12); doc.text(eur(somma.esente), col2, finalY + 12, {align:'right'}) }
          doc.setFontSize(9)
          doc.text('IVA da pagare a parte', col1, finalY + 13 + h); doc.text(eur(somma.ivaDaIncassare), col2, finalY + 13 + h, {align:'right'})
          doc.setDrawColor(34,197,94); doc.setLineWidth(0.8)
          doc.line(col1 - 10, finalY + 18 + h, col2, finalY + 18 + h)
          doc.setFontSize(11); doc.setTextColor(22,163,74); doc.setFont('helvetica','bold')
          doc.text('TOTALE', col1, finalY + 26 + h); doc.text(eur(totale), col2, finalY + 26 + h, {align:'right'})
          doc.setFontSize(8); doc.setTextColor(100,100,100); doc.setFont('helvetica','normal')
          doc.text(`Imponibile ${eur(somma.imponibile)}  ·  Iva (${aliquota}%) ${eur(iva)}` + (h ? `  ·  Esente IVA ${eur(somma.esente)}` : ''), col2, finalY + 32 + h, {align:'right'})
          if (nAnnullate) doc.text(NOTA_ANNULLATE, 14, finalY + 40 + h)
          await salvaReport(doc.output('datauristring'), base + '.pdf', 'pdf')
          return
        }
        // Linea separatore
        doc.setDrawColor(200,200,200)
        doc.line(col1 - 10, finalY - 4, col2, finalY - 4)
        // Subtotale
        doc.setFontSize(9)
        doc.setTextColor(100,100,100)
        doc.setFont('helvetica','normal')
        doc.text('SUBTOTALE', col1, finalY)
        doc.text(eur(subtotale), col2, finalY, {align:'right'})
        // IVA
        doc.text(`Iva (${aliquota}%)`, col1, finalY + 10)
        doc.text(eur(iva), col2, finalY + 10, {align:'right'})
        // Linea verde totale
        doc.setDrawColor(34,197,94)
        doc.setLineWidth(0.8)
        doc.line(col1 - 10, finalY + 16, col2, finalY + 16)
        // Totale verde
        doc.setFontSize(11)
        doc.setTextColor(22,163,74)
        doc.setFont('helvetica','bold')
        doc.text('TOTALE', col1, finalY + 24)
        doc.text(eur(totale), col2, finalY + 24, {align:'right'})
        if (nAnnullate) {
          doc.setFontSize(8); doc.setTextColor(100,100,100); doc.setFont('helvetica','normal')
          doc.text(NOTA_ANNULLATE, 14, finalY + 34)
        }
        await salvaReport(doc.output('datauristring'), base + '.pdf', 'pdf')
      } else if (formato === 'zip') {
        // Lo ZIP e' il CSV del report compresso, ARCHIVIATO come gli altri formati. Prima si scaricava
        // e basta, poi partiva una richiesta di archiviazione a una rotta che non la accettava (405):
        // lo ZIP non compariva mai nell'elenco dei report.
        const { default: JSZip } = await import('jszip' as any)
        const zip = new JSZip()
        zip.file(base + '.csv', await foglio('csv'), { base64: true })
        const zipB64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' })
        await salvaReport(zipB64, base + '.zip', 'zip')
      }
    } catch (e: any) {
      await dialog.alert({ title: 'Errore', message: 'Errore nella generazione del report: ' + (e?.message || e) })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Spedizioni PDF</h1>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px',display:'flex',alignItems:'center',gap:'6px'}}>{nuova ? '' : '🔍 '}Nuovo report</div>

        {/* Riga 1 */}
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
          <div><label style={lbl}>Data</label>
            <DateRangePicker dal={filtri.dal} al={filtri.al} onChange={(dal,al)=>setFiltri(f=>({...f,dal,al}))} />
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {vettori.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Provincia</label>
            <select value={filtri.provincia} onChange={e=>setF('provincia',e.target.value)} style={sel}>
              <option value="">Tutte</option>
              {PROVINCE_ITALIANE.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Stato</label>
            <select value={filtri.stato} onChange={e=>setF('stato',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {Object.entries(STATI).map(([k, v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        {/* Riga 2 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 6fr',gap:'12px',marginBottom:'16px'}}>
          <div><label style={lbl}>Contrassegno</label>
            <select value={filtri.contrassegno} onChange={e=>setF('contrassegno',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="si">Con contrassegno</option>
              <option value="no">Senza contrassegno</option>
            </select>
          </div>
          <div><label style={lbl}>Formato</label>
            <select value={filtri.formato} onChange={e=>setF('formato',e.target.value)} style={sel}>
              <option value="PDF">PDF</option>
              <option value="XLSX">Excel (XLSX)</option>
              <option value="CSV">CSV</option>
              <option value="ZIP">ZIP</option>
            </select>
          </div>
          <div></div>
        </div>

        <button onClick={generaReport} disabled={generating}
          style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:generating?0.7:1}}>
          {generating?'Generazione...':'Genera Report'}
        </button>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'8px',margin:'16px 0 10px'}}>
        <span style={{fontSize:'12.5px',color:'#1a1a1a'}}>Mostra</span>
        <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}} style={{padding:'6px 8px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff'}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>
        <span style={{fontSize:'12.5px',color:'#1a1a1a'}}>elementi</span>
      </div>

      {/* Lista report generati */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
          <thead>
            <tr style={{background:'#f9fafb'}}>
              {['ID','Data','Filtri','Formato','Utente','Size','Status','Scarica'].map(h=>(
                <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'700',textTransform:'uppercase' as const,color:'#1a1a1a',borderBottom:'1px solid #d1d5db'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!reports.length ? (
              <tr><td colSpan={8} style={{padding:'40px',textAlign:'center' as const,color:erroreLista?'#b91c1c':'#1a1a1a',fontSize:'13px'}}>{erroreLista ? 'Elenco non caricato: ' + erroreLista : 'Nessun report generato'}</td></tr>
            ) : _pagReports.map((r:any, ri:number) => (
              <tr key={r.id} style={{borderBottom:'1px solid #d1d5db'}}>
                {/* Numerazione continua fra le pagine, come ReportTable: N − ((pagina−1)·perPage + i). */}
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:'600'}}>{reports.length - ((paginaCorr-1)*perPage + ri)}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td style={{padding:'9px 14px',color:'#f97316',fontSize:'12px'}}>
                  {String(r.filtri||'').split(' ').map((f: string, k: number)=><div key={k}>{f}</div>)}
                </td>
                <td style={{padding:'9px 14px'}}>
                  <span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>{r.formato}</span>
                </td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontWeight:'500'}}>{r.utente||'—'}</td>
                <td style={{padding:'9px 14px',color:'#1a1a1a',fontSize:'12px'}}>{r.size_bytes ? `${Math.max(1,Math.round(r.size_bytes/1024))} KB` : '—'}</td>
                <td style={{padding:'9px 14px',color:'#16a34a',fontSize:'12px',fontWeight:'500'}}>{r.status||'—'}</td>
                <td style={{padding:'9px 14px'}}>
                  <a href={r.file_url} target="_blank" rel="noopener noreferrer" download style={{color:'#f97316',fontWeight:'600',fontSize:'13px',cursor:'pointer',textDecoration:'none'}}>Scarica</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalePagine > 0 && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:'6px',padding:'14px'}}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>
            {Array.from({length:totalePagine},(_, i)=>i+1).filter(n=>n===1||n===totalePagine||Math.abs(n-paginaCorr)<=2).map((n)=>(
              <button key={n} onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',cursor:'pointer'}}>{n}</button>
            ))}
            <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>
          </div>
        )}
      </div>
    </div>
  )
}
