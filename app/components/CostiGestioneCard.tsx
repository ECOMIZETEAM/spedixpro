'use client'
import { useEffect, useState } from 'react'

// Card della dashboard accanto a Rettifiche, Resi, Giacenze...: i COSTI DI GESTIONE del periodo per
// categoria (lib/costi-gestione). Stesso calendario delle altre card, cosi' si confronta col Guadagno
// Totale sullo stesso periodo. La rotta risponde solo al titolare e ai suoi admin: per gli altri la
// card non compare.
const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)

// Nella Dashboard nuova: una voce della fila del guadagno, col periodo scelto dalla sezione.
export default function CostiGestioneCard({ dal, al }: { dal: string, al: string }) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [negato, setNegato] = useState(false)

  useEffect(() => {
    let vivo = true
    setLoading(true)
    fetch(`/api/costi-gestione?dal=${dal}&al=${al}`)
      .then(r => { if (r.status === 403 || r.status === 401) { if (vivo) setNegato(true); return null } return r.json() })
      .then(x => { if (vivo) { if (x && !x.error) setD(x); setLoading(false) } })
      .catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [dal, al])

  if (negato) return null
  const categorie: any[] = d?.perCategoria || []
  const prima = categorie[0]

  return (
    <a className="fx-cella fx-voce" href="/dashboard/costi-gestione" title={categorie.map(c => `${c.categoria}: ${eur(c.importo)}`).join('\n') || undefined}>
      <div className="fx-cella-nome">Costi di gestione</div>
      <div className={`fx-cella-cifra${loading ? '' : ' fx-grande--male'}`}>{loading ? '…' : eur(d?.totale || 0)}</div>
      <div className="fx-voce-sotto">
        {loading ? <span>…</span> : categorie.length
          ? <span>{prima.categoria} <b>{eur(prima.importo)}</b>{categorie.length > 1 ? ` e altre ${categorie.length - 1}` : ''}</span>
          : <span className="fx-link">Aggiungi i costi →</span>}
      </div>
    </a>
  )
}
