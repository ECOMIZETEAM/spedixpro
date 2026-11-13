'use client'
import { useEffect, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import SelectCercabile from '@/app/components/SelectCercabile'
import PagamentoRicarica, { PAGAMENTO_INIZIALE, type ValorePagamento } from '@/app/components/PagamentoRicarica'

// CHECK RICARICHE — monitoraggio bonifici delle ricariche manuali (contabilita' + anti-truffa).
// Ogni ricarica manuale a un cliente/sotto-master compare qui: si segna "bonifico effettuato" e poi
// "bonifico arrivato". Gli alert rossi stanano chi non paga e i bonifici non ancora incassati.

const eur = (n: any) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const card: any = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' }
const th: any = { padding: '9px 12px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#666', textAlign: 'left', whiteSpace: 'nowrap' }
const td: any = { padding: '9px 12px', fontSize: '12.5px', color: '#1a1a1a', borderTop: '1px solid #f0f0f0', verticalAlign: 'middle' }
const btn: any = { background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }
const btnSec: any = { background: '#fff', color: '#555', border: '1px solid #d5d5d5', borderRadius: '6px', padding: '6px 10px', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }

const METODO: Record<string, string> = { cod_compensati: '🔁 Contrassegni compensati', contanti: '💵 Contanti', altro: 'Altro pagamento', giro: 'Giro dei bonifici dei suoi clienti' }

const oggiRoma = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
type Modulo = { target: string, importo: string, giorno: string, pagamento: ValorePagamento, note: string }
const moduloVuoto = (): Modulo => ({ target: '', importo: '', giorno: oggiRoma(), pagamento: PAGAMENTO_INIZIALE, note: '' })
const campo: any = { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box', color: '#1a1a1a', background: '#fff' }
const etichetta: any = { fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px', display: 'block' }

const STATI: [string, string][] = [['', 'Tutti'], ['alert', '⚠ Solo alert'], ['in_attesa', 'In attesa bonifico'], ['effettuato', 'Bonifico effettuato'], ['arrivato', 'Arrivati']]

export default function CheckRicariche() {
  const [righe, setRighe] = useState<any[]>([])
  const [riep, setRiep] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [stato, setStato] = useState('')
  const [cerca, setCerca] = useState('')
  const [facendo, setFacendo] = useState('')
  const [err, setErr] = useState('')
  const [contabilita, setContabilita] = useState(false)
  // Aggiungere a mano una ricarica vecchia (Lorenzo, 12/11): solo registro, il credito non si tocca.
  const [puoAggiungere, setPuoAggiungere] = useState(false)
  const [aperto, setAperto] = useState(false)
  const [modulo, setModulo] = useState<Modulo>(moduloVuoto)
  const [anagrafiche, setAnagrafiche] = useState<{ valore: string, nome: string, tipo: string }[] | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [errModulo, setErrModulo] = useState('')
  const [fatto, setFatto] = useState('')
  const dialog = useDialog()

  function carica() {
    setLoading(true)
    const qs = new URLSearchParams()
    if (stato) qs.set('stato', stato)
    if (cerca.trim()) qs.set('q', cerca.trim())
    fetch(`/api/statistiche/check-ricariche?${qs.toString()}`)
      .then(r => r.json())
      .then(d => { setRighe(Array.isArray(d?.righe) ? d.righe : []); setRiep(d?.riepilogo || null); setContabilita(d?.contabilita === true); setPuoAggiungere(d?.puoAggiungere === true); setLoading(false) })
      .catch(() => { setLoading(false); setErr('Errore nel caricamento') })
  }
  useEffect(() => { carica() }, [stato])

  async function azione(id: string, az: string) {
    if (facendo) return   // guardia anti doppio-click: un'azione alla volta
    // Conferma (popup MoovExpress) sulle azioni che tornano indietro o cancellano: niente per sbaglio.
    const conferme: Record<string, { title: string; message: string; confirmText: string; danger?: boolean }> = {
      annulla_effettuato: { title: 'Annullare il "bonifico effettuato"?', message: 'La ricarica torna in attesa di bonifico.', confirmText: 'Annulla bonifico' },
      annulla_arrivato: { title: 'Annullare la conferma d\'arrivo?', message: 'Il bonifico torna a "effettuato, non ancora incassato".', confirmText: 'Annulla arrivo' },
      elimina: { title: 'Eliminare questa ricarica dal monitoraggio?', message: 'Toglie la riga dal Check Ricariche (es. se hai fatto uno storno -€ sul credito e non aspetti più il bonifico). NON tocca il credito né i movimenti.', confirmText: 'Elimina', danger: true },
    }
    if (conferme[az] && !(await dialog.confirm(conferme[az]))) return
    setFacendo(id + az); setErr('')
    try {
      const res = await fetch('/api/statistiche/check-ricariche', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, azione: az }),
      })
      const d = await res.json().catch(() => ({}))
      // Controlla lo STATO HTTP, non solo d.error: un 404/403 (es. sessione o deploy) non deve
      // sembrare riuscito. Cosi' non si vede mai uno stato "segnato" che in realta' non e' salvato.
      if (!res.ok || d?.error) { setErr(d?.error || 'Operazione non riuscita — ricarica la pagina e riprova'); setFacendo(''); return }
      // La UI si allinea allo stato VERO restituito dal server (mai ottimistico), poi rinfresca il riepilogo.
      if (d?.eliminata) setRighe(prev => prev.filter(r => r.id !== id))
      else if (d?.riga) setRighe(prev => prev.map(r => (r.id === id ? d.riga : r)))
      carica()
    } catch { setErr('Errore di rete — ricarica la pagina') } finally { setFacendo('') }
  }

  function apriModulo() {
    setAperto(true); setErrModulo(''); setFatto('')
    if (anagrafiche) return
    fetch('/api/statistiche/check-ricariche?anagrafiche=1').then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d?.error) { setErrModulo(d?.error || 'Non riesco a leggere i clienti — ricarica la pagina'); return }
      setAnagrafiche(Array.isArray(d.anagrafiche) ? d.anagrafiche : [])
    }).catch(() => setErrModulo('Errore di rete — ricarica la pagina'))
  }

  async function aggiungi() {
    if (salvando) return
    setErrModulo('')
    if (!modulo.target) { setErrModulo('Scegli il cliente o il sotto-master'); return }
    const importo = Number(modulo.importo.replace(',', '.'))
    if (!(importo > 0)) { setErrModulo('Scrivi l\'importo della ricarica'); return }
    if (!modulo.giorno) { setErrModulo('Scegli la data della ricarica'); return }
    const invia = async (conferma: boolean) => {
      const res = await fetch('/api/statistiche/check-ricariche', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azione: 'aggiungi', target: modulo.target, importo, giorno: modulo.giorno, stato: modulo.pagamento.stato,
          metodo: modulo.pagamento.metodo, mittente: modulo.pagamento.mittente, note: modulo.note, conferma }),
      })
      return { res, d: await res.json().catch(() => ({})) }
    }
    setSalvando(true)
    try {
      let { res, d } = await invia(false)
      // Una ricarica uguale lo stesso giorno c'e' gia': potrebbe essere la stessa, si chiede.
      if (res.status === 409 && d?.doppione) {
        if (!(await dialog.confirm({ title: 'Ricarica già presente?', message: `${d.error} Vuoi aggiungerne un'altra uguale?`, confirmText: 'Aggiungi lo stesso' }))) return
        ;({ res, d } = await invia(true))
      }
      if (!res.ok || d?.error) { setErrModulo(d?.error || 'Non salvata — ricarica la pagina e riprova'); return }
      const chi = anagrafiche?.find(a => a.valore === modulo.target)?.nome || ''
      setFatto(d?.avviso || `Aggiunta: ${eur(importo)} a ${chi}. Il credito non è cambiato.`)
      setAperto(false); setModulo(moduloVuoto())
      carica()
    } catch { setErrModulo('Errore di rete — ricarica la pagina') } finally { setSalvando(false) }
  }

  // Chi ha fatto il bonifico, anche dopo la ricarica: resta pure fra i nomi del cliente.
  async function scriviMittente(r: any) {
    if (facendo) return
    const nome = await dialog.prompt({ title: `Chi ha fatto il bonifico per ${r.target_nome || 'questa ricarica'}?`, placeholder: 'il nome come compare in banca, es. SALVATORE PELLE', defaultValue: r.mittente || '' })
    if (nome === null) return
    setFacendo(r.id + 'mittente'); setErr('')
    try {
      const res = await fetch('/api/statistiche/check-ricariche', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, azione: 'mittente', mittente: nome }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.error) { setErr(d?.error || 'Non salvato'); return }
      if (d?.riga) setRighe(prev => prev.map(x => (x.id === r.id ? d.riga : x)))
    } catch { setErr('Errore di rete') } finally { setFacendo('') }
  }

  const dataOra = (s: any) => { try { return new Date(s).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
  const soglie = riep?.soglie || { no_bonifico: 3, no_arrivo: 4 }

  const badgeStato = (r: any) => {
    if (r.stato === 'altro_metodo') return <span style={{ background: '#f3f4f6', color: '#374151', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{METODO[r.metodo] || 'Altro pagamento'}</span>
    if (r.stato === 'arrivato') return <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>🟢 Arrivato</span>
    if (r.stato === 'effettuato') return <span style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>🔵 Bonifico fatto</span>
    return <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>🟠 In attesa</span>
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '22px 20px' }}>
      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Check Ricariche</h1>
          <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>
            Bonifici delle ricariche che avete fatto. Segnate quando il cliente dispone il bonifico e quando lo incassate.
            Alert dopo <b>{soglie.no_bonifico} giorni</b> senza bonifico e dopo <b>{soglie.no_arrivo} giorni</b> se non è confermato l’arrivo.
          </p>
        </div>
        {puoAggiungere && !aperto && (
          <button onClick={apriModulo} style={{ ...btnSec, display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', fontSize: '12.5px', color: '#1a1a1a' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" /></svg>
            Aggiungi a mano
          </button>
        )}
      </div>

      {fatto && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>{fatto}</div>}

      {aperto && (
        <div style={{ ...card, padding: '16px', marginBottom: '16px', overflow: 'visible' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>Aggiungi una ricarica a mano</div>
          <div style={{ fontSize: '12.5px', color: '#6b7280', marginTop: '4px', lineHeight: 1.45 }}>
            Per una ricarica già fatta di cui aspetti ancora il bonifico e che qui non c’è. Resta solo in questo elenco:
            <b> il credito del cliente non cambia</b> e non nasce nessun movimento.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={etichetta}>Chi hai ricaricato</label>
              <SelectCercabile value={modulo.target} disabled={!anagrafiche}
                onChange={(e: any) => setModulo(m => ({ ...m, target: e.target.value, pagamento: { ...PAGAMENTO_INIZIALE, stato: m.pagamento.stato } }))} style={campo}>
                <option value="">{anagrafiche ? 'Scegli il cliente o il sotto-master…' : 'Carico i clienti…'}</option>
                {(anagrafiche || []).map(a => <option key={a.valore} value={a.valore}>{a.tipo === 'master' ? `${a.nome} · sotto-master` : a.nome}</option>)}
              </SelectCercabile>
            </div>
            <div>
              <label style={etichetta}>Importo</label>
              <input value={modulo.importo} onChange={e => setModulo(m => ({ ...m, importo: e.target.value }))} inputMode="decimal" placeholder="es. 500,00" style={campo} />
            </div>
            <div>
              <label style={etichetta}>Ricaricato il</label>
              <input type="date" value={modulo.giorno} max={oggiRoma()} onChange={e => setModulo(m => ({ ...m, giorno: e.target.value }))} style={campo} />
            </div>
          </div>
          <PagamentoRicarica target={modulo.target} valore={modulo.pagamento} onChange={v => setModulo(m => ({ ...m, pagamento: v }))} />
          <div style={{ marginTop: '12px' }}>
            <label style={etichetta}>Nota <span style={{ fontWeight: 400, color: '#9ca3af' }}>(facoltativa)</span></label>
            <input value={modulo.note} onChange={e => setModulo(m => ({ ...m, note: e.target.value }))} maxLength={500} placeholder="es. ricarica di settembre ancora da pagare" style={campo} />
          </div>
          {errModulo && <div style={{ color: '#b91c1c', fontSize: '12.5px', marginTop: '10px' }}>{errModulo}</div>}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px', flexWrap: 'wrap' }}>
            <button onClick={() => { setAperto(false); setErrModulo('') }} disabled={salvando} style={{ ...btnSec, padding: '8px 14px' }}>Annulla</button>
            <button onClick={aggiungi} disabled={salvando} style={{ ...btn, padding: '8px 16px', opacity: salvando ? 0.6 : 1 }}>{salvando ? 'Salvo…' : 'Aggiungi al Check Ricariche'}</button>
          </div>
        </div>
      )}

      {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>{err}</div>}

      {/* Riepilogo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div style={{ ...card, padding: '14px 16px' }}>
          <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>Scoperto (da incassare)</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', marginTop: '4px' }}>{eur(riep?.scoperto)}</div>
        </div>
        <div style={{ ...card, padding: '14px 16px', borderColor: (riep?.n_alert || 0) > 0 ? '#fecaca' : '#e8e8e8', background: (riep?.n_alert || 0) > 0 ? '#fff7f7' : '#fff' }}>
          <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>⚠ Alert attivi</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: (riep?.n_alert || 0) > 0 ? '#dc2626' : '#1a1a1a', marginTop: '4px' }}>{riep?.n_alert ?? 0}</div>
        </div>
        <div style={{ ...card, padding: '14px 16px' }}>
          <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>In attesa bonifico</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', marginTop: '4px' }}>{riep?.n_in_attesa ?? 0}</div>
        </div>
        <div style={{ ...card, padding: '14px 16px' }}>
          <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>Da confermare arrivo</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', marginTop: '4px' }}>{riep?.n_effettuato ?? 0}</div>
        </div>
      </div>

      {/* Filtri */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {STATI.map(([v, l]) => (
          <button key={v} onClick={() => setStato(v)} style={{ ...btnSec, background: stato === v ? '#1a1a1a' : '#fff', color: stato === v ? '#fff' : '#555', borderColor: stato === v ? '#1a1a1a' : '#d5d5d5', padding: '7px 12px' }}>{l}</button>
        ))}
        <input value={cerca} onChange={e => setCerca(e.target.value)} onKeyDown={e => e.key === 'Enter' && carica()} placeholder="🔍 cerca cliente / sotto-master…"
          style={{ marginLeft: 'auto', padding: '7px 11px', border: '1px solid #d5d5d5', borderRadius: '6px', fontSize: '13px', minWidth: '220px' }} />
        <button onClick={carica} style={btnSec}>Cerca</button>
      </div>

      <div style={card}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>
          {loading ? 'Carico…' : `${righe.length} ricariche`}
        </div>
        {loading ? null : righe.length === 0 ? (
          <div style={{ padding: '46px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Nessuna ricarica manuale. Compaiono qui appena ricaricate un cliente o un sotto-master.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '840px' }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={th}>Ricaricato il</th>
                <th style={th}>Chi</th>
                <th style={{ ...th, textAlign: 'right' }}>Importo</th>
                <th style={th}>Stato</th>
                <th style={th}>Attesa</th>
                <th style={{ ...th, textAlign: 'right' }}>Azioni</th>
              </tr></thead>
              <tbody>
                {righe.map(r => (
                  <tr key={r.id} style={{ background: r.alert ? '#fff7f7' : undefined }}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#555' }}>{dataOra(r.ricaricato_il)}</td>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{r.target_nome || '—'}</span>
                      <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 700, color: r.target_tipo === 'master' ? '#7c3aed' : '#0891b2', background: r.target_tipo === 'master' ? '#f3e8ff' : '#ecfeff', padding: '1px 6px', borderRadius: '4px' }}>
                        {r.target_tipo === 'master' ? 'sotto-master' : 'cliente'}
                      </span>
                      {r.a_mano && <span title="Aggiunta a mano: solo registro, non c'è un movimento di credito" style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 700, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: '4px' }}>aggiunta a mano</span>}
                      {r.note && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{r.note}</div>}
                      {r.mittente && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>bonifico da {r.mittente}
                        {contabilita && <button onClick={() => scriviMittente(r)} disabled={!!facendo} title="Cambia il nome" style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: '11px', padding: '0 4px' }}>✎</button>}</div>}
                      {!r.mittente && contabilita && r.stato !== 'altro_metodo' && (
                        <button onClick={() => scriviMittente(r)} disabled={!!facendo} style={{ display: 'block', background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: '11px', fontWeight: 600, padding: '2px 0 0' }}>+ chi ha fatto il bonifico?</button>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{eur(r.importo)}</td>
                    <td style={td}>{badgeStato(r)}
                      {r.pagato_parti > 0 && r.stato !== 'arrivato' && <div style={{ fontSize: '11px', color: '#2563eb', marginTop: '3px', whiteSpace: 'nowrap' }}>arrivati {eur(r.pagato_parti)} di {eur(r.importo)}</div>}</td>
                    <td style={td}>
                      {r.stato === 'arrivato' || r.stato === 'altro_metodo' ? <span style={{ color: '#9ca3af' }}>—</span> : (
                        <span style={{ color: r.alert ? '#dc2626' : '#666', fontWeight: r.alert ? 700 : 400 }}>
                          {r.stato === 'in_attesa'
                            ? `${r.giorniDaRicarica}g dalla ricarica${r.alert_no_bonifico ? ' · non ha pagato!' : ''}`
                            : `${r.giorniDaEffettuato ?? 0}g dal bonifico${r.alert_no_arrivo ? ' · verifica incasso!' : ''}`}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                        {r.stato === 'in_attesa' && (
                          <button onClick={() => azione(r.id, 'effettuato')} disabled={facendo === r.id + 'effettuato'} style={btn}>Bonifico effettuato</button>
                        )}
                        {r.stato === 'effettuato' && (
                          <>
                            <button onClick={() => azione(r.id, 'annulla_effettuato')} disabled={!!facendo} style={btnSec} title="Torna in attesa">↶</button>
                            <button onClick={() => azione(r.id, 'arrivato')} disabled={facendo === r.id + 'arrivato'} style={{ ...btn, background: '#16a34a' }}>Bonifico arrivato</button>
                          </>
                        )}
                        {r.stato === 'arrivato' && (
                          <button onClick={() => azione(r.id, 'annulla_arrivato')} disabled={!!facendo} style={btnSec} title="Annulla conferma arrivo">↶ annulla arrivo</button>
                        )}
                        {/* Elimina dal monitoraggio (es. storno -€ sul credito). Conferma popup MoovExpress. */}
                        <button onClick={() => azione(r.id, 'elimina')} disabled={!!facendo} title="Elimina dal Check Ricariche" style={{ background: 'transparent', border: 'none', color: '#b91c1c', fontSize: '15px', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>🗑</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
