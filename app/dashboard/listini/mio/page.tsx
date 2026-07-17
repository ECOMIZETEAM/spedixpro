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
                    <span style={{ flex: 1, fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{c.nome_contratto}</span>
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

function SupplTable({ tipo, righe }: { tipo: string; righe: any[] }) {
  if (!righe.length) return <div style={{ fontSize: '12.5px', color: '#9ca3af', padding: '4px 0' }}>Nessuna voce impostata per questo corriere.</div>
  const scaglioni = tipo === 'assicurazione' || tipo === 'contrassegno'
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', minWidth: '360px' }}>
      <thead>
        <tr>
          <th style={thL}>{scaglioni ? 'Valore massimo €' : 'Voce'}</th>
          <th style={th}>Prezzo fisso €</th>
          <th style={th}>+% del valore</th>
        </tr>
      </thead>
      <tbody>
        {righe.map((r: any, j: number) => (
          <tr key={j} style={{ background: j % 2 ? '#fcfcfc' : '#fff' }}>
            <td style={tdL}>{scaglioni ? (r.valore_max != null ? `fino a € ${Number(r.valore_max).toLocaleString('it-IT')}` : '—') : (r.nome || '—')}</td>
            <td style={td}>{eur(Number(r.prezzo || 0))}</td>
            <td style={td}>{pct(Number(r.perc || 0))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const th = { fontSize: '11px', fontWeight: 700 as const, color: '#8a8a8a', textTransform: 'uppercase' as const, textAlign: 'center' as const, padding: '8px 10px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' as const }
const thL = { ...th, textAlign: 'left' as const }
const td = { fontSize: '12.5px', color: '#1a1a1a', padding: '8px 10px', borderBottom: '1px solid #f6f6f6', textAlign: 'center' as const, whiteSpace: 'nowrap' as const }
const tdL = { ...td, textAlign: 'left' as const, fontWeight: 600 as const, color: '#444' }
