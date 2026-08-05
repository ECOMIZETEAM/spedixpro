'use client'
import { useMemo, useState } from 'react'

// LE VARIANTI NON SI SCRIVONO UNA PER UNA: SI DEFINISCONO LE OPZIONI.
//
// E' il modello di Shopify, ed e' migliore del campo di testo che avevo messo prima per un motivo
// pratico: una maglietta con 4 colori e 3 taglie fa DODICI articoli. Scritti a mano sono dodici
// inserimenti, e chi deve farlo semplicemente non lo fa — la funzione resta inutilizzata.
// Qui si scrive "COLORE: rosso, verde, blu, arancio" e "TAGLIA: S, M, L", e le dodici combinazioni
// escono da sole, gia' pronte da compilare in griglia.
//
// Il modello dei dati NON cambia: ogni combinazione resta UNA RIGA CON IL SUO SKU, che e' quello
// che fa combaciare gli ordini di Shopify e Amazon e che tiene la giacenza separata.

export type RigaVariante = { sku: string; valori: string[]; peso: string }
export type Opzione = { nome: string; valori: string[] }

const inp: any = { width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' }
const lbl: any = { display: 'block', fontSize: '11.5px', color: '#666', marginBottom: '4px' }

// SKU suggerito: prodotto + valori, in maiuscolo e senza spazi. E' un suggerimento, non un
// obbligo: chi ha gia' i suoi codici li sovrascrive riga per riga.
const pezzo = (s: string) => (s || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '').slice(0, 12)
export function skuSuggerito(prodotto: string, valori: string[]) {
  return [pezzo(prodotto), ...valori.map(pezzo)].filter(Boolean).join('-')
}

// Il prodotto cartesiano delle opzioni: [rosso,verde] x [S,M] -> [[rosso,S],[rosso,M],[verde,S],[verde,M]]
function combina(opzioni: Opzione[]): string[][] {
  return opzioni.reduce<string[][]>((acc, o) => {
    const valori = o.valori.filter(Boolean)
    if (!valori.length) return acc
    return acc.flatMap(riga => valori.map(v => [...riga, v]))
  }, [[]])
}

// Il NOME DEL PRODOTTO arriva da fuori e non e' un campo di questo componente: nel modulo unico
// e' gia' il campo "Nome" in cima, e chiederlo due volte confonderebbe — quale dei due vale?
export default function GeneratoreVarianti({ prodotto, onSalva, salvataggio }: {
  prodotto: string
  onSalva: (prodotto: string, opzioni: Opzione[], righe: RigaVariante[]) => void
  salvataggio?: boolean
}) {
  const [opzioni, setOpzioni] = useState<Opzione[]>([{ nome: '', valori: [] }])
  const [testoValori, setTestoValori] = useState<string[]>([''])
  const [righe, setRighe] = useState<RigaVariante[] | null>(null)
  const [pesoTutte, setPesoTutte] = useState('')

  const opzioniPulite = useMemo(
    () => opzioni.map((o, i) => ({ nome: o.nome.trim(), valori: testoValori[i].split(',').map(v => v.trim()).filter(Boolean) }))
      .filter(o => o.nome && o.valori.length),
    [opzioni, testoValori])

  const quante = opzioniPulite.length ? combina(opzioniPulite).length : 0

  function genera() {
    const combinazioni = combina(opzioniPulite)
    // Si tengono le righe gia' compilate quando si rigenera: cambiare una taglia non deve far
    // ributtare via gli SKU scritti a mano per le altre.
    const perChiave = new Map((righe || []).map(r => [r.valori.join('|'), r]))
    setRighe(combinazioni.map(valori => {
      const gia = perChiave.get(valori.join('|'))
      return gia || { sku: skuSuggerito(prodotto, valori), valori, peso: pesoTutte }
    }))
  }

  const duplicati = useMemo(() => {
    const visti = new Set<string>(); const dup = new Set<string>()
    for (const r of (righe || [])) { const k = r.sku.trim().toUpperCase(); if (!k) continue; if (visti.has(k)) dup.add(k); visti.add(k) }
    return dup
  }, [righe])

  const senzaSku = (righe || []).some(r => !r.sku.trim())

  return (
    <div>
      <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#666', margin: '4px 0 8px', textTransform: 'uppercase' }}>Opzioni</div>
      {opzioni.map((o, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '190px 1fr auto', gap: '8px', marginBottom: '8px', alignItems: 'end' }}>
          <div>
            <label style={lbl}>Nome opzione</label>
            <input value={o.nome} onChange={e => setOpzioni(x => x.map((y, j) => j === i ? { ...y, nome: e.target.value } : y))} placeholder="COLORE" style={inp} />
          </div>
          <div>
            <label style={lbl}>Valori <span style={{ color: '#999' }}>(separati da virgola)</span></label>
            <input value={testoValori[i]} onChange={e => setTestoValori(x => x.map((y, j) => j === i ? e.target.value : y))} placeholder="rosso, verde, blu, arancio" style={inp} />
          </div>
          <button type="button" onClick={() => { setOpzioni(x => x.filter((_, j) => j !== i)); setTestoValori(x => x.filter((_, j) => j !== i)) }}
            disabled={opzioni.length === 1}
            style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '6px', cursor: opzioni.length === 1 ? 'not-allowed' : 'pointer', padding: '8px 12px', fontSize: '13px', opacity: opzioni.length === 1 ? 0.4 : 1 }}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
        <button type="button" onClick={() => { setOpzioni(x => [...x, { nome: '', valori: [] }]); setTestoValori(x => [...x, '']) }}
          style={{ background: '#fff', color: '#f97316', border: '1px dashed #fdba74', borderRadius: '6px', padding: '8px 14px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>
          + un&apos;altra opzione
        </button>
        <button type="button" onClick={genera} disabled={!quante}
          style={{ background: quante ? '#111827' : '#e5e7eb', color: quante ? '#fff' : '#9ca3af', border: 'none', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: quante ? 'pointer' : 'not-allowed' }}>
          Genera {quante ? `${quante} varianti` : 'varianti'}
        </button>
        {quante > 40 && <span style={{ fontSize: '12px', color: '#b45309' }}>Sono {quante} articoli: controlla che sia quello che vuoi.</span>}
      </div>

      {righe && (
        <>
          <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#666', margin: '18px 0 8px', textTransform: 'uppercase', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span>{righe.length} varianti</span>
            <span style={{ fontWeight: 400, textTransform: 'none', color: '#999' }}>
              ognuna è un articolo con il suo SKU e la sua giacenza
            </span>
            <span style={{ marginLeft: 'auto', fontWeight: 400, textTransform: 'none', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input value={pesoTutte} onChange={e => setPesoTutte(e.target.value)} placeholder="peso kg" inputMode="decimal" style={{ ...inp, width: '92px', padding: '5px 8px' }} />
              <button type="button" onClick={() => setRighe(r => (r || []).map(x => ({ ...x, peso: pesoTutte })))}
                style={{ background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', cursor: 'pointer' }}>applica a tutte</button>
            </span>
          </div>

          <div style={{ border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '11px', color: '#666', fontWeight: 700 }}>VARIANTE</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '11px', color: '#666', fontWeight: 700 }}>SKU *</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '11px', color: '#666', fontWeight: 700, width: '110px' }}>PESO (KG)</th>
                <th style={{ width: '40px' }}></th>
              </tr></thead>
              <tbody>
                {righe.map((r, i) => {
                  const dup = duplicati.has(r.sku.trim().toUpperCase())
                  return (
                    <tr key={i} style={{ borderTop: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '6px 12px', fontSize: '13px', fontWeight: 600 }}>{r.valori.join(' · ')}</td>
                      <td style={{ padding: '6px 12px' }}>
                        <input value={r.sku} onChange={e => setRighe(x => (x || []).map((y, j) => j === i ? { ...y, sku: e.target.value } : y))}
                          style={{ ...inp, padding: '6px 9px', borderColor: (dup || !r.sku.trim()) ? '#fca5a5' : '#d1d5db' }} />
                      </td>
                      <td style={{ padding: '6px 12px' }}>
                        <input value={r.peso} onChange={e => setRighe(x => (x || []).map((y, j) => j === i ? { ...y, peso: e.target.value } : y))} inputMode="decimal" style={{ ...inp, padding: '6px 9px' }} />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {/* Non tutte le combinazioni esistono davvero: la rossa in L puo' non essere
                            mai stata prodotta. Si toglie invece di crearla e lasciarla a zero per sempre. */}
                        <button type="button" onClick={() => setRighe(x => (x || []).filter((_, j) => j !== i))}
                          title="Questa combinazione non esiste"
                          style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: '15px' }}>×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {(duplicati.size > 0 || senzaSku) && (
            <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#b91c1c' }}>
              {senzaSku && <div>Ogni variante deve avere il suo SKU: è il codice con cui viene riconosciuta negli ordini.</div>}
              {duplicati.size > 0 && <div>Ci sono SKU ripetuti ({[...duplicati].join(', ')}): due varianti con lo stesso codice diventerebbero una sola.</div>}
            </div>
          )}

          {/* UN TASTO SPENTO CHE NON DICE PERCHE' e' peggio di un errore: uno preme, non succede
              niente, e non sa cosa gli manca. Qui il motivo si legge accanto al tasto. */}
          {!prodotto.trim() && (
            <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#b45309' }}>
              Manca il <b>nome del prodotto</b> qui sopra: serve anche a comporre gli SKU suggeriti.
            </div>
          )}
          <div style={{ marginTop: '14px' }}>
            <button type="button" disabled={!!salvataggio || !righe.length || !!duplicati.size || senzaSku || !prodotto.trim()}
              onClick={() => onSalva(prodotto.trim(), opzioniPulite, righe)}
              style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px 18px', fontSize: '13px', fontWeight: 700,
                cursor: (salvataggio || duplicati.size || senzaSku || !prodotto.trim()) ? 'not-allowed' : 'pointer',
                opacity: (salvataggio || duplicati.size || senzaSku || !prodotto.trim()) ? 0.5 : 1 }}>
              {salvataggio ? 'Creo…' : `Crea ${righe.length} articoli`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
