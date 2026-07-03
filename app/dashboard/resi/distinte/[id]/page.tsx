'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function DettaglioDistintaReso() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [dist, setDist] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/resi/distinte/' + id).then(r => r.json()).then(d => { setDist(d); setLoading(false) })
  }, [id])

  function stampa() { window.open('/api/resi/distinte/' + id + '/pdf', '_blank') }

  const th = { padding: '10px 12px', textAlign: 'left' as const, fontSize: '12px', fontWeight: '700', color: '#1a1a1a', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' as const }
  const td = { padding: '10px 12px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' }

  if (loading) return <div style={{ padding: '20px', color: '#1a1a1a' }}>Caricamento...</div>
  if (!dist) return <div style={{ padding: '20px', color: '#1a1a1a' }}>Distinta non trovata</div>

  const voci = Array.isArray(dist.voci) ? dist.voci : []

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button onClick={() => router.back()} style={{ padding: '7px 14px', background: '#f1f5f9', color: '#1a1a1a', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Indietro</button>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Distinta N. {dist.numero}</h1>
        <div style={{ width: '90px' }}></div>
      </div>
      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #d1d5db', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a' }}>Lettere di vettura</div>
          <button onClick={stampa} style={{ padding: '7px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>Stampa Distinta</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fff' }}>
                {['N. Spedizione', 'Mittente', 'Destinatario', 'Citta', 'CAP', 'Provincia', 'Peso', 'Colli', 'Data', 'Costo Reso'].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {!voci.length ? (
                <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: '20px' }}>Nessuna spedizione</td></tr>
              ) : voci.map((v: any, i: number) => (
                <tr key={i}>
                  <td style={{ ...td, color: '#ea580c', fontWeight: '600' }}>{v.numero}</td>
                  <td style={td}>{v.mitt_nome || '-'}</td>
                  <td style={{ ...td, color: '#ea580c' }}>{v.dest_nome || '-'}</td>
                  <td style={td}>{v.dest_citta || '-'}</td>
                  <td style={td}>{v.dest_cap || '-'}</td>
                  <td style={td}>{v.dest_provincia || '-'}</td>
                  <td style={td}>{Number(v.peso_reale || v.peso || 0).toFixed(2)}</td>
                  <td style={td}>{v.colli || 1}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{v.data_scansione ? new Date(v.data_scansione).toLocaleDateString('it-IT') : '-'}</td>
                  <td style={td}>{Number(v.costo_reso || v.costo_totale || 0).toFixed(2)} EUR</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}