'use client'

// Il contatore accanto alla scritta "Filtri": quanti filtri sto applicando adesso.
// Zero filtri = nessun pallino (niente rumore quando la lista e' quella di partenza).
export default function BadgeFiltri({ n }: { n: number }) {
  if (!n) return null
  return (
    <span
      title={n === 1 ? '1 filtro attivo' : `${n} filtri attivi`}
      style={{
        marginLeft: '7px', padding: '1px 8px', borderRadius: '10px', background: '#f97316',
        color: '#fff', fontSize: '11px', fontWeight: 700, verticalAlign: 'middle', whiteSpace: 'nowrap',
      }}>
      {n} {n === 1 ? 'filtro' : 'filtri'}
    </span>
  )
}
