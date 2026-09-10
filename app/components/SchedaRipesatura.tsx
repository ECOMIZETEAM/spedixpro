'use client'

// SCHEDA RIPESATURE del popup tracking — UNA sola, usata dal portale master e da quello cliente.
// I due popup sono gia' due copie quasi identiche: una terza scheda scritta due volte sarebbe
// diventata la solita coppia che si allontana (e qui si mostrano MISURE, cioe' la base di un
// addebito: due schede che raccontano numeri diversi sono una contestazione che parte da noi).
//
// Cosa mostra: il DICHIARATO (quello che il cliente ha scritto creando la spedizione) e la
// RILEVATA piu' alta fra le misure che il corriere fa in impianto. Il collo viene misurato piu'
// volte lungo il giro e le letture non coincidono: il fornitore fattura sulla piu' alta, quindi
// e' quella che si mostra — le altre restano sotto, in chiaro, per chi vuole verificare.

type Misura = {
  peso?: number | null; lunghezza?: number | null; larghezza?: number | null; altezza?: number | null
  volume?: number | null; quando?: string | null; dove?: string | null
}
export type DatiRipesatura = {
  dichiarato?: { lunghezza?: number | null; larghezza?: number | null; altezza?: number | null; peso?: number | null; colli?: number | null }
  peso_volume?: number | null
  peso_fatturato?: number | null
  rilevata?: Misura | null
  altre?: Misura[]
  controllata_il?: string | null
}

const nf = (v: any, dec = 2) =>
  (v === null || v === undefined || v === '') ? null : Number(v).toLocaleString('it-IT', { maximumFractionDigits: dec })

const misure = (m?: Misura | DatiRipesatura['dichiarato'] | null) => {
  if (!m) return null
  const [l, w, h] = [nf(m.lunghezza), nf(m.larghezza), nf(m.altezza)]
  return (l && w && h) ? `${l} × ${w} × ${h} cm` : null
}

const box: React.CSSProperties = { background: '#f9fafb', borderRadius: '8px', border: '1px solid #d1d5db', padding: '14px' }
const eti: React.CSSProperties = { fontSize: '12px', color: '#6b7280', marginBottom: '2px' }
const val: React.CSSProperties = { fontSize: '14px', color: '#1a1a1a', fontWeight: 600 }

export default function SchedaRipesatura({ dati }: { dati?: DatiRipesatura | null }) {
  const ril = dati?.rilevata
  const altre = dati?.altre || []
  const dic = dati?.dichiarato

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={box}>
        <div style={{ ...eti, marginBottom: '6px' }}>Dichiarato alla creazione</div>
        <div style={val}>
          {misure(dic) || '—'}
          {nf(dic?.peso) && <span style={{ fontWeight: 400 }}> · {nf(dic?.peso)} kg</span>}
          {(dic?.colli || 1) > 1 && <span style={{ fontWeight: 400 }}> · {dic?.colli} colli</span>}
        </div>
      </div>

      {ril ? (
        <div style={{ ...box, background: '#fff7ed', borderColor: '#fdba74' }}>
          <div style={{ ...eti, marginBottom: '6px', color: '#9a3412' }}>
            Rilevato dal corriere{altre.length > 0 && ` — la più alta di ${altre.length + 1} misurazioni`}
          </div>
          <div style={{ ...val, fontSize: '15px' }}>
            {misure(ril) || '—'}
            {nf(ril.peso) && <span style={{ fontWeight: 400 }}> · {nf(ril.peso)} kg</span>}
          </div>
          {(ril.dove || ril.quando) && (
            <div style={{ fontSize: '12px', color: '#1a1a1a', marginTop: '6px' }}>
              {ril.dove}{ril.dove && ril.quando ? ' · ' : ''}{ril.quando}
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...box, textAlign: 'center', color: '#6b7280', fontSize: '13px', padding: '24px' }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>⚖️</div>
          Nessuna misurazione del corriere disponibile.
          <div style={{ fontSize: '12px', marginTop: '6px' }}>
            Il corriere misura il collo in impianto: il dato compare a spedizione consegnata.
          </div>
        </div>
      )}

      {(nf(dati?.peso_volume) || nf(dati?.peso_fatturato)) && (
        <div style={{ ...box, display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {nf(dati?.peso_volume) && (
            <div><div style={eti}>Peso volumetrico</div><div style={val}>{nf(dati?.peso_volume)} kg</div></div>
          )}
          {nf(dati?.peso_fatturato) && (
            <div><div style={eti}>Peso fatturato</div><div style={val}>{nf(dati?.peso_fatturato)} kg</div></div>
          )}
        </div>
      )}

      {altre.length > 0 && (
        <div style={box}>
          <div style={{ ...eti, marginBottom: '8px' }}>Altre misurazioni registrate</div>
          {altre.map((m, i) => (
            <div key={i} style={{ fontSize: '12px', color: '#1a1a1a', padding: '4px 0', borderTop: i ? '1px solid #e5e7eb' : 'none' }}>
              {misure(m) || '—'}{nf(m.peso) ? ` · ${nf(m.peso)} kg` : ''}
              {(m.dove || m.quando) && <span style={{ color: '#6b7280' }}> — {m.dove}{m.dove && m.quando ? ', ' : ''}{m.quando}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
