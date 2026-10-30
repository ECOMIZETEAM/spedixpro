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
const nota = {fontSize:'10px',color:'#6b7280',marginTop:'4px',lineHeight:1.3} as const

// GLI STATI DEL CONTRASSEGNO, E COSA VOGLIONO DIRE PER CHI GUARDA.
// Per un master (e il suo staff) l'elenco spedizioni da' lo stato PER LIVELLO
// (lib/contrassegni-stato-livello.ts): "pagato" vuol dire che la distinta del SUO livello e' pagata,
// NON che il cliente finale sia stato pagato — su MULTIEXPRESS 1-14/10 42 contrassegni gia' pagati ai
// clienti dai sotto-master risultano ancora da pagare al suo livello. La vecchia tendina offriva
// "In attesa" = 'in_distinta', che per MULTIEXPRESS dava sempre 0, mentre i 1.708 contrassegni grigi
// (nessuna distinta) stavano sotto "Da pagare" (1-14/10, misurato il 15/10).
// L'agente vede lo stato del cliente finale: stesse quattro voci, significato verso il cliente.
const STATI_COD = ['in_attesa', 'in_distinta', 'pagato', 'annullato'] as const
const ETICHETTE_COD: Record<'rete' | 'agente', Record<string, string>> = {
  rete: {
    in_attesa: 'Da pagare (nessuna distinta al tuo livello)',
    in_distinta: 'In distinta al tuo livello, non pagata',
    pagato: 'Pagato al tuo livello (distinta pagata)',
    annullato: 'Annullato (reso, non si incassa)',
  },
  agente: {
    in_attesa: 'Da pagare al cliente',
    in_distinta: 'In distinta, non ancora pagato al cliente',
    pagato: 'Pagato al cliente',
    annullato: 'Annullato (reso, non si incassa)',
  },
}
const statoCod = (s: any) => (STATI_COD as readonly string[]).includes(String(s.stato_contrassegno)) ? String(s.stato_contrassegno) : 'in_attesa'
const giornoIt = (v: any) => v ? new Date(v).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '—'
const valoreFiltro = (v: string) => String(v).replace(/ /g, '\u00A0')

export default function ReportContrassegniPage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [vista, setVista] = useState<'rete' | 'agente'>('rete')
  const [rimborso, setRimborso] = useState<Record<string, string>>({})
  const [reports, setReports] = useState<any[]>([])
  const [erroreStorico, setErroreStorico] = useState('')
  const [generating, setGenerating] = useState(false)
  const [archivioZip, setArchivioZip] = useState(false)
  const [filtri, setFiltri] = useState(() => ({
    clienteId: '', vettore: '', contratto: '',
    statoSpedizione: '', statoContrassegni: '', periodoRimborso: '',
    dalSpedizione: giornoRoma(),
    alSpedizione: giornoRoma(),
  }))

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1').then(r=>r.json()).then(d=>setClienti(Array.isArray(d)?d:[])).catch(()=>{})
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(Array.isArray(d)?d:[])).catch(()=>{})
    fetch('/api/reports/opzioni-filtri').then(r=>r.json()).then(d=>{
      if (d?.vista === 'agente') setVista('agente')
      setRimborso(d?.rimborso && typeof d.rimborso === 'object' ? d.rimborso : {})
    }).catch(()=>{})
    caricaStorico()
  }, [])

  const etichette = ETICHETTE_COD[vista]
  // Vettore FISICO e contratti dai MIEI contratti (come Elenco e Giacenze): la vecchia tendina mandava
  // 'sda/gls/brt/poste' minuscolo e la rotta confronta col MAIUSCOLO, quindi usciva sempre vuoto.
  const vettoreDiNome = new Map<string, string>()
  for (const c of corrieri) vettoreDiNome.set(String(c.nome_contratto||'').trim(), vettoreFisico(c))
  const vettori = Array.from(new Set(vettoreDiNome.values())).filter(Boolean).sort()
  const contratti = Array.from(vettoreDiNome.keys()).filter(Boolean).sort((a,b)=>a.localeCompare(b,'it'))
  const nomeContratto = (s: any) => String(s.corrieri?.nome_contratto||'').trim()
  const vettoreDi = (s: any) => vettoreDiNome.get(nomeContratto(s)) || vettoreFisico({ nome_contratto: nomeContratto(s) })

  const setF = (k: string, v: string) => setFiltri(f => ({...f, [k]: v}))

  // Lo storico dei report: se la rotta risponde con un errore lo si dice, invece di mostrare
  // "Nessun report generato" come se non ce ne fossero.
  async function caricaStorico() {
    const d = await fetch('/api/reports/lista?tipo=contrassegni').then(r=>r.json()).catch((e:any)=>({ error: String(e?.message||e) }))
    setErroreStorico(d && !Array.isArray(d) && d.error ? String(d.error) : '')
    setReports(Array.isArray(d) ? d : [])
  }

  async function salvaReport(fileBase64: string, nomeFile: string, formato: string) {
    const filtriTxt = ['dalla_data=' + (filtri.dalSpedizione||''), 'alla_data=' + (filtri.alSpedizione||''),
      ...(filtri.vettore ? ['vettore=' + filtri.vettore] : []),
      ...(filtri.contratto ? ['contratto=' + valoreFiltro(filtri.contratto)] : []),
      ...(filtri.statoSpedizione ? ['stato_spedizione=' + filtri.statoSpedizione] : []),
      ...(filtri.statoContrassegni ? ['stato=' + valoreFiltro(etichette[filtri.statoContrassegni] || filtri.statoContrassegni)] : []),
      ...(filtri.periodoRimborso ? ['rimborso=' + filtri.periodoRimborso] : []),
    ].join(' ')
    const j = await inviaReport({ tipo: 'contrassegni', filtri: filtriTxt, formato, fileBase64, nomeFile, clienteId: filtri.clienteId || null })
    if (!j.success) { await dialog.alert({ title: 'Errore', message: 'Errore salvataggio report: ' + (j.error||'') }); return }
    await caricaStorico()
  }

  async function generaReport() {
    setGenerating(true)
    try {
      const params = new URLSearchParams()
      if (filtri.clienteId) params.set('clienteId', filtri.clienteId)
      // Giorni di ROMA: l'elenco usa i confini cosi' come arrivano.
      if (filtri.dalSpedizione) params.set('dal', inizioGiornoRomaISO(filtri.dalSpedizione))
      if (filtri.alSpedizione) params.set('al', fineGiornoRomaISO(filtri.alSpedizione))
      params.set('contrassegno', 'si')
      // Filtri STATO SPEDIZIONE e VETTORE: in origine non venivano MAI applicati (né passati all'API né
      // filtrati) — "Consegnata" dava comunque tutti gli stati. Lo stato lo filtra la rotta; il vettore
      // si filtra qui sotto, sul vettore fisico del contratto.
      if (filtri.statoSpedizione) params.set('stato', filtri.statoSpedizione)
      const res = await fetch(`/api/spedizioni/lista?${params}`)
      let spedizioni = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(spedizioni)) {
        await dialog.alert({ title: 'Errore', message: (spedizioni && spedizioni.error) || `Le spedizioni non si sono caricate (errore ${res.status}).` })
        return
      }
      if (filtri.vettore) spedizioni = spedizioni.filter((s: any) => vettoreDi(s) === filtri.vettore)
      if (filtri.contratto) spedizioni = spedizioni.filter((s: any) => nomeContratto(s) === filtri.contratto)
      // Lo stato che la rotta da' davvero: per livello per il master, del cliente per l'agente.
      if (filtri.statoContrassegni) spedizioni = spedizioni.filter((s: any) => statoCod(s) === filtri.statoContrassegni)
      // Il periodo di rimborso e' un'impostazione dei MIEI clienti: le righe della rete (clienti dei
      // sotto-master) non ce l'hanno verso di me, ed escono solo con "Tutti".
      if (filtri.periodoRimborso) spedizioni = spedizioni.filter((s: any) => !s.master_rete_id && !!s.cliente_id && rimborso[s.cliente_id] === filtri.periodoRimborso)
      if (!spedizioni.length) { await dialog.alert({ title: 'Nessun risultato', message: 'Nessuna spedizione con contrassegno trovata per i filtri selezionati.' }); return }

      // La distinta del livello di chi guarda (la stessa che decide il colore): numero e data pagamento.
      const resD = await fetch('/api/reports/contrassegni-distinte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: spedizioni.map((s: any) => s.id) }),
      })
      const distinte = await resD.json().catch(() => null)
      if (!resD.ok || !distinte || distinte.error) {
        await dialog.alert({ title: 'Errore', message: (distinte && distinte.error) || `Le distinte dei contrassegni non si sono caricate (errore ${resD.status}).` })
        return
      }

      // Gli annullati (resi) restano in elenco ma NON nel totale: quei soldi non arriveranno mai.
      // Se si chiedono apposta ("Annullato") il totale e' il loro.
      const soloAnnullati = filtri.statoContrassegni === 'annullato'
      const annullati = spedizioni.filter((s: any) => statoCod(s) === 'annullato')
      const tot = (arr: any[]) => Math.round(arr.reduce((acc: number, s: any) => acc + Number(s.contrassegno||0), 0) * 100) / 100
      const totContrassegni = soloAnnullati ? tot(spedizioni) : tot(spedizioni.filter((s: any) => statoCod(s) !== 'annullato'))
      const totAnnullati = tot(annullati)

      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'landscape' })
      doc.setFontSize(14)
      doc.text(`Report Contrassegni — spedizioni dal ${giornoIt(filtri.dalSpedizione + 'T12:00:00Z')} al ${giornoIt(filtri.alSpedizione + 'T12:00:00Z')}`, 14, 15)
      doc.setFontSize(10)
      doc.text(soloAnnullati
        ? `Contrassegni annullati (resi, non si incassano): €${totContrassegni.toFixed(2)} — ${spedizioni.length} spedizioni`
        : `Totale contrassegni: €${totContrassegni.toFixed(2)} — ${spedizioni.length - annullati.length} spedizioni`, 14, 22)
      let y = 22
      if (!soloAnnullati && annullati.length) {
        y += 5
        doc.text(`di cui annullati (in elenco, fuori dal totale: resi, non si incassano): ${annullati.length} spedizioni, €${totAnnullati.toFixed(2)}`, 14, y)
      }
      y += 5
      doc.setFontSize(8)
      doc.text(vista === 'rete'
        ? 'Stato al TUO livello: "Pagato" = la distinta del tuo livello e\' pagata, non che il cliente finale sia stato pagato. Prezzo spedizione = quanto ti paga il tuo diretto.'
        : 'Stato verso il cliente. Prezzo spedizione = prezzo pagato dal cliente.', 14, y)
      autoTable(doc, {
        startY: y + 4,
        head: [['N. Spedizione','Cliente','Destinatario','Città','Data','Stato','Stato contrassegno','Distinta','Pagata il','Contrassegno €','Prezzo sped. €']],
        body: spedizioni.map((s: any) => {
          const d = distinte[s.id]
          return [
            s.numero, (s.clienti?.ragione_sociale||s.mitt_nome||'—') + (s.master_rete ? `\nRete: ${s.master_rete}` : ''), s.dest_nome,
            `${s.dest_citta||''}${s.dest_provincia ? ` (${s.dest_provincia})` : ''}`,
            giornoIt(s.created_at),
            String(s.stato||'').replace(/_/g,' '),
            etichette[statoCod(s)],
            d ? `n. ${d.numero}` : '—',
            d?.pagata_il ? giornoIt(d.pagata_il + 'T12:00:00Z') : '—',
            `€${Number(s.contrassegno).toFixed(2)}`,
            s.prezzo_cliente == null ? '—' : `€${Number(s.prezzo_cliente).toFixed(2)}`,
          ]
        }),
        styles: { fontSize: 7 },
        headStyles: { fillColor: [249, 115, 22] },
      })
      // Non scarico subito: salvo il report nel registro (come Report Spedizioni),
      // il download avviene poi dalla lista tramite il link "Scarica".
      const nomeBase = `report_contrassegni_${filtri.dalSpedizione}_${filtri.alSpedizione}`
      if (archivioZip) {
        const { default: JSZip } = await import('jszip' as any)
        const zip = new JSZip()
        const pdfBytes = doc.output('arraybuffer')
        zip.file('report_contrassegni.pdf', pdfBytes)
        const zipB64 = await zip.generateAsync({ type: 'base64' })
        await salvaReport('data:application/zip;base64,' + zipB64, nomeBase + '.zip', 'zip')
      } else {
        await salvaReport(doc.output('datauristring'), nomeBase + '.pdf', 'pdf')
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
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Genera Report Contrassegni PDF</h1>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>🔍 Nuovo report</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr 1fr',gap:'12px',marginBottom:'12px'}}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={filtri.clienteId} onChange={e=>setF('clienteId',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </SelectCercabile>
          </div>
          <div><label style={lbl}>Vettore</label>
            <select value={filtri.vettore} onChange={e=>setF('vettore',e.target.value)} style={sel}>
              <option value="">Tutti i vettori</option>
              {vettori.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Contratto</label>
            <select value={filtri.contratto} onChange={e=>setF('contratto',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              {contratti.map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Stato spedizione</label>
            <select value={filtri.statoSpedizione} onChange={e=>setF('statoSpedizione',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="consegnata">Consegnata</option>
              <option value="in_lavorazione">In Lavorazione</option>
            </select>
          </div>
          <div><label style={lbl}>Stato Contrassegni</label>
            <select value={filtri.statoContrassegni} onChange={e=>setF('statoContrassegni',e.target.value)} style={sel}>
              <option value="">Tutti (annullati fuori dal totale)</option>
              {STATI_COD.map(k=><option key={k} value={k}>{etichette[k]}</option>)}
            </select>
            <div style={nota}>{vista === 'rete'
              ? 'Stato al tuo livello: "pagato" non vuol dire pagato al cliente finale.'
              : 'Stato verso il cliente.'}</div>
          </div>
          <div><label style={lbl}>Periodo di rimborso</label>
            <select value={filtri.periodoRimborso} onChange={e=>setF('periodoRimborso',e.target.value)} style={sel}>
              <option value="">Tutti</option>
              <option value="giornaliero">Giornaliero</option>
              <option value="settimanale">Settimanale</option>
              <option value="mensile">Mensile</option>
            </select>
            <div style={nota}>Dalla scheda dei tuoi clienti: le righe della rete escono solo con "Tutti".</div>
          </div>
        </div>
        <div style={{marginBottom:'14px'}}>
          <label style={lbl}>Data inserimento Spedizione</label>
          <DateRangePicker dal={filtri.dalSpedizione} al={filtri.alSpedizione} onChange={(dal,al)=>setFiltri(f=>({...f,dalSpedizione:dal,alSpedizione:al}))} />
        </div>
        <div style={{marginBottom:'16px',display:'flex',alignItems:'center',gap:'8px'}}>
          <input type="checkbox" checked={archivioZip} onChange={e=>setArchivioZip(e.target.checked)} id="zip"/>
          <label htmlFor="zip" style={{fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>Archivio ZIP</label>
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
