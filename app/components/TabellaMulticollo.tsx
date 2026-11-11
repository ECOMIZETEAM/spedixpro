'use client'
import { useState } from 'react'
import { caselleSottoCosto, tabellaDalCosto, type ColonnaMulticollo, type TabellaMulticollo } from '@/lib/multicollo-tabella'

// LA TABELLA MULTICOLLO di un contratto, nello stesso verso di tutti i listini: i PESI a sinistra, le
// AREE in alto. La stessa nel listino corrieri (quanto lo fattura il corriere a te), nel listino clienti
// (quanto lo paga chi compra da te, col tuo costo sotto ogni casella) e nelle viste in sola lettura.
// La regola che la usa sta in lib/multicollo-tabella (noloDaTabella): qui si scrivono solo i numeri.
export default function TabellaMulticollo({ colonne, valore, onChange, sola, chi, costo }: {
  colonne: ColonnaMulticollo[]
  valore: TabellaMulticollo | null
  onChange?: (v: TabellaMulticollo | null) => void
  sola?: boolean
  chi: 'corriere' | 'cliente' | 'vista'
  costo?: TabellaMulticollo | null   // il mio costo (solo chi='cliente'): per il rosso e per "copia dal costo"
}) {
  const [perc, setPerc] = useState(0)
  const [euro, setEuro] = useState(0)
  const modificabile = !sola && chi !== 'vista' && !!onChange
  const sotto = new Set(chi === 'cliente' ? caselleSottoCosto(valore, costo || null) : [])
  const eur = (n: number | null | undefined, dec = 2) => (n == null ? '' : n.toFixed(dec).replace('.', ','))
  const inp = { padding: '5px 6px', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '12.5px', color: '#1a1a1a', background: modificabile ? '#fff' : '#f9fafb', boxSizing: 'border-box' as const, width: '78px', textAlign: 'right' as const }
  const rosso = { borderColor: '#dc2626', background: '#fef2f2', color: '#b91c1c', fontWeight: 700 }
  const th = { textAlign: 'right' as const, padding: '8px 8px', fontWeight: 700, color: '#1a1a1a', borderBottom: '1px solid #d1d5db', fontSize: '12px', verticalAlign: 'bottom' as const }
  const td = { padding: '5px 8px', textAlign: 'right' as const, verticalAlign: 'top' as const }
  const num = (s: string) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null }

  // Una tabella vuota, con le fasce del costo se c'e' (cosi' chi vende parte dalle stesse fasce).
  const vuota = (): TabellaMulticollo => ({
    fasce: costo?.fasce?.length ? [...costo.fasce] : [5, 10, 15, 20, 30, 40, 50, 60, 70, 100, 120, 140, 160, 180, 200],
    aree: Object.fromEntries(colonne.map(c => [c.key, (costo?.fasce || [5, 10, 15, 20, 30, 40, 50, 60, 70, 100, 120, 140, 160, 180, 200]).map(() => null)])),
    oltre: {}, remota: Object.fromEntries(Object.keys(costo?.remota || {}).map(k => [k, { minimo: 0, kg: 0 }])),
    partenza: Object.fromEntries(Object.keys(costo?.partenza || {}).map(k => [k, { minimo: 0, kg: 0 }])),
  })
  const t = valore
  const cambia = (f: (x: TabellaMulticollo) => void) => { if (!onChange) return; const x: TabellaMulticollo = JSON.parse(JSON.stringify(t || vuota())); f(x); onChange(x) }
  const costoCella = (area: string, kg: number): number | null => {
    if (!costo) return null
    const i = costo.fasce.findIndex(f => kg <= f + 1e-9)
    return i >= 0 ? (costo.aree[area]?.[i] ?? null) : null
  }
  const zoneRemote = Array.from(new Set([...Object.keys(t?.remota || {}), ...Object.keys(costo?.remota || {})]))
  const zonePartenza = Array.from(new Set([...Object.keys(t?.partenza || {}), ...Object.keys(costo?.partenza || {})]))

  return (
    <div style={{ marginTop: '28px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Multicollo: tabella sul peso totale</div>
      <div style={{ fontSize: '12px', color: '#666', margin: '4px 0 10px', lineHeight: 1.5, maxWidth: '820px' }}>
        Con due o più colli il prezzo è il più alto fra <b>colli × minimo per collo</b> e la <b>tariffa dell&apos;area sul peso totale</b> della
        spedizione, più località remota e partenza remota. Il peso totale si conta collo per collo: misure al centimetro in su, volume, il più alto
        fra peso e volume arrotondato a mezzo chilo in su, poi la somma. Il collo singolo resta sulle fasce normali.
        {chi === 'cliente' && <> Una casella vuota = in quell&apos;area e a quel peso il multicollo non si vende.</>}
      </div>

      {chi === 'cliente' && modificabile && costo && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' as const, margin: '0 0 12px', padding: '10px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', maxWidth: '820px' }}>
          <div style={{ fontSize: '12px', color: '#9a3412', flexBasis: '100%' }}>Copia dal tuo costo e aggiungi un ricarico. Gli euro si sommano alle caselle a prezzo fisso; il prezzo al kg e i supplementi prendono solo la percentuale.</div>
          <label style={{ fontSize: '12px', color: '#1a1a1a' }}>Ricarico %<br /><input type="number" step="0.1" value={perc || ''} onChange={e => setPerc(parseFloat(e.target.value) || 0)} style={{ ...inp, width: '80px' }} placeholder="0" /></label>
          <label style={{ fontSize: '12px', color: '#1a1a1a' }}>Ricarico €<br /><input type="number" step="0.01" value={euro || ''} onChange={e => setEuro(parseFloat(e.target.value) || 0)} style={{ ...inp, width: '80px' }} placeholder="0" /></label>
          <button type="button" onClick={() => onChange!(tabellaDalCosto(costo, perc, euro))} style={{ background: '#ea580c', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>Copia dal costo</button>
        </div>
      )}

      {!t && !modificabile && <div style={{ fontSize: '12px', color: '#999' }}>Nessuna tabella multicollo.</div>}
      {!t && modificabile && (
        <button type="button" onClick={() => onChange!(vuota())} style={{ background: '#fff', color: '#ea580c', border: '1px solid #ea580c', borderRadius: '6px', padding: '6px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>Crea la tabella multicollo</button>
      )}

      {t && (
        <div style={{ overflowX: 'auto' as const, maxWidth: '100%' }}>
          <table style={{ borderCollapse: 'collapse' as const, fontSize: '12.5px' }}>
            <thead><tr style={{ background: '#fafafa' }}>
              <th style={{ ...th, textAlign: 'left' as const }}>Fino a kg</th>
              {colonne.map(c => <th key={c.key} style={{ ...th, maxWidth: '150px', whiteSpace: 'normal' as const }} title={c.nome}>{c.nome}</th>)}
            </tr></thead>
            <tbody>
              {t.fasce.map((kg, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ ...td, textAlign: 'left' as const }}>
                    {chi === 'corriere' && modificabile
                      ? <input type="number" step="0.5" value={kg} onChange={e => cambia(x => { x.fasce[i] = parseFloat(e.target.value) || 0 })} style={{ ...inp, width: '64px' }} />
                      : <b>{String(kg).replace('.', ',')}</b>}
                  </td>
                  {colonne.map(c => {
                    const v = t.aree[c.key]?.[i] ?? null
                    const cc = costoCella(c.key, kg)
                    const rossa = sotto.has(`${c.key}|${kg}`)
                    return (
                      <td key={c.key} style={td}>
                        {modificabile
                          ? <input type="number" step="0.01" min="0" value={v ?? ''} placeholder="—" onChange={e => cambia(x => { (x.aree[c.key] ||= x.fasce.map(() => null))[i] = num(e.target.value) })} style={{ ...inp, ...(rossa ? rosso : {}) }} />
                          : <span>{v == null ? '—' : eur(v)}</span>}
                        {chi === 'cliente' && cc != null && <div style={{ fontSize: '10px', color: rossa ? '#dc2626' : '#999', marginTop: '2px' }}>costo {eur(cc)}</div>}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid #d1d5db', background: '#fafafa' }}>
                <td style={{ ...td, textAlign: 'left' as const, fontSize: '12px' }}>oltre {String(t.fasce[t.fasce.length - 1] ?? '').replace('.', ',')} kg<br /><span style={{ color: '#666' }}>€ al kg sul totale</span></td>
                {colonne.map(c => {
                  const v = t.oltre[c.key] ?? null, cc = costo?.oltre?.[c.key] ?? null, rossa = sotto.has(`${c.key}|oltre`)
                  return (
                    <td key={c.key} style={td}>
                      {modificabile
                        ? <input type="number" step="0.0001" min="0" value={v ?? ''} placeholder="—" onChange={e => cambia(x => { const n = num(e.target.value); if (n) x.oltre[c.key] = n; else delete x.oltre[c.key] })} style={{ ...inp, ...(rossa ? rosso : {}) }} />
                        : <span>{v == null ? '—' : eur(v, 4)}</span>}
                      {chi === 'cliente' && cc != null && <div style={{ fontSize: '10px', color: rossa ? '#dc2626' : '#999', marginTop: '2px' }}>costo {eur(cc, 4)}</div>}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
          {chi === 'corriere' && modificabile && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button type="button" onClick={() => cambia(x => { const ult = x.fasce[x.fasce.length - 1] || 0; x.fasce.push(ult + 10); for (const k of Object.keys(x.aree)) x.aree[k].push(null) })} style={{ background: '#fff', color: '#1a1a1a', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer' }}>+ fascia</button>
              {t.fasce.length > 1 && <button type="button" onClick={() => cambia(x => { x.fasce.pop(); for (const k of Object.keys(x.aree)) x.aree[k].pop() })} style={{ background: '#fff', color: '#1a1a1a', border: '1px solid #d1d5db', borderRadius: '6px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer' }}>− ultima fascia</button>}
            </div>
          )}

          {[['remota', 'Località remota', zoneRemote, 'Si somma alla tariffa quando la destinazione è in questa zona.'], ['partenza', 'Partenza remota', zonePartenza, 'Si somma alla tariffa quando il mittente è in questa zona. Se il mittente è in una zona senza prezzo, il multicollo non si vende.']].map(([tipo, titolo, zone, nota]: any) => zone.length > 0 && (
            <div key={tipo} style={{ marginTop: '18px', maxWidth: '620px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1a1a1a' }}>{titolo}</div>
              <div style={{ fontSize: '11.5px', color: '#666', margin: '2px 0 6px' }}>{nota} Si paga il minimo, oppure gli € al kg sul peso totale se sono di più.</div>
              <table style={{ borderCollapse: 'collapse' as const, fontSize: '12.5px' }}>
                <thead><tr style={{ background: '#fafafa' }}>
                  <th style={{ ...th, textAlign: 'left' as const }}>Zona</th><th style={th}>Minimo €</th><th style={th}>€ al kg</th>
                </tr></thead>
                <tbody>
                  {zone.map((z: string) => {
                    const v = (t as any)[tipo][z] as { minimo: number; kg: number } | undefined, cc = (costo as any)?.[tipo]?.[z]
                    const rossa = sotto.has(`${tipo}|${z}`)
                    const campo = (k: 'minimo' | 'kg', dec: number) => modificabile
                      ? <input type="number" step={dec === 2 ? '0.01' : '0.0001'} min="0" value={v?.[k] || ''} placeholder="—" onChange={e => cambia(x => { const cur = (x as any)[tipo][z] || { minimo: 0, kg: 0 }; cur[k] = parseFloat(e.target.value) || 0; (x as any)[tipo][z] = cur })} style={{ ...inp, ...(rossa ? rosso : {}) }} />
                      : <span>{v?.[k] ? eur(v[k], dec) : '—'}</span>
                    return (
                      <tr key={z} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ ...td, textAlign: 'left' as const, color: rossa ? '#b91c1c' : '#1a1a1a' }}>{z}{chi === 'cliente' && cc && <div style={{ fontSize: '10px', color: rossa ? '#dc2626' : '#999' }}>costo {eur(cc.minimo)} € o {eur(cc.kg, 4)} €/kg</div>}</td>
                        <td style={td}>{campo('minimo', 2)}</td>
                        <td style={td}>{campo('kg', 4)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {modificabile && (
            <div style={{ marginTop: '12px' }}>
              <button type="button" onClick={() => onChange!(null)} style={{ background: 'none', color: '#b91c1c', border: 'none', padding: 0, fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>Togli la tabella multicollo</button>
              <span style={{ fontSize: '11px', color: '#999', marginLeft: '8px' }}>senza tabella vale la regola di prima: minimo a collo oppure la fascia del collo singolo sul peso totale.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
