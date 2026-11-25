'use client'
import { useEffect, useState } from 'react'
import DateRangePicker from './DateRangePicker'

// Card della dashboard accanto a Rettifiche, Resi, Giacenze...: i COSTI DI GESTIONE del periodo per
// categoria (lib/costi-gestione). Stesso calendario delle altre card, cosi' si confronta col Guadagno
// Totale sullo stesso periodo. La rotta risponde solo al titolare e ai suoi admin: per gli altri la
// card non compare.
function meseCorrente(): { dal: string; al: string } {
  const oggi = new Date()
  const str = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { dal: str(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), al: str(oggi) }
}

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CostiGestioneCard() {
  const [range, setRange] = useState(meseCorrente)
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [negato, setNegato] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/costi-gestione?dal=${range.dal}&al=${range.al}`)
      .then(r => { if (r.status === 403 || r.status === 401) { setNegato(true); return null } return r.json() })
      .then(x => { if (x && !x.error) setD(x); setLoading(false) })
      .catch(() => setLoading(false))
  }, [range.dal, range.al])

  if (negato) return null
  const categorie: any[] = d?.perCategoria || []

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '13px 15px' }}>
      <div style={{ marginBottom: '10px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>
          <span style={{ width: '22px', height: '22px', borderRadius: '6px', background: '#fee2e2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>🧮</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Costi di gestione</span>
        </span>
        <DateRangePicker dal={range.dal} al={range.al} onChange={(dal, al) => setRange({ dal, al })} />
      </div>

      <div style={{ fontSize: '24px', fontWeight: 800, color: '#dc2626', lineHeight: 1.05 }}>{loading ? '…' : eur(d?.totale || 0)}</div>

      {!loading && (
        categorie.length ? (
          <div style={{ marginTop: '9px', maxHeight: '170px', overflowY: 'auto' }}>
            {categorie.map(c => (
              <div key={c.categoria} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11.5px', padding: '3px 0', borderBottom: '1px solid #f6f6f6' }}>
                <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.categoria}</span>
                <b style={{ color: '#1a1a1a', whiteSpace: 'nowrap' }}>{eur(c.importo)}</b>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: '9px', fontSize: '11px', color: '#8a8a8a' }}>Nessun costo nel periodo.</div>
        )
      )}

      <a href="/dashboard/costi-gestione" style={{ display: 'inline-block', marginTop: '9px', fontSize: '11px', color: '#f97316', fontWeight: 600, textDecoration: 'none' }}>
        {categorie.length ? 'Gestisci i costi →' : 'Aggiungi i costi di gestione →'}
      </a>
    </div>
  )
}
