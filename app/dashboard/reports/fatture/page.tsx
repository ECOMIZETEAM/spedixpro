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
  // CLIENTI: stessa regola della Fattura proforma (decisione di Lorenzo, 13/11/2026), dalla rotta
  // /api/reports/fatture: tutti i movimenti del cliente registrati nel periodo — spedizioni, rettifiche,
  // giacenze, resi, servizi, meno i rimborsi. Prima qui c'erano solo spedizioni e rettifiche: a VPERFUME
  // (GTS EXPRESS) a ottobre mancavano 38,30 € di giacenze, resi e servizi, e la proforma dello stesso
  // mese dava un altro totale. Le voci scritte a mano senza spedizione si vedono in una colonna loro ma
  // NON sommano: sono soprattutto correzioni del credito ("ERRATO ACCREDITO" 1.000 € a NUOVAPOSTA).
  //
  // SOTTO-MASTER di prima linea: come prima, dalla rotta del report spedizioni — le spedizioni create nel
  // periodo al prezzo del listino verso di lui, e le rettifiche addebitate nel periodo (?vista=rettifiche,
  // per data dell'addebito: prese per data della spedizione, le ripesature di settembre arrivate a ottobre
  // non finivano in nessuna fattura). Da quella lettura si tengono solo le righe che non sono di un cliente.
  //
  // Una riga per DIRETTO: il cliente diretto o il sotto-master di prima linea, cioe' chi il master fattura.
  // Su un cliente solo, movimento per movimento, che e' l'allegato da mandargli quando chiede il dettaglio.
  async function generaReport() {
    setGenerating(true)
    try {
      const leggi = async (url: string, cosa: string) => {
        const r = await fetch(url)
        const d = await r.json().catch(() => null)
        if (!r.ok || !d || d.error) throw new Error(cosa + ' non lette: ' + (d?.error || ('risposta ' + r.status)))
        return d
      }
      const base = new URLSearchParams()
      if (filtri.dal) base.set('dal', filtri.dal)
      if (filtri.al) base.set('al', filtri.al)
      const c2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
      const eur = (n: number) => c2(n).toFixed(2).replace('.', ',')
      const aliq = (v: any) => (v != null && Number.isFinite(Number(v))) ? Number(v) : 22
      const unCliente = !!filtri.clienteId && !filtri.clienteId.startsWith('m:')
      const unSotto = !!filtri.clienteId && filtri.clienteId.startsWith('m:')
      const c = clienti.find((x: any) => x.id === filtri.clienteId)
      const intestazione = unCliente
        ? `Da fatturare a ${c?.ragione_sociale || c?.nome || 'cliente'}`
        : 'Da fatturare per cliente'

      let testata: string[]
      let corpo: (string | number)[][]
      let riepilogo: string
      if (unCliente) {
        const pC = new URLSearchParams(base); pC.set('clienteId', filtri.clienteId)
        const d = await leggi('/api/reports/fatture?' + pC.toString(), 'Movimenti del cliente')
        testata = ['Data', 'Voce', 'Descrizione', 'Importo €']
        // Il nome della voce senza «— esente IVA»: la stessa voce puo' avere una riga normale e una esente, e
        // il movimento dice da se' se e' esente (marchio qui sotto).
        const voce = new Map<string, string>((d.righe || []).map((r: any) => [r.voce, r.esente ? String(r.descrizione).replace(/ — esente IVA$/, '') : r.descrizione]))
        corpo = (d.movimenti || []).map((m: any) => [new Date(m.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }), (voce.get(m.voce) || m.voce) + (m.iva_inclusa ? ' (IVA incl.)' : m.esente ? ' (esente IVA)' : ''), m.descrizione, eur(m.importo)])
        if (corpo.length) {
          corpo.push([], ...(d.righe || []).map((r: any) => ['', r.descrizione, `${r.quantita}`, eur(r.importo)]),
            ['', '', 'IMPONIBILE', eur(d.imponibile)], ['', '', `IVA (${d.aliquota}%)`, eur(d.iva)],
            // Venduto esente IVA (21/11/2026): fuori dall'imponibile, dentro il totale.
            ...(d.esente ? [['', '', 'ESENTE IVA', eur(d.esente)]] : []), ['', '', 'TOTALE', eur(d.totale)])
          // Spedizioni vendute IVA inclusa: nelle voci sono al netto, l'IVA che contenevano e' nel totale IVA.
          if (d.ivaInclusa?.lordo) corpo.push(['', '', `di cui già pagati IVA compresa: € ${eur(d.ivaInclusa.lordo)} (IVA compresa € ${eur(d.ivaInclusa.iva)}), qui al netto`, ''])
        }
        const fuori = d.aMano || []
        if (fuori.length) {
          corpo.push([], ['', 'VOCI SCRITTE A MANO (non incluse nel totale)', '', ''],
            ...fuori.map((m: any) => [new Date(m.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }), 'Voce a mano', m.descrizione, eur(m.importo)]))
        }
        riepilogo = `${(d.movimenti || []).length} movimenti · imponibile € ${eur(d.imponibile)} · IVA € ${eur(d.iva)}` + (d.esente ? ` · esente IVA € ${eur(d.esente)}` : '') + ` · totale € ${eur(d.totale)}`
          + (fuori.length ? ` · ${fuori.length} voci a mano fuori dal totale` : '')
      } else {
        // Sotto-master (e spedizioni senza cliente) dalla lettura di sempre; i clienti dalla regola della proforma.
        const pS = new URLSearchParams(base); pS.set('rettifiche', 'escluse')
        const pR = new URLSearchParams(base); pR.set('vista', 'rettifiche')
        if (unSotto) { pS.set('clienteId', filtri.clienteId); pR.set('clienteId', filtri.clienteId) }
        const [sped, rett, perCliente] = await Promise.all([
          leggi('/api/reports/spedizioni?' + pS.toString(), 'Spedizioni'),
          leggi('/api/reports/spedizioni?' + pR.toString(), 'Rettifiche'),
          unSotto ? Promise.resolve({ clienti: [] }) : leggi('/api/reports/fatture?' + base.toString(), 'Importi dei clienti'),
        ])
        if (!Array.isArray(sped) || !Array.isArray(rett)) throw new Error('Risposta del report spedizioni non valida')
        const diCliente = (id: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(id || ''))
        // `esente`: tutto quello venduto esente IVA (21/11/2026), di qualunque voce: fuori dall'imponibile, dentro il totale.
        type Riga = { nome: string; n: number; sped: number; rett: number; giac: number; resi: number; servizi: number; aMano: number; rimborsi: number; esente: number; aliquota: number }
        const vuota = (nome: string, aliquota: number): Riga => ({ nome, n: 0, sped: 0, rett: 0, giac: 0, resi: 0, servizi: 0, aMano: 0, rimborsi: 0, esente: 0, aliquota })
        const per = new Map<string, Riga>()
        const riga = (id: string, nome: string, aliquota: any) => { let v = per.get(id); if (!v) { v = vuota(nome || '—', aliq(aliquota)); per.set(id, v) } return v }
        // Le righe vendute IVA inclusa entrano al NETTO (scorporo, lib/iva-calcolo): l'IVA che contengono
        // torna nel totale IVA calcolato sull'imponibile, come per i clienti (lib/fatture/voci.ts). Quelle
        // esenti vanno nella colonna «Esente IVA».
        const { dividiPrezzo, regimeDi } = await import('@/lib/iva-calcolo')
        const parte = (importo: any, aliquota: any, x: any) => dividiPrezzo(Number(importo) || 0, aliq(aliquota), regimeDi(x.iva_regime ?? x.iva_inclusa))
        for (const s of sped) {
          if (diCliente(s.diretto_id)) continue
          const v = riga(s.diretto_id, s.diretto_nome, s.aliquota_iva); v.n++
          const d = parte(s.costo_totale, s.aliquota_iva, s); v.sped += d.imponibile; v.esente += d.esente
        }
        for (const r of rett) {
          if (diCliente(r.diretto_id)) continue
          const v = riga(r.diretto_id, r.diretto_nome, r.aliquota_iva)
          const d = parte(r.importo, r.aliquota_iva, r); v.rett += d.imponibile; v.esente += d.esente
        }
        for (const x of perCliente.clienti || []) {
          const v = riga(x.id, x.nome, x.aliquota)
          for (const r of x.righe) {
            if (r.esente) { v.esente += r.importo; if (r.voce === 'spedizione') v.n += r.quantita }
            else if (r.voce === 'spedizione') { v.sped += r.importo; v.n += r.quantita }
            else if (r.voce === 'rettifica') v.rett += r.importo
            else if (r.voce === 'giacenza') v.giac += r.importo
            else if (r.voce === 'reso') v.resi += r.importo
            else if (r.voce === 'rimborso') v.rimborsi += r.importo
            else v.servizi += r.importo
          }
          v.aMano += x.aMano?.importo || 0
        }
        // Le voci a mano NON sono nell'imponibile: colonna a parte, per vederle.
        const imp = (v: Riga) => c2(v.sped + v.rett + v.giac + v.resi + v.servizi + v.rimborsi)
        const ivaDi = (v: Riga) => c2(imp(v) * v.aliquota / 100)
        const es = (v: Riga) => c2(v.esente)
        const voci = [...per.values()].sort((a, b) => (imp(b) + es(b)) - (imp(a) + es(a)))
        const tot = (f: (v: Riga) => number) => voci.reduce((t, v) => t + f(v), 0)
        const vuotoSeZero = (n: number) => c2(n) ? eur(n) : ''
        // La colonna «Esente IVA» c'e' solo se qualcosa e' esente: senza, il report e' quello di ieri.
        const conEsente = voci.some(v => es(v) !== 0)
        const colEs = (x: string) => (conEsente ? [x] : [])
        testata = ['Cliente', 'N. spedizioni', 'Spedizioni €', 'Rettifiche €', 'Giacenze €', 'Resi €', 'Servizi €', 'Rimborsi €', 'Voci a mano € (fuori)', 'Imponibile €', 'IVA %', 'IVA €', ...colEs('Esente IVA €'), 'Totale €']
        corpo = voci.map(v => [v.nome, v.n, eur(v.sped), vuotoSeZero(v.rett), vuotoSeZero(v.giac), vuotoSeZero(v.resi), vuotoSeZero(v.servizi), vuotoSeZero(v.rimborsi), vuotoSeZero(v.aMano), eur(imp(v)), v.aliquota, eur(ivaDi(v)), ...colEs(vuotoSeZero(es(v))), eur(imp(v) + ivaDi(v) + es(v))])
        const imponibile = tot(imp), iva = tot(ivaDi), esente = tot(es)
        if (corpo.length) corpo.push(['TOTALE', tot(v => v.n), eur(tot(v => v.sped)), eur(tot(v => v.rett)), eur(tot(v => v.giac)), eur(tot(v => v.resi)), eur(tot(v => v.servizi)), eur(tot(v => v.rimborsi)), eur(tot(v => v.aMano)), eur(imponibile), '', eur(iva), ...colEs(eur(esente)), eur(imponibile + iva + esente)])
        riepilogo = `${tot(v => v.n)} spedizioni · imponibile € ${eur(imponibile)} · IVA € ${eur(iva)}` + (conEsente ? ` · esente IVA € ${eur(esente)}` : '') + ` · totale € ${eur(imponibile + iva + esente)}`
      }
      if (!corpo.length) corpo = [['Niente da fatturare nel periodo', ...Array(testata.length - 1).fill('')]]

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
        // Con tutte le voci il riepilogo per cliente ha 13 colonne: in orizzontale.
        const doc = new jsPDF({ compress: true, orientation: unCliente ? 'portrait' : 'landscape' })
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
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'14px'}}>Nuovo report</div>
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
