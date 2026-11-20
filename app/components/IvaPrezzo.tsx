import { testoIva, testoIvaGruppo } from '@/lib/iva-calcolo'

// "IVA escl." o "IVA incl." accanto a un prezzo (lib/iva-calcolo.ts). Piccolo e grigio, in proporzione al
// prezzo che accompagna; non c'e' nessuna etichetta quando non si sa come e' venduto o l'IVA e' allo 0%.
export default function IvaPrezzo({ inclusa, aliquota, gruppo, chiaro }: {
  inclusa?: boolean | null
  aliquota?: number | null
  gruppo?: (boolean | null | undefined)[]   // per un totale: l'etichetta solo se sono tutti uguali
  chiaro?: boolean                           // su fondo scuro o colorato
}) {
  const t = gruppo ? testoIvaGruppo(gruppo, aliquota) : testoIva(inclusa, aliquota)
  if (!t) return null
  return (
    <span style={{ fontSize: '0.62em', fontWeight: 600, color: chiaro ? 'rgba(255,255,255,0.85)' : '#6b7280', marginLeft: '4px', whiteSpace: 'nowrap', letterSpacing: 0 }}>
      {t}
    </span>
  )
}

// L'etichetta di un contratto in "Il mio listino": come sono scritti TUTTI i prezzi di quella griglia.
export function PrezziIva({ inclusa, aliquota }: { inclusa?: boolean | null; aliquota?: number | null }) {
  if (!testoIva(inclusa, aliquota)) return null
  return (
    <span title={inclusa ? 'I prezzi di questo contratto comprendono già l’IVA' : `Ai prezzi di questo contratto si aggiunge l’IVA${aliquota ? ` (${aliquota}%)` : ''}`}
      style={{ fontSize: '11px', fontWeight: 700, borderRadius: '20px', padding: '3px 9px', whiteSpace: 'nowrap', background: inclusa ? '#e3f4f1' : '#eef0f3', color: inclusa ? '#0f5f56' : '#374151' }}>
      {inclusa ? 'Prezzi IVA inclusa' : 'Prezzi IVA esclusa'}
    </span>
  )
}
