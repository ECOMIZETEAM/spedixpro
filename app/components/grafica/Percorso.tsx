'use client'
// Il percorso sotto lo stato, negli elenchi spedizioni (master e cliente) con la grafica nuova (18/11, ripreso dalla v6 del 20/10): da dove parte a dove arriva e a
// che punto è, in cinque tappe. Le annullate e gli annulli non hanno percorso: per loro parla la pillola.
const TAPPE: Record<string, number> = { in_lavorazione: 0, spedita: 1, in_transito: 2, in_consegna: 3, consegnata: 4, in_giacenza: 3, non_consegnato: 3, reso_mittente: 4 }
export default function Percorso({ s }: { s: any }) {
  const k = TAPPE[s.stato]
  if (k == null) return null
  const tono = s.stato === 'consegnata' ? 'bene' : (s.stato === 'in_giacenza' || s.stato === 'non_consegnato') ? 'problema' : s.stato === 'reso_mittente' ? 'reso' : 'via'
  // le sigle maiuscole: la provincia arriva come la si è scritta («rm» accanto a «TE» sembrava un errore)
  const sigla = (v: any) => String(v || '').trim().toUpperCase()
  const partenza = sigla(s.mitt_provincia)
  const arrivo = sigla(s.dest_paese && s.dest_paese !== 'IT' ? s.dest_paese : s.dest_provincia)
  return (
    <div className={'el-percorso el-percorso--' + tono} title={`${partenza || '—'} → ${arrivo || '—'}`}>
      <span>{partenza}</span>
      <i>{[0, 1, 2, 3, 4].map(i => <b key={i} className={i < k ? 'fatto' : i === k ? 'qui' : undefined} />)}</i>
      <span>{arrivo || ''}</span>
    </div>
  )
}
