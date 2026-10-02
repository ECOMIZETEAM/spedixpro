'use client'
import { useEffect, useState } from 'react'

const eur = (x: number) => Number(x) > 0 ? '€ ' + Number(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const pct = (x: number) => Number(x) > 0 ? Number(x).toLocaleString('it-IT', { maximumFractionDigits: 2 }) + '%' : '—'

function iconaCorriere(nome: string): string | null {
  const n = (nome || '').toUpperCase()
  const regole: [string, string][] = [
    ['DELIVERY BUSINESS', 'poste_delivery_business'], ['POSTE', 'poste_delivery_business'],
    ['SDA', 'sda'], ['GLS', 'gls'], ['BRT', 'brt'], ['TNT', 'tnt'],
    ['DHL ECONNECT', 'dhl_econnect'], ['ECONNECT', 'dhl_econnect'], ['DHL', 'dhl'],
    ['FEDEX', 'fedex'], ['UPS', 'ups'], ['HERMES', 'hermes'], ['NEXIVE', 'nexive'],
    ['LICCARDI', 'liccardi'], ['SAILPOST', 'sailpost'], ['BDM', 'bdm'], ['NSSA', 'nssa'],
    ['HR PARCEL', 'hrp'], ['HRP', 'hrp'], ['PALLETWAYS', 'palletways'],
    ['CORREOS EXPRESS', 'correos_express'], ['CORREOS', 'correos'],
    ['INPOST', 'inpost'], ['SPRING', 'spring'], ['PAACK', 'paack'], ['SPEEDY', 'speedy'],
    ['AMAZON', 'amazon_shipping'], ['CTT', 'ctt_express'], ['AIPACK', 'aipack'], ['GTECH', 'gtechgroup'],
  ]
  for (const [k, file] of regole) { if (n.includes(k)) return '/corrieri/' + file + '.png' }
  return null
}
function iniziali(nome: string): string {
  const p = (nome || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}

const TABS: [string, string][] = [
  ['pesi', 'Pesi / Zone'],
  ['assicurazione', 'Assicurazione'],
  ['contrassegno', 'Contrassegni'],
  ['accessorio', 'Servizi accessori'],
  // La sponda la addebita il motore e qui non c'era: stessa mancanza della vista cliente.
  ['sponda', 'Sponda idraulica'],
  ['giacenza', 'Giacenze'],
  ['ritiro', 'Ritiro'],
]

export default function MioListinoPage() {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState('')
  const [tab, setTab] = useState('pesi')
  useEffect(() => {
    fetch('/api/agente/mio-listino').then(r => r.json()).then(x => { setD(x); setLoading(false) }).catch(() => setLoading(false))
  }, [])
  function toggle(id: string) { setExpandedId(cur => cur === id ? '' : id); setTab('pesi') }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Caricamento…</div>
  const corrieri: any[] = d?.corrieri || []

  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>Il mio listino</h1>
      <p style={{ fontSize: '13px', color: '#8a8a8a', margin: '0 0 18px' }}>
        Il listino (il tuo costo) assegnato dal tuo referente. Clicca su un contratto per aprirlo. Sola lettura.
      </p>

      {(!d || d.assegnato === false || !corrieri.length) ? (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '24px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>
          Nessun listino assegnato. Chiedi al tuo referente di assegnartene uno.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '13px', color: '#1a1a1a', fontWeight: 700, marginBottom: '14px' }}>
            {d.nome}{d.solo_peso_reale ? ' · solo peso reale' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {corrieri.map((c: any, i: number) => {
              const id = String(i)
              const aperto = expandedId === id
              const logo = iconaCorriere(c.nome_contratto)
              return (
                <div key={id} style={{ background: '#fff', borderRadius: '10px', border: aperto ? '1px solid #f97316' : '1px solid #e5e7eb', overflow: 'hidden', boxShadow: aperto ? '0 1px 3px rgba(249,115,22,0.12)' : 'none' }}>
                  <div onClick={() => toggle(id)} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', cursor: 'pointer', userSelect: 'none', background: aperto ? '#fff7ed' : '#fff' }}>
                    {logo ? (
                      <span style={{ width: '56px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <img src={logo} alt={c.nome_contratto} style={{ maxWidth: '56px', maxHeight: '40px', objectFit: 'contain' }} />
                      </span>
                    ) : (
                      <span style={{ width: '40px', height: '40px', borderRadius: '8px', background: aperto ? '#f97316' : '#f3f4f6', color: aperto ? '#fff' : '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>{iniziali(c.nome_contratto)}</span>
                    )}
                    <span style={{ flex: 1, fontSize: '14px', fontWeight: 600, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>{c.nome_contratto}
                      {c.pausa && <span title={c.pausaMotivo === 'catena' ? 'Un master superiore lo ha messo in pausa: il cliente non lo vede.' : 'Il master lo ha messo in pausa: il cliente non lo vede.'} style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '20px', fontSize: '10.5px', fontWeight: 700, padding: '2px 8px' }}>⏸ {c.pausaMotivo === 'catena' ? 'In pausa da un livello superiore' : 'In pausa'}</span>}</span>
                    <span style={{ fontSize: '18px', color: '#9ca3af', transform: aperto ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
                  </div>

                  {aperto && (
                    <div style={{ borderTop: '1px solid #eee' }}>
                      <div style={{ padding: '10px 16px 0' }}>
                        <span style={{ fontSize: '11.5px', color: '#8a8a8a' }}>Fattore Peso/Volume: <b style={{ color: '#1a1a1a' }}>1/{c.fattore}</b></span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: '1px solid #eee', padding: '10px 16px 0' }}>
                        {TABS.map(([k, label]) => (
                          <button key={k} onClick={() => setTab(k)} style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: '8px 12px', fontSize: '13px',
                            fontWeight: tab === k ? 700 : 500, color: tab === k ? '#ea580c' : '#6b7280',
                            borderBottom: tab === k ? '2px solid #ea580c' : '2px solid transparent', marginBottom: '-1px',
                          }}>{label}</button>
                        ))}
                      </div>
                      <div style={{ padding: tab === 'pesi' ? 0 : '14px 16px', overflowX: 'auto' }}>
                        {tab === 'pesi' ? (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: `${160 + (c.zone?.length || 1) * 90}px` }}>
                            <thead>
                              <tr>
                                <th style={thL}>Peso (kg)</th>
                                {(c.zone || []).map((z: string, k: number) => <th key={k} style={th}>{z}</th>)}
                                <th style={th}>Fuel</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(c.fasce || []).map((f: any, j: number) => (
                                <tr key={j} style={{ background: j % 2 ? '#fcfcfc' : '#fff' }}>
                                  <td style={tdL}>{f.tipo === 'oltre' ? `oltre, ogni ${f.peso_max}` : `fino a ${f.peso_max}`}</td>
                                  {(c.zone || []).map((z: string, k: number) => <td key={k} style={td}>{eur(Number(f.prezzi?.[z] || 0))}</td>)}
                                  <td style={td}>{f.fuel ? `${f.fuel}%` : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <SupplTable tipo={tab} righe={(c.supplementi || {})[tab] || []} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ATTENZIONE: questa tabella esiste IDENTICA in app/cliente/listino/page.tsx (le due viste sono
// nate copiate, prima di questa modifica). Se tocchi una regola qui, toccala anche la'. Il posto
// giusto sarebbe un componente solo: non l'ho estratto per non allargare un intervento che riguarda
// i soldi, ma e' debito, e la prima volta che le due si contraddiranno sara' per questo.
function SupplTable({ tipo, righe }: { tipo: string; righe: any[] }) {
  if (!righe.length) return <div style={{ fontSize: '12.5px', color: '#9ca3af', padding: '4px 0' }}>Nessuna voce impostata per questo corriere.</div>

  // Sponda: la soglia e' solo il grilletto, poi il prezzo/kg vale su TUTTO il peso fatturato.
  if (tipo === 'sponda') {
    const r: any = righe[0] || {}
    const soglia = Number(r.soglia_kg || 0)
    const prezzoKg = Number(r.prezzo || 0)
    if (!(soglia > 0 && prezzoKg > 0)) {
      return <div style={{ fontSize: '12.5px', color: '#9ca3af', padding: '4px 0' }}>Nessuna sponda idraulica su questo corriere.</div>
    }
    const esempio = Math.round(soglia * 1.1)
    const eurKg = (x: number) => '€ ' + Number(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    return (
      <div style={{ fontSize: '12.5px', color: '#1a1a1a' }}>
        <div style={{ marginBottom: '8px' }}>
          Dai <b>{soglia.toLocaleString('it-IT')} kg</b> in su: <b>{eurKg(prezzoKg)}/kg</b> su tutto il peso fatturato.
        </div>
        <div style={{ fontSize: '12px', color: '#666' }}>
          La soglia è solo il punto da cui scatta: superata, il prezzo al chilo vale per l’intero peso,
          non per i soli chili oltre la soglia. Esempio: {esempio.toLocaleString('it-IT')} kg
          → {esempio.toLocaleString('it-IT')} × {eurKg(prezzoKg)} = <b>{eur(esempio * prezzoKg)}</b>.
        </div>
      </div>
    )
  }

  const scaglioni = tipo === 'assicurazione' || tipo === 'contrassegno'
  const conBanda = righe.some((r: any) => r.peso_min != null || r.peso_max != null)
  const suDifferenza = righe.some((r: any) => r.calcolo_su === 'differenza' && Number(r.perc || 0) > 0)
  return (
    <>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '360px' }}>
      <thead>
        <tr>
          <th style={thL}>{scaglioni ? 'Valore massimo €' : 'Voce'}</th>
          {conBanda && <th style={th}>Peso</th>}
          <th style={th}>Prezzo fisso €</th>
          <th style={th}>{suDifferenza ? '+% sull’eccedenza' : '+% del valore'}</th>
        </tr>
      </thead>
      <tbody>
        {righe.map((r: any, j: number) => (
          <tr key={j} style={{ background: j % 2 ? '#fcfcfc' : '#fff' }}>
            <td style={tdL}>{scaglioni ? (r.valore_max != null ? `fino a € ${Number(r.valore_max).toLocaleString('it-IT')}` : '—') : (r.nome || '—')}</td>
            {conBanda && (
              <td style={td}>
                {r.peso_min == null && r.peso_max == null ? 'qualsiasi'
                  : r.peso_max == null ? `oltre ${r.peso_min} kg`
                  : r.peso_min == null ? `fino a ${r.peso_max} kg`
                  : `${r.peso_min}–${r.peso_max} kg`}
              </td>
            )}
            <td style={td}>{eur(Number(r.prezzo || 0))}</td>
            <td style={td}>
              {pct(Number(r.perc || 0))}
              {Number(r.perc || 0) > 0 && r.calcolo_su === 'differenza' && (
                <span style={{ fontSize: '10.5px', color: '#8a8a8a' }}> sull’eccedenza</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {suDifferenza && (
      <div style={{ fontSize: '11.5px', color: '#666', marginTop: '8px' }}>
        Dove indicato, la percentuale si calcola sulla parte che <b>supera</b> il primo scaglione, non
        sull’intero importo.
      </div>
    )}
    </>
  )
}

const th = { fontSize: '11px', fontWeight: 700 as const, color: '#8a8a8a', textTransform: 'uppercase' as const, textAlign: 'center' as const, padding: '8px 10px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' as const }
const thL = { ...th, textAlign: 'left' as const }
const td = { fontSize: '12.5px', color: '#1a1a1a', padding: '8px 10px', borderBottom: '1px solid #f6f6f6', textAlign: 'center' as const, whiteSpace: 'nowrap' as const }
const tdL = { ...td, textAlign: 'left' as const, fontWeight: 600 as const, color: '#444' }
