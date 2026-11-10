'use client'
import { useEffect, useState } from 'react'
import { METODI_PAGAMENTO, type MetodoPagamento } from '@/lib/contabilita-banca'

// Nella finestra di ricarica: A CHE PUNTO e' il bonifico (per il Check Ricariche, tutti i master) e, dove la
// contabilita' e' accesa (lib/contabilita-banca), COME ha pagato e CHI ha fatto il bonifico, per ritrovarlo
// sull'estratto conto. Propone per primo il nome usato l'ultima volta per quel cliente.
// "Gia' arrivato" (Lorenzo, 10/11): con il bonifico istantaneo i soldi sono sul conto mentre si ricarica, e
// prima bisognava aprire il Check Ricariche solo per segnarlo arrivato.

export type StatoBonifico = 'attesa' | 'effettuato' | 'arrivato'
export type ValorePagamento = { metodo: MetodoPagamento, mittente: string, stato: StatoBonifico }
export const PAGAMENTO_INIZIALE: ValorePagamento = { metodo: 'bonifico', mittente: '', stato: 'attesa' }
const ALTRO = '__altro__'

const STATI: { valore: StatoBonifico, etichetta: string, spiega: string, colore: string }[] = [
  { valore: 'attesa', etichetta: 'Da fare', colore: '#9ca3af',
    spiega: 'Il cliente non l\'ha ancora fatto: nel Check Ricariche resta «in attesa di bonifico».' },
  { valore: 'effettuato', etichetta: 'Fatto, in arrivo', colore: '#d97706',
    spiega: 'Il cliente l\'ha fatto: nel Check Ricariche parte come «bonifico fatto», resta da confermare l\'arrivo.' },
  { valore: 'arrivato', etichetta: 'Già arrivato', colore: '#16a34a',
    spiega: 'I soldi sono già sul conto (bonifico istantaneo): nel Check Ricariche la ricarica risulta subito «arrivata».' },
]

export default function PagamentoRicarica({ target, valore, onChange, onAttiva }: {
  target: string, valore: ValorePagamento, onChange: (v: ValorePagamento) => void, onAttiva?: (attiva: boolean) => void,
}) {
  const [attiva, setAttiva] = useState(false)
  const [pagatori, setPagatori] = useState<{ id: string, nome: string, iban: string | null }[]>([])
  const [scelta, setScelta] = useState('')

  useEffect(() => {
    if (!target) return
    fetch(`/api/contabilita/pagatori?target=${encodeURIComponent(target)}`)
      .then(r => r.json()).then(d => {
        const on = d?.attiva === true
        setAttiva(on); onAttiva?.(on)
        if (!on) return
        const lista = Array.isArray(d.pagatori) ? d.pagatori : []
        setPagatori(lista)
        const primo = lista[0]?.nome || ''
        setScelta(primo || ALTRO)
        if (!valore.mittente && primo) onChange({ ...valore, mittente: primo })
      }).catch(() => { setAttiva(false); onAttiva?.(false) })
  }, [target])  // eslint-disable-line react-hooks/exhaustive-deps

  // Lo stesso nome con due IBAN e' una persona sola nella tendina.
  const nomi = Array.from(new Set(pagatori.map(p => p.nome)))
  const bonifico = !attiva || valore.metodo === 'bonifico'
  const stato = STATI.find(s => s.valore === valore.stato) || STATI[0]

  return (
    <div style={{ marginTop: '14px', padding: '14px', background: '#fafafa', border: '1px solid #ececec', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {attiva && (
        <div>
          <div style={titolo}>Come ha pagato</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {METODI_PAGAMENTO.map(m => (
              <Pillola key={m.valore} acceso={valore.metodo === m.valore} onClick={() => onChange({ ...valore, metodo: m.valore })}>{m.etichetta}</Pillola>
            ))}
          </div>
          {!bonifico && (
            <div style={nota}>Non è un bonifico: questa ricarica non si cercherà sull&apos;estratto conto e non risulterà mai «non pagata».</div>
          )}
        </div>
      )}

      {bonifico && (
        <div>
          <div style={titolo}>Il bonifico</div>
          <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden', background: '#fff', flexWrap: 'wrap' }}>
            {STATI.map((s, i) => {
              const on = valore.stato === s.valore
              return (
                <button key={s.valore} type="button" onClick={() => onChange({ ...valore, stato: s.valore })}
                  style={{ flex: '1 1 120px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px 10px',
                    border: 'none', borderLeft: i ? '1px solid #e5e7eb' : 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600,
                    background: on ? '#fff7ed' : '#fff', color: on ? '#c2410c' : '#374151', boxShadow: on ? 'inset 0 -2px 0 #f97316' : 'none' }}>
                  <Icona stato={s.valore} colore={on ? '#c2410c' : s.colore} />{s.etichetta}
                </button>
              )
            })}
          </div>
          <div style={nota}>{stato.spiega}{attiva && valore.stato === 'arrivato' ? ' L\'estratto conto lo ritroverà comunque, con la data della banca.' : ''}</div>
        </div>
      )}

      {attiva && bonifico && (
        <div>
          <div style={titolo}>Eseguito da</div>
          {nomi.length > 0 && (
            <select value={scelta} onChange={e => { const v = e.target.value; setScelta(v); onChange({ ...valore, mittente: v === ALTRO ? '' : v }) }}
              style={campo}>
              {nomi.map(n => <option key={n} value={n}>{n}</option>)}
              <option value={ALTRO}>+ Un altro nome…</option>
            </select>
          )}
          {(nomi.length === 0 || scelta === ALTRO) && (
            <input value={valore.mittente} onChange={e => onChange({ ...valore, mittente: e.target.value })} maxLength={140}
              placeholder="il nome come compare sul bonifico, es. SALVATORE PELLE" style={{ ...campo, marginTop: nomi.length ? '6px' : 0 }} />
          )}
          <div style={nota}>Serve a ritrovare il bonifico sull&apos;estratto conto. Un nome nuovo resta salvato su questo cliente.</div>
        </div>
      )}
    </div>
  )
}

function Pillola({ acceso, onClick, children }: { acceso: boolean, onClick: () => void, children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: '6px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${acceso ? '#f97316' : '#d1d5db'}`, background: acceso ? '#fff7ed' : '#fff', color: acceso ? '#c2410c' : '#374151' }}>
      {children}
    </button>
  )
}

// Icone a linea (regola di Lorenzo: niente emoji): orologio, freccia in uscita, spunta.
function Icona({ stato, colore }: { stato: StatoBonifico, colore: string }) {
  const p = { fill: 'none', stroke: colore, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      {stato === 'attesa' && <><circle cx="12" cy="12" r="9" {...p} /><path d="M12 7v5l3 2" {...p} /></>}
      {stato === 'effettuato' && <><path d="M4 12h13" {...p} /><path d="M13 6l6 6-6 6" {...p} /></>}
      {stato === 'arrivato' && <><circle cx="12" cy="12" r="9" {...p} /><path d="M8 12.5l2.6 2.5L16 9.5" {...p} /></>}
    </svg>
  )
}

const titolo = { fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }
const nota = { fontSize: '11.5px', color: '#6b7280', marginTop: '6px', lineHeight: 1.4 }
const campo = { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' as const, color: '#1a1a1a', background: '#fff' }
