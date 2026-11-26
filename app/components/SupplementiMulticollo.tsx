'use client'
import { supplementiSottoCosto, type SupplementiMulticollo as Suppl } from '@/lib/multicollo-zone'

// LOCALITA' REMOTA e PARTENZA REMOTA del multicollo (scheda Multicollo del listino): per ogni zona, il
// minimo oppure tot € al kg sul peso totale, se di piu' — come li fa pagare il fornitore. La regola che li
// usa sta in lib/multicollo-zone (noloMulticolloDaFasce). Stesso riquadro nel listino corrieri (quanto lo
// paghi), nel listino clienti (quanto lo fai pagare, col tuo costo sotto) e nelle viste in sola lettura.
export default function SupplementiMulticollo({ valore, onChange, sola, chi, costo, zoneRemote, zonePartenza, zoneMulticollo = [], minimoVendita = 0, minimoCosto = 0 }: {
  valore: Suppl | null
  onChange?: (v: Suppl | null) => void
  sola?: boolean
  chi: 'corriere' | 'cliente' | 'vista'
  costo?: Suppl | null
  zoneRemote: string[]     // zone del collo singolo che si possono indicare come remote
  zonePartenza: string[]   // zone di partenza del contratto
  zoneMulticollo?: string[]  // zone multicollo del contratto (minimo per collo per zona)
  minimoVendita?: number     // voce unica "minimo per collo" di questo listino (vale dove la zona non ha il suo)
  minimoCosto?: number       // voce unica "minimo per collo" del costo di chi vende (listino cliente)
}) {
  const modificabile = !sola && chi !== 'vista' && !!onChange
  const sotto = new Set(chi === 'cliente' ? supplementiSottoCosto(valore, costo || null, minimoVendita, minimoCosto, zoneMulticollo) : [])
  const eur = (n: number, dec = 2) => n.toFixed(dec).replace('.', ',')
  const inp = { padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '13px', color: '#1a1a1a', background: modificabile ? '#fff' : '#f9fafb', boxSizing: 'border-box' as const, width: '100px', textAlign: 'right' as const }
  const rosso = { borderColor: '#dc2626', background: '#fef2f2', color: '#b91c1c', fontWeight: 700 }
  const th = { textAlign: 'left' as const, padding: '9px 12px', fontWeight: 700, color: '#1a1a1a', borderBottom: '1px solid #d1d5db' }
  const vuoto: Suppl = { remota: {}, partenza: {} }
  const cambia = (f: (x: Suppl) => void) => { if (!onChange) return; const x: Suppl = JSON.parse(JSON.stringify(valore || vuoto)); f(x); onChange(x) }

  const sezione = (tipo: 'remota' | 'partenza', titolo: string, nota: string, disponibili: string[]) => {
    const righe = Array.from(new Set([...Object.keys(valore?.[tipo] || {}), ...Object.keys(costo?.[tipo] || {})]))
    const aggiungibili = disponibili.filter(z => !righe.includes(z))
    if (!righe.length && !modificabile) return null
    return (
      <div style={{ marginTop: '22px', maxWidth: '640px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>{titolo}</div>
        <div style={{ fontSize: '12px', color: '#666', margin: '4px 0 10px', lineHeight: 1.5 }}>{nota} Si paga il minimo, oppure gli € al kg sul peso totale se sono di più.</div>
        {righe.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
            <thead><tr style={{ background: '#fafafa' }}>
              <th style={th}>Zona</th><th style={th}>Minimo <span style={{ color: '#666', fontWeight: 400 }}>€</span></th><th style={th}>Al kg <span style={{ color: '#666', fontWeight: 400 }}>€</span></th>
              <th style={th} title="Si somma anche quando vale il minimo per collo (UPS Italia, isole minori)">Anche sul minimo</th>
            </tr></thead>
            <tbody>
              {righe.map(z => {
                const v = valore?.[tipo]?.[z], c = costo?.[tipo]?.[z], r = sotto.has(`${tipo}|${z}`)
                const campo = (k: 'minimo' | 'kg', step: string, dec: number) => modificabile
                  ? <input type="number" step={step} min="0" value={v?.[k] || ''} placeholder="Niente" style={{ ...inp, ...(r ? rosso : {}) }}
                      onChange={e => cambia(x => { const cur = x[tipo][z] || { minimo: 0, kg: 0 }; cur[k] = parseFloat(e.target.value) || 0; x[tipo][z] = cur })} />
                  : <span>{v?.[k] ? eur(v[k], dec) : '—'}</span>
                return (
                  <tr key={z} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px 12px', color: r ? '#b91c1c' : '#1a1a1a', fontWeight: r ? 700 : 500 }}>
                      {z}
                      {chi === 'cliente' && c && <div style={{ fontSize: '10px', color: r ? '#dc2626' : '#999', marginTop: '2px', fontWeight: 400 }}>a te costa {eur(c.minimo)} € o {eur(c.kg, 4)} €/kg</div>}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{campo('minimo', '0.01', 2)}</td>
                    <td style={{ padding: '8px 12px' }}>{campo('kg', '0.0001', 4)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' as const }}>
                      <input type="checkbox" checked={!!v?.sempre} disabled={!modificabile}
                        onChange={e => cambia(x => { const cur = x[tipo][z] || { minimo: 0, kg: 0 }; if (e.target.checked) cur.sempre = true; else delete cur.sempre; x[tipo][z] = cur })} />
                      {chi === 'cliente' && c?.sempre && !v?.sempre && <div style={{ fontSize: '10px', color: '#dc2626', marginTop: '2px' }}>al costo sì</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {modificabile && aggiungibili.length > 0 && (
          <select value="" onChange={e => { const z = e.target.value; if (z) cambia(x => { x[tipo][z] = { minimo: 0, kg: 0 } }) }} style={{ ...inp, width: 'auto', textAlign: 'left' as const, marginTop: '8px' }}>
            <option value="">+ aggiungi una zona…</option>
            {aggiungibili.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        )}
      </div>
    )
  }

  // REGOLA DEL FORNITORE (lib/multicollo-zone): minimo fisso per spedizione, sommato a minimo per collo x colli,
  // ed euro per ogni collo, sommati alla tariffa sul totale. UPS Italia: 0,93 e 0,74. Vuoti = non si usano.
  const regola = () => {
    // Compare dove c'e' gia' un valore (al costo o in vendita) o nel listino corrieri di chi la imposta: sugli
    // altri corrieri sarebbe un riquadro vuoto che non c'entra.
    if (!valore?.minimoFisso && !valore?.perCollo && !costo?.minimoFisso && !costo?.perCollo && !(modificabile && chi === 'corriere')) return null
    const voce = (k: 'minimoFisso' | 'perCollo', titolo: string, nota: string, step: string, dec: number) => {
      const v = valore?.[k] || 0, c = costo?.[k] || 0, r = sotto.has(`regola|${k === 'minimoFisso' ? 'minimo_fisso' : 'per_collo'}`)
      return (
        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
          <td style={{ padding: '8px 12px', color: r ? '#b91c1c' : '#1a1a1a', fontWeight: r ? 700 : 500 }}>
            {titolo}
            <div style={{ fontSize: '10px', color: '#999', marginTop: '2px', fontWeight: 400 }}>{nota}</div>
            {chi === 'cliente' && c > 0 && <div style={{ fontSize: '10px', color: r ? '#dc2626' : '#999', marginTop: '2px', fontWeight: 400 }}>a te costa {eur(c, dec)} €</div>}
          </td>
          <td style={{ padding: '8px 12px' }}>
            {modificabile
              ? <input type="number" step={step} min="0" value={v || ''} placeholder="Niente" style={{ ...inp, ...(r ? rosso : {}) }}
                  onChange={e => cambia(x => { const n = parseFloat(e.target.value) || 0; if (n > 0) x[k] = n; else delete x[k] })} />
              : <span>{v ? eur(v, dec) : '—'}</span>}
          </td>
        </tr>
      )
    }
    return (
      <div style={{ marginTop: '22px', maxWidth: '640px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Regola del fornitore</div>
        <div style={{ fontSize: '12px', color: '#666', margin: '4px 0 10px', lineHeight: 1.5 }}>Solo per i corrieri che le usano (UPS Italia). Si paga il più alto fra il minimo (minimo per collo × colli + minimo fisso) e la tariffa sul peso totale più gli euro per collo.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
          <tbody>
            {voce('minimoFisso', 'Minimo fisso', 'per spedizione, si somma al minimo per collo × colli', '0.01', 2)}
            {voce('perCollo', 'Per ogni collo', 'si somma alla tariffa sul peso totale', '0.01', 2)}
          </tbody>
        </table>
      </div>
    )
  }

  // MINIMO PER COLLO PER ZONA MULTICOLLO (UPS Italia: 7,587 zona A, 7,635 zona B). Vuoto = vale la voce unica
  // "Minimo per collo" qui sopra. Compare dove c'e' gia' un valore o nel listino corrieri di chi lo imposta.
  const minimiZona = () => {
    const nomi = Array.from(new Set([...zoneMulticollo, ...Object.keys(valore?.minimoPerZona || {}), ...Object.keys(costo?.minimoPerZona || {})]))
    const usato = Object.keys(valore?.minimoPerZona || {}).length || Object.keys(costo?.minimoPerZona || {}).length
    if (!nomi.length || (!usato && !(modificabile && chi === 'corriere'))) return null
    return (
      <div style={{ marginTop: '22px', maxWidth: '640px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Minimo per collo, zona per zona</div>
        <div style={{ fontSize: '12px', color: '#666', margin: '4px 0 10px', lineHeight: 1.5 }}>Solo se il corriere ha un minimo diverso per zona (UPS Italia). Vuoto = vale il minimo per collo unico.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' }}>
          <tbody>
            {nomi.map(z => {
              const v = valore?.minimoPerZona?.[z] || 0, c = costo?.minimoPerZona?.[z] || minimoCosto || 0, r = sotto.has(`regola|minimo_zona:${z}`)
              return (
                <tr key={z} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 12px', color: r ? '#b91c1c' : '#1a1a1a', fontWeight: r ? 700 : 500 }}>
                    {z}
                    {chi === 'cliente' && c > 0 && <div style={{ fontSize: '10px', color: r ? '#dc2626' : '#999', marginTop: '2px', fontWeight: 400 }}>a te costa {eur(c, 3)} € a collo</div>}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {modificabile
                      ? <input type="number" step="0.001" min="0" value={v || ''} placeholder={minimoVendita ? eur(minimoVendita, 3) : 'Niente'} style={{ ...inp, ...(r ? rosso : {}) }}
                          onChange={e => cambia(x => { const n = parseFloat(e.target.value) || 0; const m = { ...(x.minimoPerZona || {}) }; if (n > 0) m[z] = n; else delete m[z]; if (Object.keys(m).length) x.minimoPerZona = m; else delete x.minimoPerZona })} />
                      : <span>{v ? eur(v, 3) : '—'}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      {regola()}
      {minimiZona()}
      {sezione('remota', 'Località remota', 'Si somma alla tariffa multicollo quando la destinazione cade in questa zona (la stessa zona del collo singolo).', zoneRemote)}
      {sezione('partenza', 'Partenza remota', 'Si somma alla tariffa multicollo quando il mittente è in questa zona di partenza. Se il mittente è in una zona di partenza senza prezzo, il multicollo non si vende.', zonePartenza)}
    </>
  )
}
