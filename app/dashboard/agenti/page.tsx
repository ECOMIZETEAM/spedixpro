'use client'
import { useEffect, useState } from 'react'

// REPORT AGENTI (portale master): quanto ha guadagnato ogni agente nel mese col suo metodo di
// compenso → quanto il master deve dargli.
export default function ReportAgentiPage() {
  const oggi = new Date()
  const primo = new Date(oggi.getFullYear(), oggi.getMonth(), 1)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const [dal, setDal] = useState(iso(primo))
  const [al, setAl] = useState(iso(oggi))
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  async function carica() {
    setLoading(true)
    const r = await fetch(`/api/agenti/report?dal=${dal}&al=${al}`).then(x => x.json()).catch(() => null)
    setD(r && !r.error ? r : { agenti: [], totale: 0, error: r?.error })
    setLoading(false)
  }
  useEffect(() => { carica() }, [])

  const eur = (n: number) => '€ ' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#8a8a8a', borderBottom: '1px solid #eee' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f4f4f4' }
  const chip = (t: string) => <span style={{ background: '#eef2ff', color: '#4338ca', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 8px' }}>{t}</span>

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a', margin: 0 }}>Report Agenti</h1>
      <p style={{ fontSize: 13, color: '#8a8a8a', marginTop: 4 }}>Quanto ha guadagnato ogni tuo agente nel periodo, col suo metodo di compenso — cioè quanto devi dargli.</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', margin: '12px 0 18px' }}>
        <label style={{ fontSize: 12, color: '#666' }}>Dal<br /><input type="date" value={dal} onChange={e => setDal(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} /></label>
        <label style={{ fontSize: 12, color: '#666' }}>Al<br /><input type="date" value={al} onChange={e => setAl(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} /></label>
        <button onClick={carica} style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Aggiorna</button>
      </div>

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Caricamento…</div> : d?.error ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>{d.error}</div>
      ) : !d?.agenti?.length ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Nessun agente. Assegna un agente a un cliente e scegli come pagarlo dalla scheda dell'agente.</div>
      ) : (
        <>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: '#166534' }}>Totale da dare agli agenti</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#16a34a' }}>{eur(d.totale)}</span>
          </div>

          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Agente</th><th style={th}>Metodo</th><th style={th}>Spedizioni</th><th style={th}>Base</th><th style={{ ...th, textAlign: 'right' }}>Da dargli</th>
              </tr></thead>
              <tbody>
                {d.agenti.map((a: any) => (
                  <tr key={a.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{a.nome}</td>
                    <td style={td}>
                      {chip(a.metodoLabel)}
                      {(a.metodo === 'perc_netto' || a.metodo === 'perc_lordo') && <span style={{ color: '#666', marginLeft: 6 }}>{a.valore}%</span>}
                      {a.metodo === 'fisso' && <span style={{ color: '#666', marginLeft: 6 }}>{eur(a.valore)}/sped.</span>}
                      {a.senzaListino && <span style={{ color: '#dc2626', marginLeft: 6, fontSize: 12 }}>⚠️ listino non assegnato</span>}
                    </td>
                    <td style={td}>{a.numSpedizioni}</td>
                    <td style={td}>
                      {a.metodo === 'fisso' ? `${a.base} sped.`
                        : a.metodo === 'perc_lordo' ? `${eur(a.base)} lordo`
                          : a.metodo === 'perc_netto' ? `${eur(a.base)} netto`
                            : `${eur(a.lordo)} − ${eur(a.base)} costo`}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#16a34a', fontSize: 15 }}>{eur(a.guadagno)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 10 }}>Calcolato sui movimenti reali dei clienti dell'agente (rettifiche e resi compresi). Il "netto" è il margine tuo (prezzo cliente − tuo costo).</p>
        </>
      )}
    </div>
  )
}
