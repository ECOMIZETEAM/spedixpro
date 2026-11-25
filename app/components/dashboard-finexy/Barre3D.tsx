'use client'

// LE COLONNE IN RILIEVO dei grafici della Dashboard nuova (Lorenzo 25/11: «le colonne almeno un 3d mettilo»).
// Ogni colonna e' un parallelepipedo visto un po' dall'alto e da destra: la faccia davanti con la luce da sinistra,
// il fianco in ombra e la cima piu' chiara. Le facce sono poligoni SVG, cosi' le scritte dell'asse restano nitide.

export type Tinta = 'nero' | 'arancio' | 'righe'

// La profondita' della colonna, proporzionata alla sua larghezza.
export const profondita = (larga: number) => Math.max(4, Math.min(larga * 0.3, 11))

// I colori e le sfumature, una volta per grafico (`id` distingue i grafici nella stessa pagina).
export function DefsBarre({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-nero`} x1="0" x2="1" y1="0" y2="0">
        <stop className="fx-s-nero-a" offset="0" stopColor="#3A3A39" /><stop className="fx-s-nero-b" offset="1" stopColor="#141414" />
      </linearGradient>
      <linearGradient id={`${id}-arancio`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#FF8A5C" /><stop offset="1" stopColor="#E54E1E" />
      </linearGradient>
      <pattern id={`${id}-righe`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" fill="#F48159" /><rect width="2.6" height="5" fill="#E54E1E" />
      </pattern>
      <filter id={`${id}-ombra`} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
    </defs>
  )
}

const FIANCO: Record<Tinta, string> = { nero: '#090909', arancio: '#B23A12', righe: '#B8441C' }
const CIMA: Record<Tinta, string> = { nero: '#555553', arancio: '#FFB08E', righe: '#FF9F78' }

// Una colonna (o un pezzo di colonna impilata): `cima` false quando sopra ne poggia un'altra.
export function Barra3D({ id, x, y, larga, alta, tinta, cima = true, ombra = true }: {
  id: string, x: number, y: number, larga: number, alta: number, tinta: Tinta, cima?: boolean, ombra?: boolean,
}) {
  if (alta <= 0) return null
  const d = profondita(larga), dy = d * 0.62
  const davanti = tinta === 'righe' ? `url(#${id}-righe)` : `url(#${id}-${tinta})`
  return (
    <g>
      {ombra && <ellipse cx={x + larga / 2 + d / 2} cy={y + alta + 1} rx={larga * 0.62} ry={3.2} fill="rgba(0,0,0,.18)" filter={`url(#${id}-ombra)`} />}
      <polygon className={`fx-fianco-${tinta}`} points={`${x + larga},${y} ${x + larga + d},${y - dy} ${x + larga + d},${y + alta - dy} ${x + larga},${y + alta}`} fill={FIANCO[tinta]} />
      <rect x={x} y={y} width={larga} height={alta} fill={davanti} />
      {cima && <polygon className={`fx-cima-${tinta}`} points={`${x},${y} ${x + d},${y - dy} ${x + larga + d},${y - dy} ${x + larga},${y}`} fill={CIMA[tinta]} />}
    </g>
  )
}
