import { testoIva, testoIvaGruppo, type RegimeIva } from '@/lib/iva-calcolo'

// "IVA escl.", "IVA incl." o "Esente IVA" accanto a un prezzo (lib/iva-calcolo.ts). Piccolo e grigio, in
// proporzione al prezzo che accompagna; non c'e' nessuna etichetta quando non si sa come e' venduto (il
// master non ha scelto) o quando l'IVA e' allo 0% e il listino non e' esente.
export default function IvaPrezzo({ regime, aliquota, gruppo, chiaro }: {
  regime?: RegimeIva | null
  aliquota?: number | null
  gruppo?: (RegimeIva | null | undefined)[]   // per un totale: l'etichetta solo se sono tutti uguali
  chiaro?: boolean                             // su fondo scuro o colorato
}) {
  const t = gruppo ? testoIvaGruppo(gruppo, aliquota) : testoIva(regime, aliquota)
  if (!t) return null
  return (
    <span style={{ fontSize: '0.62em', fontWeight: 600, color: chiaro ? 'rgba(255,255,255,0.85)' : '#6b7280', marginLeft: '4px', whiteSpace: 'nowrap', letterSpacing: 0 }}>
      {t}
    </span>
  )
}

// L'etichetta di un contratto in "Il mio listino": come sono scritti TUTTI i prezzi di quella griglia.
export function PrezziIva({ regime, aliquota }: { regime?: RegimeIva | null; aliquota?: number | null }) {
  if (!regime || !testoIva(regime, aliquota)) return null
  const t = regime === 'inclusa'
    ? { testo: 'Prezzi IVA inclusa', spiega: 'I prezzi di questo contratto comprendono già l’IVA', colori: { background: '#e3f4f1', color: '#0f5f56' } }
    : regime === 'esente'
      ? { testo: 'Prezzi esenti IVA', spiega: 'Ai prezzi di questo contratto non si aggiunge l’IVA', colori: { background: '#eef2ff', color: '#3730a3' } }
      : { testo: 'Prezzi IVA esclusa', spiega: `Ai prezzi di questo contratto si aggiunge l’IVA${aliquota ? ` (${aliquota}%)` : ''}`, colori: { background: '#eef0f3', color: '#374151' } }
  return (
    <span title={t.spiega} style={{ fontSize: '11px', fontWeight: 700, borderRadius: '20px', padding: '3px 9px', whiteSpace: 'nowrap', ...t.colori }}>
      {t.testo}
    </span>
  )
}

// La scritta piccola sotto il prezzo nella Nuova spedizione del cliente. C'era da prima della scelta IVA:
// "iva esclusa", grigio chiaro, per tutti. Finche' il master non sceglie resta esattamente quella
// (Lorenzo, 20/11/2026: "finche' non selezionano nulla rimane cosi' come era prima"); dopo dice la scelta.
export function ScrittaIva({ regime }: { regime?: RegimeIva | null }) {
  if (!regime) return <div style={{ fontSize: '10px', color: '#bbb', marginTop: '1px' }}>iva esclusa</div>
  return <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>{regime === 'inclusa' ? 'iva inclusa' : regime === 'esente' ? 'esente iva' : 'iva esclusa'}</div>
}
