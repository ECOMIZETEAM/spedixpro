'use client'
import { useEffect, useState } from 'react'
import { METODI_PAGAMENTO, type MetodoPagamento } from '@/lib/contabilita-banca'

// Nella finestra di ricarica: COME ha pagato e CHI ha fatto il bonifico (lib/contabilita-banca), per
// ritrovarlo sull'estratto conto. Propone per primo il nome usato l'ultima volta per quel cliente.
// Per i master su cui la funzione non e' accesa la rotta risponde attiva:false e qui non compare niente.

export type ValorePagamento = { metodo: MetodoPagamento, mittente: string }
const ALTRO = '__altro__'

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

  if (!attiva) return null
  // Lo stesso nome con due IBAN e' una persona sola nella tendina.
  const nomi = Array.from(new Set(pagatori.map(p => p.nome)))

  return (
    <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #e5e7eb' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>Come ha pagato</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {METODI_PAGAMENTO.map(m => {
          const on = valore.metodo === m.valore
          return (
            <button key={m.valore} type="button" onClick={() => onChange({ ...valore, metodo: m.valore })}
              style={{ padding: '6px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${on ? '#f97316' : '#d1d5db'}`, background: on ? '#fff7ed' : '#fff', color: on ? '#c2410c' : '#374151' }}>
              {m.etichetta}
            </button>
          )
        })}
      </div>

      {valore.metodo === 'bonifico' ? (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '6px' }}>Bonifico eseguito da</div>
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
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '5px' }}>
            Serve a ritrovare il bonifico sull&apos;estratto conto. Un nome nuovo resta salvato su questo cliente.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '8px' }}>
          Non è un bonifico: questa ricarica non si cercherà sull&apos;estratto conto e non risulterà mai &quot;non pagata&quot;.
        </div>
      )}
    </div>
  )
}

const campo = { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' as const, color: '#1a1a1a', background: '#fff' }
