'use client'
// Il percorso sotto lo stato, negli elenchi spedizioni (master e cliente) con la grafica nuova (18/11, ripreso dalla v6 del 20/10): da dove parte a dove arriva e a
// che punto è, in cinque tappe. Le annullate e gli annulli non hanno percorso: per loro parla la pillola.
const TAPPE: Record<string, number> = { in_lavorazione: 0, spedita: 1, in_transito: 2, in_consegna: 3, consegnata: 4, in_giacenza: 3, non_consegnato: 3, reso_mittente: 4 }
export default function Percorso({ s }: { s: any }) {
  const k = TAPPE[s.stato]
  if (k == null) return null
  const tono = s.stato === 'consegnata' ? 'bene' : (s.stato === 'in_giacenza' || s.stato === 'non_consegnato') ? 'problema' : s.stato === 'reso_mittente' ? 'reso' : 'via'
  const arrivo = s.dest_paese && s.dest_paese !== 'IT' ? s.dest_paese : s.dest_provincia
  return (
    <div className={'el-percorso el-percorso--' + tono} title={`${s.mitt_provincia || '—'} → ${arrivo || '—'}`}>
      <span>{s.mitt_provincia || ''}</span>
      <i>{[0, 1, 2, 3, 4].map(i => <b key={i} className={i < k ? 'fatto' : i === k ? 'qui' : undefined} />)}</i>
      <span>{arrivo || ''}</span>
    </div>
  )
}
