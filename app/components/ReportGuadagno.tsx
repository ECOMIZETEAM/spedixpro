'use client'
import { useEffect, useState } from 'react'
import { prendiAnticipata } from '@/lib/richieste-anticipate'

// Stesso calendario del Guadagno Spedizioni: prima c'era solo Giorno/Settimana/Mese/Anno "fino a
// oggi", e un mese chiuso (agosto) non si poteva guardare — quindi Guadagno e Rettifiche non si
// potevano confrontare sullo stesso periodo.
export function meseCorrente(): { dal: string; al: string } {
  const oggi = new Date()
  const str = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { dal: str(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), al: str(oggi) }
}

// I report del guadagno della dashboard: una sola lista per le schede e per le chiamate anticipate dalla pagina, cosi'
// i due indirizzi non possono divergere (prima stava in app/dashboard/page.tsx).
export const REPORT_TOTALE = '/api/reports/guadagno-totale'
export const REPORT_VOCI = [
  { titolo: 'Rettifiche', endpoint: '/api/reports/guadagno-rettifiche' },
  { titolo: 'Resi', endpoint: '/api/reports/guadagno-resi' },
  { titolo: 'Giacenze', endpoint: '/api/reports/guadagno-giacenze' },
  { titolo: 'Logistica', endpoint: '/api/reports/guadagno-logistica' },
  { titolo: 'Consumabili', endpoint: '/api/reports/guadagno-consumabili' },
]

const urlReport = (endpoint: string, dal: string, al: string) => `${endpoint}?dal=${dal}&al=${al}`
// L'indirizzo della PRIMA richiesta (mese corrente), calcolato come la fa il riquadro: la home la
// anticipa prima di montarlo, e la risposta si riusa solo se l'indirizzo e' identico.
export const urlInizialeReport = (endpoint: string) => { const r = meseCorrente(); return urlReport(endpoint, r.dal, r.al) }

// Nella Dashboard nuova (app/components/dashboard-finexy) dello staff del master, l'unica che usa queste schede. Il
// periodo lo sceglie la sezione «Il tuo guadagno», uno per tutte (Lorenzo 25/11: «il controllo delle date a blocco
// singolo va raggruppato»). 'nera' e' il Guadagno Totale, la cifra che riassume le altre; 'cella' e' una voce nella
// fila sotto.
export default function ReportGuadagno({ titolo = 'Spedizioni', endpoint = '/api/reports/guadagno', dal, al, variante = 'cella' }: {
  titolo?: string, endpoint?: string, dal: string, al: string, variante?: 'nera' | 'cella',
}) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dal || !al) return
    let vivo = true
    setLoading(true)
    const url = urlReport(endpoint, dal, al)
    const risposta = prendiAnticipata(url) ?? fetch(url)
    risposta
      .then(r => r.json()).then(x => { if (vivo) { setD(x); setLoading(false) } }).catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [dal, al, endpoint])

  const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)
  const g = Number(d?.guadagno || 0)
  const segno = loading ? '' : g < 0 ? ' fx-grande--male' : ' fx-grande--bene'

  if (variante === 'cella') return (
    <div className="fx-cella fx-voce">
      <div className="fx-cella-nome">{titolo}</div>
      <div className={`fx-cella-cifra${segno}${eur(g).length > 12 ? ' fx-cella-cifra--lunga' : ''}`}>{loading ? '…' : eur(g)}</div>
      <div className="fx-voce-sotto"><span>incassato <b>{loading ? '…' : eur(d?.ricavi || 0)}</b></span><span>costo <b>{loading ? '…' : eur(d?.costi || 0)}</b></span></div>
    </div>
  )

  return (
    <section className="fx-scheda fx-report fx-report--nera">
      <div className="fx-testa"><h2>Guadagno totale</h2><span className="fx-chip fx-chip--vetro">{titolo === 'Guadagno Totale' ? 'tutte le voci' : titolo}</span></div>
      <div className="fx-report-cifra">{loading ? '…' : eur(g)}</div>
      <div className="fx-report-sotto">
        <span>Incassato <b>{loading ? '…' : eur(d?.ricavi || 0)}</b></span>
        <span>Costo <b>{loading ? '…' : eur(d?.costi || 0)}</b></span>
      </div>

      {/* Solo nel Guadagno Totale e solo per il titolare: la rotta manda costiGestione soltanto a lui. */}
      {!loading && d?.costiGestione !== undefined && (
        <div className="fx-report-netto">
          <span>Costi di gestione <b style={{ color: '#FF8A80' }}>{eur(d.costiGestione)}</b></span>
          <span>Utile netto <b style={{ fontSize: 14, color: Number(d.utileNetto) < 0 ? '#FF8A80' : '#7EE2A0' }}>{eur(d.utileNetto)}</b></span>
        </div>
      )}
      <p className="fx-report-spiega">Spedizioni, rettifiche, rimborsi, resi, giacenze, commissioni, accessori, logistica e canone, senza contare
        due volte niente e senza i soldi che passano soltanto (ricariche, contrassegni). Accanto e sotto, il dettaglio per voce.</p>
    </section>
  )
}
