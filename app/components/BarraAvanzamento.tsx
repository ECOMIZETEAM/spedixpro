'use client'

// LA BARRA CHE DICE A CHE PUNTO SIAMO.
//
// Su un lavoro lungo — centosei spedizioni da riprezzare, un file da importare, un giro di
// etichette — la schermata restava ferma e chi guardava non sapeva se stesse lavorando o si fosse
// piantata. Dopo dieci secondi si ricarica la pagina, e a volte si rifà il lavoro due volte.
//
// IL TEMPO STIMATO E' CALCOLATO, NON INVENTATO. Si misura quanto ci ha messo davvero a fare quello
// che ha gia' fatto e si proietta sul resto: se rallenta, il tempo si allunga da solo. Una barra
// che promette "5 secondi" e ne impiega quaranta e' peggio di nessuna barra — la seconda volta
// nessuno le crede piu'.
//
// Colori del prodotto: arancio su nero, niente blu.

function tempoUmano(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return ''
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `circa ${s} second${s === 1 ? 'o' : 'i'}`
  const m = Math.floor(s / 60), r = s % 60
  if (m < 60) return `circa ${m} minut${m === 1 ? 'o' : 'i'}${r > 10 ? ` e ${r} secondi` : ''}`
  return `oltre un'ora`
}

export default function BarraAvanzamento({
  fatti, totale, iniziatoIl, etichetta, sottotitolo,
}: {
  fatti: number
  totale: number
  /** Date.now() di quando e' partito: serve a stimare il tempo che resta sul ritmo VERO. */
  iniziatoIl?: number | null
  etichetta?: string
  sottotitolo?: string
}) {
  const tot = Math.max(1, totale)
  const pct = Math.min(100, Math.round((fatti / tot) * 100))
  const finito = fatti >= totale

  let stima = ''
  if (!finito && iniziatoIl && fatti > 0) {
    const passato = Date.now() - iniziatoIl
    stima = tempoUmano((passato / fatti) * (totale - fatti))
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>
          {etichetta || 'Elaborazione in corso'}
        </div>
        <div style={{ fontSize: '13px', color: '#1a1a1a', fontVariantNumeric: 'tabular-nums' }}>
          <strong>{Math.min(fatti, totale)}</strong> di {totale}
          <span style={{ color: '#8a8a8a' }}> · {pct}%</span>
        </div>
      </div>

      <div style={{ height: '10px', background: '#f0f0f0', borderRadius: '5px', marginTop: '10px', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '5px',
          background: finito ? '#15803d' : 'linear-gradient(90deg,#f97316,#fb923c)',
          transition: 'width .35s ease',
        }} />
      </div>

      <div style={{ fontSize: '12px', color: '#8a8a8a', marginTop: '8px', minHeight: '16px' }}>
        {finito ? 'Fatto.' : (stima ? `Manca ${stima}.` : 'Sto cominciando…')}
        {sottotitolo && <span style={{ marginLeft: stima || finito ? '6px' : 0 }}>{sottotitolo}</span>}
      </div>
    </div>
  )
}
