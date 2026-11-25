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

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)

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

  // Nella Dashboard nuova (app/components/dashboard-finexy), col disegno delle altre schede del guadagno.
  return (
    <section className="fx-scheda fx-report">
      <div className="fx-testa"><h2>Costi di gestione</h2></div>
      <div className="fx-periodo"><DateRangePicker dal={range.dal} al={range.al} onChange={(dal, al) => setRange({ dal, al })} /></div>

      <div className="fx-report-cifra fx-grande--male">{loading ? '…' : eur(d?.totale || 0)}</div>

      {!loading && (
        categorie.length ? (
          <div className="fx-righe" style={{ maxHeight: 170, overflowY: 'auto' }}>
            {categorie.map(c => (
              <div key={c.categoria} className="fx-riga" style={{ padding: '6px 2px' }}>
                <span>{c.categoria}</span><b>{eur(c.importo)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="fx-sotto" style={{ marginTop: 9 }}>Nessun costo nel periodo.</p>
        )
      )}

      <a className="fx-link" href="/dashboard/costi-gestione" style={{ display: 'inline-block', marginTop: 10 }}>
        {categorie.length ? 'Gestisci i costi →' : 'Aggiungi i costi di gestione →'}
      </a>
    </section>
  )
}
