'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useDialog } from '@/app/components/DialogProvider'

export default function DettaglioDistinta() {
  const params = useParams()
  const router = useRouter()
  const dialog = useDialog()
  const id = params?.id as string
  const [dist, setDist] = useState<any>(null)
  const [righe, setRighe] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  const carica = useCallback(async () => {
    const r = await fetch('/api/distinte/' + id)
    const d = await r.json()
    setDist(d?.distinta || null)
    setRighe(Array.isArray(d?.spedizioni) ? d.spedizioni : [])
    setLoading(false)
  }, [id])
  useEffect(() => { carica() }, [carica])

  // Distinta MISTA = più contratti (corriere_id null): mostro la colonna "Contratto" per riga.
  const mista = dist && !dist.corriere_id

  async function stampaEtichetta(spedId: string) {
    try {
      const res = await fetch('/api/spedizioni/etichetta?id=' + spedId)
      if (!res.ok) { await dialog.alert({ title: 'Etichetta non disponibile', message: 'Non è stato possibile recuperare l’etichetta di questa spedizione.' }); return }
      const url = URL.createObjectURL(await res.blob())
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch { await dialog.alert({ title: 'Errore', message: 'Stampa etichetta non riuscita.' }) }
  }

  async function togli(sped: any) {
    const ok = await dialog.confirm({
      title: 'Togli dalla distinta',
      message: `Rimuovere la spedizione ${sped.numero || ''} da questa distinta? Tornerà tra quelle "senza distinta" e potrai inserirla in un’altra. La spedizione NON viene annullata al corriere.`,
    })
    if (!ok) return
    setBusy(sped.id)
    try {
      const res = await fetch('/api/distinte/rimuovi-spedizione', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spedizioneId: sped.id }),
      })
      const d = await res.json()
      if (!d.success) { await dialog.alert({ title: 'Errore', message: d.error || 'Rimozione non riuscita.' }); return }
      await carica()
    } finally { setBusy('') }
  }

  async function stampaDistinta() {
    const res = await fetch('/api/distinte/dettaglio?id=' + id)
    const rows = await res.json()
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF()
    const dataDist = dist?.data ? new Date(dist.data).toLocaleDateString('it-IT') : ''
    const titolo = (dist?.contratto_label || 'CORRIERE').toUpperCase()
    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text('Bordero ' + titolo + ' numero ' + (dist?.numero || '') + ' Del ' + dataDist, 105, 18, { align: 'center' })
    autoTable(doc, {
      startY: 28,
      head: [['Spedizioni', 'Destinatario', 'Indirizzo Cap localita', 'Rif. Numerico', 'Imp. Assic.', 'Imp. C/Assegno', 'Colli', 'Peso']],
      body: (Array.isArray(rows) ? rows : []).map((r: any) => [
        r.numero || '', r.dest_nome || '',
        ((r.dest_indirizzo || '') + '\n' + (r.dest_cap || '') + ' ' + (r.dest_citta || '') + ' (' + (r.dest_provincia || '') + ')'),
        r.rif_destinatario || '',
        (Number(r.assicurazione || 0)).toFixed(2) + ' EUR', (Number(r.contrassegno || 0)).toFixed(2) + ' EUR',
        r.colli || 1, (Number(r.peso_reale || 0)).toFixed(0) + ' kg',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold' },
    })
    doc.save('Bordero_' + (dist?.numero || 'distinta') + '.pdf')
  }

  const th = { padding: '10px 12px', textAlign: 'left' as const, fontSize: '12px', fontWeight: '700', color: '#1a1a1a', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' as const }
  const td = { padding: '10px 12px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' }
  const bAz = { padding: '5px 9px', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '13px', cursor: 'pointer', marginRight: '5px' } as const

  if (loading) return <div style={{ padding: '20px', color: '#1a1a1a' }}>Caricamento...</div>
  if (!dist) return <div style={{ padding: '20px', color: '#1a1a1a' }}>Distinta non trovata</div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button onClick={() => router.back()} style={{ padding: '7px 14px', background: '#f1f5f9', color: '#1a1a1a', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>← Indietro</button>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Distinta N. {dist.numero}</h1>
        <div style={{ width: '90px' }}></div>
      </div>

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #d1d5db', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '13px', color: '#374151', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span><b style={{ color: '#1a1a1a' }}>Contratto:</b> {dist.contratto_label || '—'}</span>
            <span><b style={{ color: '#1a1a1a' }}>Cliente:</b> {dist.clienti?.ragione_sociale || dist.cliente_label || '—'}</span>
            <span>{dist.confermata_vettore
              ? <span style={{ background: '#16a34a', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>Confermata al vettore</span>
              : <span style={{ background: '#f59e0b', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>In attesa</span>}</span>
          </div>
          <button onClick={stampaDistinta} style={{ padding: '7px 14px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Stampa Distinta</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fff' }}>
                {['N. Spedizione', 'Mittente', 'Destinatario', 'Citta', 'CAP', 'Prov', 'Peso', 'Colli', 'Stato', ...(mista ? ['Contratto'] : []), 'Azioni'].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {!righe.length ? (
                <tr><td colSpan={mista ? 11 : 10} style={{ ...td, textAlign: 'center', padding: '20px' }}>Nessuna spedizione in distinta</td></tr>
              ) : righe.map((v: any) => (
                <tr key={v.id}>
                  <td style={{ ...td, color: '#ea580c', fontWeight: '600' }}>{v.numero || '-'}</td>
                  <td style={td}>{v.mitt_nome || '-'}</td>
                  <td style={{ ...td, color: '#ea580c' }}>{v.dest_nome || '-'}</td>
                  <td style={td}>{v.dest_citta || '-'}</td>
                  <td style={td}>{v.dest_cap || '-'}</td>
                  <td style={td}>{v.dest_provincia || '-'}</td>
                  <td style={td}>{Number(v.peso_reale || 0).toFixed(2)}</td>
                  <td style={td}>{v.colli || 1}</td>
                  <td style={td}><span style={{ background: '#eef2f7', color: '#475569', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', textTransform: 'capitalize' }}>{String(v.stato || '').replace(/_/g, ' ') || '-'}</span></td>
                  {mista && <td style={td}>{v.corrieri?.nome_contratto || '—'}</td>}
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button style={{ ...bAz, background: '#2563eb' }} onClick={() => stampaEtichetta(v.id)} title="Stampa etichetta">{'🖨'}</button>
                    <button style={{ ...bAz, background: '#f59e0b', opacity: busy === v.id ? 0.5 : 1 }} disabled={busy === v.id} onClick={() => togli(v)} title="Togli dalla distinta">{'↩'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
