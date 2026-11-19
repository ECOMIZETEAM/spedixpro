'use client'
import type { VoceSupplemento } from '@/lib/supplementi-corriere'

// La tabella dei supplementi del corriere nella sezione Giacenze: la stessa nel listino corrieri (quanto
// lo fattura il corriere a te) e nel listino clienti (quanto lo paga il cliente). Solo prezzo fisso:
// il corriere li fattura a importo fisso, e il carburante che ci mette sopra lo legge il controllo fattura.
export default function TabellaSupplementiCorriere({ voci, onChange, sola, chi, costi }: {
  voci: VoceSupplemento[]
  onChange: (v: VoceSupplemento[]) => void
  sola?: boolean
  chi: 'corriere' | 'cliente'
  costi?: Record<string, { valore: number }>   // il mio costo per voce (chiave "supplemento_corriere|nome"), per il rosso sotto costo
}) {
  const inp = { padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '13px', color: '#1a1a1a', background: sola ? '#f9fafb' : '#fff', boxSizing: 'border-box' as const, width: '120px', textAlign: 'right' as const }
  const th = { textAlign: 'left' as const, padding: '9px 12px', fontWeight: '700', color: '#1a1a1a', borderBottom: '1px solid #d1d5db' }
  const eur = (n: number) => n.toFixed(2).replace('.', ',')
  return (
    <div style={{ marginTop: '28px', maxWidth: '700px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Supplementi del corriere</div>
      <div style={{ fontSize: '12px', color: '#666', margin: '4px 0 10px', lineHeight: 1.5 }}>
        {chi === 'corriere'
          ? 'Nessuno li sceglie in creazione: il corriere li mette in fattura dopo, quando misura il pacco. Scrivi quanto te li fattura: il controllo della fattura confronta ogni voce con questo prezzo.'
          : 'Nessuno li sceglie in creazione: il corriere li mette in fattura dopo, quando misura il pacco. Scrivi quanto li paga il cliente.'}
        {' '}Vuoto = non si addebita.
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
        <thead><tr style={{ background: '#fafafa' }}>
          <th style={th}>Supplemento</th>
          <th style={th}>Prezzo <span style={{ color: '#666', fontWeight: '400' }}>€</span></th>
        </tr></thead>
        <tbody>
          {voci.map((v, i) => {
            const costo = costi?.[`supplemento_corriere|${v.nome.toLowerCase()}`]?.valore || 0
            // Sotto costo anche se vuoto: il corriere te lo fattura e il cliente non lo paga.
            const sotto = chi === 'cliente' && costo > 0 && (Number(v.prezzo) || 0) < costo - 0.005
            return (
              <tr key={v.nome} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '8px 12px', color: sotto ? '#b91c1c' : '#f97316', fontWeight: sotto ? 700 : 500 }}>
                  {v.nome}
                  {sotto && <div style={{ fontSize: '10px', color: '#dc2626', marginTop: '2px', fontWeight: 400 }}>a te costa {eur(costo)} €</div>}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <input type="number" step="0.01" min="0" disabled={sola} value={v.prezzo || ''} placeholder="Niente"
                    onChange={e => onChange(voci.map((x, k) => k === i ? { ...x, prezzo: parseFloat(e.target.value) || 0 } : x))}
                    style={{ ...inp, ...(sotto ? { borderColor: '#dc2626', background: '#fef2f2', color: '#b91c1c', fontWeight: 700 } : {}) }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
