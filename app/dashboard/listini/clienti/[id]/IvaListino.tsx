'use client'
import { useEffect, useState } from 'react'

// IVA INCLUSA O ESCLUSA SU UN LISTINO VENDUTO (Lorenzo, 20/11/2026).
//
// Tre pezzi per l'editor del listino: il riquadro "I prezzi di questo listino sono", l'etichetta e la
// tendina di ogni contratto, e la finestra "Da quando vale?" che si apre prima di ogni salvataggio.
// La scelta NON tocca prezzi, movimenti o credito: i report e la proforma la usano per dividere
// imponibile e IVA (scripts/iva-listini.sql, lib/iva-calcolo.ts). Si salva da sola, a parte dal
// pulsante Salva dei prezzi: e' una decisione diversa, e la finestra chiede da quando vale.

export type StatoIva = { listino: boolean; corrieri: Record<string, boolean | null> }
type Richiesta = { corriereId: string | null; nomeCorriere?: string; valore: boolean | null }

const nomeIva = (v: boolean) => (v ? 'IVA inclusa' : 'IVA esclusa')

// Il primo del mese e oggi, sul giorno di Roma: sono le due date che il database usera'.
function dateDiRoma() {
  const oggi = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' })
  const [, m, a] = oggi.split('/')
  const mese = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', month: 'long' })
  return { oggi, primo: `01/${m}/${a}`, mese }
}

export function useIvaListino(listinoId: string, nomeListino: string, iniziale: StatoIva, acquirenti: string[]) {
  const [stato, setStato] = useState<StatoIva>(iniziale)
  const [richiesta, setRichiesta] = useState<Richiesta | null>(null)
  const [da, setDa] = useState<'mese' | 'oggi'>('mese')
  const [salvo, setSalvo] = useState(false)
  const [errore, setErrore] = useState('')
  const [fatto, setFatto] = useState('')

  const vale = (corriereId: string) => { const v = stato.corrieri[corriereId]; return v == null ? stato.listino : v }
  // Impostato a parte = ha una scelta sua, anche se oggi coincide col listino: cambiando il listino, lui non segue.
  const aParte = (corriereId: string) => stato.corrieri[corriereId] != null
  const chiedi = (r: Richiesta) => { setRichiesta(r); setDa('mese'); setErrore(''); setFatto('') }
  // Esc chiude la finestra (se non sta salvando).
  useEffect(() => {
    if (!richiesta) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !salvo) setRichiesta(null) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [richiesta, salvo])

  async function conferma() {
    if (!richiesta) return
    setSalvo(true); setErrore('')
    try {
      const res = await fetch('/api/listini/iva', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listino_id: listinoId, corriere_id: richiesta.corriereId, iva_inclusa: richiesta.valore, da }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.ok) { setErrore(d?.error || `Scelta non salvata (errore ${res.status})`); return }
      // Salvata ma non riletta: si ricarica la pagina, che la rilegge dal database.
      if (!d.stato) { window.location.reload(); return }
      setStato(d.stato)
      const { primo, oggi } = dateDiRoma()
      const quando = da === 'mese' ? `dal ${primo}` : `da oggi, ${oggi}`
      const cosa = richiesta.corriereId
        ? (richiesta.valore == null ? `${richiesta.nomeCorriere} torna come il listino` : `${richiesta.nomeCorriere}: ${nomeIva(richiesta.valore)}`)
        : `Listino ${nomeIva(!!richiesta.valore)}`
      setFatto(`✓ ${cosa}, ${quando}. Il credito non cambia.`)
      setRichiesta(null)
    } catch {
      setErrore('Errore di rete: la scelta non è stata salvata')
    } finally {
      setSalvo(false)
    }
  }

  const { oggi, primo, mese } = dateDiRoma()
  const usa = acquirenti.length > 1 ? 'Usano questo listino' : 'Usa questo listino'
  const elencoAcquirenti = acquirenti.length > 5
    ? `${acquirenti.slice(0, 5).join(', ')} e altri ${acquirenti.length - 5}`
    : acquirenti.join(', ')

  let titolo = '', spiega = ''
  if (richiesta) {
    if (!richiesta.corriereId) {
      titolo = `Da quando vale «${nomeIva(!!richiesta.valore)}»?`
      spiega = `Stai passando il listino «${nomeListino}» da ${nomeIva(stato.listino)} a ${nomeIva(!!richiesta.valore)}. Vale per tutti i contratti del listino, tranne quelli impostati a parte.`
    } else if (richiesta.valore == null) {
      titolo = `Da quando ${richiesta.nomeCorriere} torna come il listino?`
      spiega = `${richiesta.nomeCorriere} passa da ${nomeIva(vale(richiesta.corriereId))} a «come il listino» (${nomeIva(stato.listino)}).`
    } else {
      titolo = `Da quando vale «${nomeIva(richiesta.valore)}» su ${richiesta.nomeCorriere}?`
      spiega = `Solo ${richiesta.nomeCorriere} passa da ${nomeIva(vale(richiesta.corriereId))} a ${nomeIva(richiesta.valore)}: gli altri contratti seguono il listino.`
    }
  }

  const opzione = (on: boolean) => ({
    display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px 14px', borderRadius: '9px', cursor: 'pointer',
    border: on ? '1.5px solid #f97316' : '1px solid #e5e7eb', background: on ? '#fff7ed' : '#fff',
  } as const)

  const modale = richiesta ? (
    <div onClick={() => { if (!salvo) setRichiesta(null) }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="iva-dialogo-titolo" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: '560px', background: '#fff', borderRadius: '12px', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '16px', boxSizing: 'border-box', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div>
          <h2 id="iva-dialogo-titolo" style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: '#1a1a1a' }}>{titolo}</h2>
          <p style={{ fontSize: '13px', color: '#4b5563', margin: '6px 0 0', lineHeight: 1.45 }}>{spiega}</p>
          {elencoAcquirenti && <p style={{ fontSize: '13px', color: '#4b5563', margin: '6px 0 0', lineHeight: 1.45 }}>{usa}: <strong style={{ color: '#1a1a1a' }}>{elencoAcquirenti}</strong>.</p>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label style={opzione(da === 'mese')}>
            <input type="radio" name="iva-da-quando" autoFocus checked={da === 'mese'} onChange={() => setDa('mese')} style={{ margin: '3px 0 0', width: '18px', height: '18px', accentColor: '#c2410c', flexShrink: 0 }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>Da questo mese (dal {primo})</span>
              <span style={{ fontSize: '12.5px', color: '#4b5563', lineHeight: 1.45 }}>Il report di {mese} esce tutto con la scelta nuova, anche le spedizioni già fatte. I mesi prima non cambiano.</span>
            </span>
          </label>
          <label style={opzione(da === 'oggi')}>
            <input type="radio" name="iva-da-quando" checked={da === 'oggi'} onChange={() => setDa('oggi')} style={{ margin: '3px 0 0', width: '18px', height: '18px', accentColor: '#c2410c', flexShrink: 0 }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>Da oggi ({oggi})</span>
              <span style={{ fontSize: '12.5px', color: '#4b5563', lineHeight: 1.45 }}>Le spedizioni fino a ieri restano come prima: il report di {mese} esce misto.</span>
            </span>
          </label>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px' }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}><path d="M20 6 9 17l-5-5" /></svg>
          <span style={{ fontSize: '12.5px', color: '#14532d', lineHeight: 1.45 }}>Il credito non cambia: nessun movimento viene toccato. Cambia solo come report e proforma dividono imponibile e IVA.</span>
        </div>
        {errore && <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '9px 12px', fontSize: '13px', color: '#b91c1c' }}>{errore}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setRichiesta(null)} disabled={salvo}
            style={{ minHeight: '42px', padding: '0 18px', background: '#f3f4f6', border: '1px solid #d1d5db', color: '#1a1a1a', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Annulla</button>
          <button type="button" onClick={conferma} disabled={salvo}
            style={{ minHeight: '42px', padding: '0 20px', background: '#c2410c', border: 'none', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: salvo ? 'wait' : 'pointer', opacity: salvo ? 0.7 : 1 }}>{salvo ? 'Salvo…' : 'Conferma e salva'}</button>
        </div>
      </div>
    </div>
  ) : null

  return { stato, vale, aParte, chiedi, modale, fatto, acquirenti: elencoAcquirenti, usa }
}

type Iva = ReturnType<typeof useIvaListino>

// Il riquadro in alto: come e' venduto tutto il listino, con l'esempio dei 4,00 €.
export function RiquadroIva({ iva }: { iva: Iva }) {
  const incl = iva.stato.listino
  const seg = (on: boolean) => ({
    minHeight: '40px', padding: '0 18px', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: on ? 'default' : 'pointer',
    background: on ? '#fff' : 'transparent', color: on ? '#1a1a1a' : '#4b5563', fontWeight: on ? 700 : 500,
    boxShadow: on ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
  } as const)
  const box = { flex: '1 1 200px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px' } as const
  const tit = { fontSize: '11px', fontWeight: 600, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.04em' } as const
  return (
    <section aria-labelledby="iva-listino-titolo" style={{ background: '#fff', borderRadius: '8px', border: '1px solid #d1d5db', padding: '14px 16px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <h2 id="iva-listino-titolo" style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: '#1a1a1a' }}>I prezzi di questo listino sono</h2>
          <p style={{ fontSize: '12px', color: '#4b5563', margin: '3px 0 0' }}>Vale per tutti i contratti, tranne quelli che imposti a parte qui sotto.</p>
        </div>
        <div role="group" aria-label="IVA del listino" style={{ display: 'inline-flex', background: '#eef0f3', borderRadius: '9px', padding: '3px', gap: '3px' }}>
          <button type="button" aria-pressed={!incl} onClick={() => { if (incl) iva.chiedi({ corriereId: null, valore: false }) }} style={seg(!incl)}>IVA esclusa</button>
          <button type="button" aria-pressed={incl} onClick={() => { if (!incl) iva.chiedi({ corriereId: null, valore: true }) }} style={seg(incl)}>IVA inclusa</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        <div style={box}>
          <div style={tit}>Esempio: in listino</div>
          <div style={{ fontSize: '17px', fontWeight: 700, marginTop: '2px', color: '#1a1a1a' }}>4,00 €</div>
          <div style={{ fontSize: '12px', color: '#4b5563' }}>{incl ? 'IVA già dentro il prezzo' : 'più IVA'}</div>
        </div>
        <div style={box}>
          <div style={tit}>Dal credito si scala</div>
          <div style={{ fontSize: '17px', fontWeight: 700, marginTop: '2px', color: '#1a1a1a' }}>4,00 €</div>
          <div style={{ fontSize: '12px', color: '#4b5563' }}>sempre il prezzo del listino</div>
        </div>
        <div style={box}>
          <div style={tit}>Nel report e nella proforma</div>
          <div style={{ fontSize: '17px', fontWeight: 700, marginTop: '2px', color: '#1a1a1a' }}>{incl ? '3,28 + 0,72 IVA' : '4,00 + 0,88 IVA'}</div>
          <div style={{ fontSize: '12px', color: '#4b5563' }}>{incl ? 'scorporata: l’IVA è già nei 4,00 €' : 'IVA da incassare a parte: 0,88 €'}</div>
        </div>
      </div>
      {iva.acquirenti && <p style={{ fontSize: '12px', color: '#4b5563', margin: 0 }}>{iva.usa}: <strong style={{ color: '#1a1a1a' }}>{iva.acquirenti}</strong>. La scelta vale per tutti quelli che lo usano.</p>}
      {iva.fatto && <p role="status" style={{ fontSize: '12.5px', color: '#15803d', margin: 0, fontWeight: 600 }}>{iva.fatto}</p>}
    </section>
  )
}

// L'etichetta sulla riga del contratto: come e' venduto, e se e' impostato a parte.
export function EtichettaIva({ iva, corriereId }: { iva: Iva; corriereId: string }) {
  const v = iva.vale(corriereId)
  return (
    <>
      {iva.aParte(corriereId) && <span style={{ fontSize: '11px', fontWeight: 700, color: '#c2410c', background: '#fff', border: '1px solid #f97316', borderRadius: '20px', padding: '2px 8px', whiteSpace: 'nowrap' }}>impostato a parte</span>}
      <span style={{ fontSize: '11px', fontWeight: 700, borderRadius: '20px', padding: '3px 9px', whiteSpace: 'nowrap', background: v ? '#e3f4f1' : '#eef0f3', color: v ? '#0f5f56' : '#374151' }}>{nomeIva(v)}</span>
    </>
  )
}

// La tendina dentro il contratto aperto, accanto al fattore peso/volume.
export function SceltaIvaCorriere({ iva, corriereId, nomeCorriere }: { iva: Iva; corriereId: string; nomeCorriere: string }) {
  const scelto = iva.stato.corrieri[corriereId]
  const valore = scelto == null ? '' : scelto ? 'inclusa' : 'esclusa'
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600, color: '#1a1a1a', flexWrap: 'wrap' }}>
      IVA su questo contratto
      <select value={valore}
        onChange={e => {
          const v = e.target.value
          const nuovo = v === 'inclusa' ? true : v === 'esclusa' ? false : null
          if (nuovo === (scelto ?? null)) return
          iva.chiedi({ corriereId, nomeCorriere, valore: nuovo })
        }}
        style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '13px', color: '#1a1a1a', background: '#fff', minWidth: '220px' }}>
        <option value="">Come il listino ({nomeIva(iva.stato.listino)})</option>
        <option value="inclusa">IVA inclusa</option>
        <option value="esclusa">IVA esclusa</option>
      </select>
    </label>
  )
}
