'use client'
import { useEffect, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

const OPERAZIONI = [
  { v: 'riconsegna', l: 'Riconsegna' },
  { v: 'riconsegna_nuovo', l: 'Riconsegna a nuovo destinatario' },
  { v: 'reso', l: 'Reso al mittente' },
]
const OP_LABEL: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }
const STATO_BADGE: Record<string, { bg: string; color: string; l: string }> = {
  da_confermare: { bg: '#fef3c7', color: '#b45309', l: 'Da confermare' },
  confermata: { bg: '#dcfce7', color: '#16a34a', l: 'Confermata' },
  annullata: { bg: '#f3f4f6', color: '#6b7280', l: 'Annullata' },
}

const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' as const }
const cardHead = { padding: '14px 18px', borderBottom: '1px solid #eef2f6', fontSize: '15px', fontWeight: 700 as const, color: '#1a1a1a' }
const inp = { width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' as const, background: '#fff' }
const lbl = { fontSize: '12px', fontWeight: 600 as const, color: '#1a1a1a', display: 'block' as const, marginBottom: '5px' }
const th = { textAlign: 'left' as const, padding: '9px 12px', fontSize: '11px', fontWeight: 700 as const, color: '#64748b', textTransform: 'uppercase' as const, borderBottom: '1px solid #eef2f6' }
const td = { padding: '10px 12px', fontSize: '12.5px', color: '#1a1a1a', borderBottom: '1px solid #f5f7fa' }
const eur = (n: any) => '€ ' + (Number(n) || 0).toFixed(2)

export default function GiacenzaDettaglio({ id, tornaHref }: { id: string; tornaHref: string }) {
  const dialog = useDialog()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  // form gestisci
  const [op, setOp] = useState('riconsegna')
  const [dataOp, setDataOp] = useState('')
  const [note, setNote] = useState('')
  const [nd, setNd] = useState({ nome: '', indirizzo: '', citta: '', cap: '', provincia: '', telefono: '' })
  // costo manuale (master)
  const [notaCosto, setNotaCosto] = useState('')
  const [importoCosto, setImportoCosto] = useState('')
  // conferma svincolo (master)
  const [confChecked, setConfChecked] = useState<Record<string, boolean>>({})

  async function carica() {
    const d = await fetch('/api/giacenze/' + id).then(r => r.json())
    setData(d); setLoading(false)
  }
  useEffect(() => { carica() }, [id])

  async function azione(body: any): Promise<boolean> {
    setSalvando(true); setMsg(null)
    try {
      const r = await fetch('/api/giacenze/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      setSalvando(false)
      if (!r.ok || j.error) { setMsg({ t: 'err', x: j.error || 'Errore (' + r.status + ')' }); return false }
      await carica()
      return true
    } catch (e: any) { setSalvando(false); setMsg({ t: 'err', x: 'Errore di rete' }); return false }
  }

  if (loading) return <div style={{ padding: '40px', color: '#64748b' }}>Caricamento…</div>
  if (!data || data.error) return <div style={{ padding: '40px', color: '#dc2626' }}>{data?.error || 'Giacenza non trovata'}</div>

  const { sped, prezzi, noloBase, storico, costi, ruolo } = data
  const isMaster = ruolo === 'master'

  // anteprima costi dell'operazione selezionata
  function preview(operazione: string) {
    const serv = prezzi?.servizi?.[operazione] || { valore: 0, perc: 0 }
    const servizio = (Number(serv.valore) || 0) + ((Number(serv.perc) || 0) / 100) * (Number(noloBase) || 0)
    const apertura = operazione === 'reso' ? 0 : (Number(prezzi?.apertura) || 0)
    return { apertura, servizio, totale: apertura + servizio }
  }
  const pv = preview(op)
  const richPending = (storico || []).find((r: any) => r.stato === 'da_confermare')
  const costiExtra = (costi || []).reduce((s: number, c: any) => s + (Number(c.importo) || 0), 0)
  const costoTotaleGiac = (richPending ? Number(richPending.costo_totale) || 0 : 0) + costiExtra

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Giacenza — {sped.numero}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {isMaster && sped.giacenza_stato !== 'chiusa' && (
            <button disabled={salvando} onClick={async () => { if (await dialog.confirm({ title: 'Chiudere la giacenza?', message: 'Non sarà più gestibile.', danger: true, confirmText: 'Chiudi' })) azione({ azione: 'chiudi' }) }}
              style={{ padding: '7px 14px', background: '#6b7280', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>Chiudi giacenza</button>
          )}
          <a href={tornaHref} style={{ fontSize: '13px', color: '#2563eb', textDecoration: 'none' }}>← Torna alle giacenze</a>
        </div>
      </div>

      {msg && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: '#fff', background: msg.t === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.x}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: '20px', alignItems: 'start' }}>

        {/* COLONNA SINISTRA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={card}>
            <div style={cardHead}>Info Giacenza</div>
            <div style={{ padding: '16px 18px', fontSize: '13px', color: '#1a1a1a', lineHeight: 1.9 }}>
              <div>👤 <b>Destinatario:</b> {sped.dest_nome}</div>
              <div>📍 <b>Indirizzo:</b> {sped.dest_indirizzo}, {sped.dest_cap} {sped.dest_citta} {sped.dest_provincia ? '(' + sped.dest_provincia + ')' : ''}</div>
              {sped.dest_telefono && <div>📱 <b>Telefono:</b> {sped.dest_telefono}</div>}
              <div style={{ marginTop: '6px' }}><b>Motivo:</b> <span style={{ color: '#f97316' }}>{sped.giacenza_motivo || 'INIZIO GIACENZA'}</span></div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px' }}>
                <thead><tr>{['Data spedizione', 'Data apertura giacenza'].map(h => <th key={h} style={{ ...th, borderTop: '1px solid #eef2f6' }}>{h}</th>)}</tr></thead>
                <tbody><tr>
                  <td style={td}>{sped.created_at ? new Date(sped.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                  <td style={td}>{sped.giacenza_data ? new Date(sped.giacenza_data).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                </tr></tbody>
              </table>
            </div>
          </div>

          {/* GESTISCI: scelta operazione */}
          <div style={card}>
            <div style={cardHead}>Gestisci</div>
            <div style={{ padding: '16px 18px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={lbl}>Scegli l'operazione da effettuare</label>
                  <select value={op} onChange={e => setOp(e.target.value)} style={inp}>
                    {OPERAZIONI.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Data</label>
                  <input type="date" value={dataOp} onChange={e => setDataOp(e.target.value)} style={inp} />
                </div>
              </div>

              {op === 'riconsegna_nuovo' && (
                <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', marginBottom: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Nuovo destinatario</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <input placeholder="Nome / Ragione sociale" value={nd.nome} onChange={e => setNd({ ...nd, nome: e.target.value })} style={inp} />
                    <input placeholder="Telefono" value={nd.telefono} onChange={e => setNd({ ...nd, telefono: e.target.value })} style={inp} />
                    <input placeholder="Indirizzo" value={nd.indirizzo} onChange={e => setNd({ ...nd, indirizzo: e.target.value })} style={{ ...inp, gridColumn: '1 / 3' }} />
                    <input placeholder="Città" value={nd.citta} onChange={e => setNd({ ...nd, citta: e.target.value })} style={inp} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <input placeholder="CAP" value={nd.cap} onChange={e => setNd({ ...nd, cap: e.target.value })} style={inp} />
                      <input placeholder="Prov" value={nd.provincia} onChange={e => setNd({ ...nd, provincia: e.target.value })} style={inp} />
                    </div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Note</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} />
              </div>

              <button disabled={salvando} onClick={async () => {
                if (await azione({ azione: 'richiesta', operazione: op, data: dataOp || null, note, nuovoDestinatario: op === 'riconsegna_nuovo' ? nd : null })) {
                  setNote(''); setDataOp(''); setMsg({ t: 'ok', x: 'Operazione registrata: in attesa di conferma svincolo.' })
                }
              }} style={{ padding: '10px 22px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: salvando ? 0.7 : 1 }}>Conferma</button>
            </div>
          </div>
        </div>

        {/* COLONNA DESTRA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* COSTI APPLICATI (anteprima operazione scelta) */}
          <div style={card}>
            <div style={cardHead}>Costi applicati — {OP_LABEL[op]}</div>
            <div style={{ padding: '14px 18px', fontSize: '13px', color: '#1a1a1a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #eef2f6' }}><span>Apertura giacenza</span><b>{eur(pv.apertura)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #eef2f6' }}><span>{OP_LABEL[op]}{op === 'reso' ? ' (senza assicurazione/contrassegno)' : ''}</span><b>{eur(pv.servizio)}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0 2px', fontSize: '15px' }}><span style={{ fontWeight: 700 }}>Totale operazione</span><b style={{ color: '#16a34a' }}>{eur(pv.totale)}</b></div>
            </div>
          </div>

          {/* STORICO AZIONI */}
          <div style={card}>
            <div style={cardHead}>Storico Azioni</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Data', 'Utente', 'Azione', 'Costo', 'Stato'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {!(storico || []).length ? (
                    <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#94a3b8' }}>Nessuna azione</td></tr>
                  ) : storico.map((r: any) => {
                    const b = STATO_BADGE[r.stato] || STATO_BADGE.da_confermare
                    return (
                      <tr key={r.id}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={td}>{r.creata_da || '—'}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{OP_LABEL[r.operazione] || r.operazione}</td>
                        <td style={td}>{eur(r.costo_totale)}</td>
                        <td style={td}>
                          <span style={{ background: b.bg, color: b.color, padding: '3px 9px', borderRadius: '5px', fontSize: '11px', fontWeight: 700 }}>{b.l}</span>
                          {r.stato === 'da_confermare' && (
                            <div style={{ marginTop: '8px' }}>
                              {isMaster ? (
                                <>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#1a1a1a', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={!!confChecked[r.id]} onChange={e => setConfChecked(c => ({ ...c, [r.id]: e.target.checked }))} /> Conferma svincolo
                                  </label>
                                  <button disabled={salvando || !confChecked[r.id]} onClick={() => azione({ azione: 'conferma_svincolo', richiestaId: r.id })}
                                    style={{ marginTop: '6px', padding: '7px 14px', background: confChecked[r.id] ? '#2563eb' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: confChecked[r.id] ? 'pointer' : 'default' }}>Conferma</button>
                                </>
                              ) : (
                                <div style={{ fontSize: '11px', color: '#b45309', marginTop: '2px' }}>In attesa di conferma dal master</div>
                              )}
                              <button disabled={salvando} onClick={() => azione({ azione: 'annulla', richiestaId: r.id })} style={{ marginTop: '6px', marginLeft: isMaster ? '8px' : 0, padding: '5px 10px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>Annulla</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* COSTO TOTALE GIACENZA */}
          <div style={card}>
            <div style={{ ...cardHead, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Costo totale giacenza</span><span style={{ color: '#16a34a' }}>{eur(costoTotaleGiac)}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Data', 'Nota', 'Importo', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {!(costi || []).length ? (
                    <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#94a3b8' }}>Nessun costo extra</td></tr>
                  ) : costi.map((c: any) => (
                    <tr key={c.id}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(c.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={td}>{c.nota || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{eur(c.importo)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{isMaster && <button onClick={() => azione({ azione: 'rimuovi_costo', costoId: c.id })} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '5px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>🗑</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isMaster && (
              <div style={{ display: 'flex', gap: '8px', padding: '12px 18px', borderTop: '1px solid #eef2f6', flexWrap: 'wrap' }}>
                <input placeholder="Nota" value={notaCosto} onChange={e => setNotaCosto(e.target.value)} style={{ ...inp, flex: 1, minWidth: '140px' }} />
                <input placeholder="0.00" type="number" step="0.01" value={importoCosto} onChange={e => setImportoCosto(e.target.value)} style={{ ...inp, width: '110px', textAlign: 'right' }} />
                <button disabled={salvando} onClick={async () => { if (await azione({ azione: 'aggiungi_costo', nota: notaCosto, importo: Number(importoCosto) || 0 })) { setNotaCosto(''); setImportoCosto('') } }}
                  style={{ padding: '9px 18px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Aggiungi</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
