'use client'

// SCHEDA RIPESATURE del popup tracking — UNA sola, usata dal portale master e da quello cliente.
// I due popup sono gia' due copie quasi identiche: una terza scheda scritta due volte sarebbe
// diventata la solita coppia che si allontana (e qui si mostrano MISURE, cioe' la base di un
// addebito: due schede che raccontano numeri diversi sono una contestazione che parte da noi).
//
// Cosa mostra: il DICHIARATO (quello che il cliente ha scritto creando la spedizione) e UNA sola
// misura del corriere. Il collo viene misurato piu' volte lungo il giro e le letture non
// coincidono: si sceglie la piu' alta (e' quella su cui il fornitore fattura) ma NON si dice che e'
// una scelta e non si elencano le altre — al cliente serve il numero che paga, non il dietro le
// quinte, e una lista di misure diverse e' solo un invito a discutere su quale valga.
// Si mostra SOLO a spedizione consegnata: prima le letture cambiano ancora.

type Misura = {
  peso?: number | null; lunghezza?: number | null; larghezza?: number | null; altezza?: number | null
  volume?: number | null; quando?: string | null; dove?: string | null
}
export type DatiRipesatura = {
  consegnata?: boolean
  multicollo?: boolean
  dichiarato?: { lunghezza?: number | null; larghezza?: number | null; altezza?: number | null; peso?: number | null; colli?: number | null }
  peso_volume?: number | null
  peso_fatturato?: number | null
  rilevata?: Misura | null
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
          <div style={{ ...eti, marginBottom: '6px', color: '#9a3412' }}>Rilevato dal corriere</div>
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
          {dati?.multicollo
            ? <>Spedizione multicollo: il corriere misura i colli singolarmente e non è possibile attribuire le misure ai singoli colli.</>
            : dati?.consegnata === false
              ? <>La misura del corriere compare a consegna avvenuta.</>
              : <>Nessuna misurazione del corriere disponibile per questa spedizione.</>}
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

    </div>
  )
}
