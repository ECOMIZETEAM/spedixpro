// Mascotte MOOVY: robottino con la testa a forma di pacco e il mantello.
// Disegnata in SVG e non come immagine: resta nitida a ogni dimensione, non fa richieste di
// rete e usa solo i colori del marchio (arancio, nero, bianco).
//
// Scelte di disegno, per non rifarle a caso in futuro:
// - il mantello sta DIETRO ed è simmetrico, con l'orlo ondulato: due forme laterali qualsiasi
//   si leggevano come gambe scure, non come mantello;
// - l'antenna ha la pallina PIENA: con il contorno chiaro su fondo arancio sembrava un anello;
// - collo scuro tra testa e corpo, altrimenti la sagoma diventa un blocco unico bianco.
export default function MoovyIcon({ size = 34, su = 'arancio' }: { size?: number; su?: 'arancio' | 'chiaro' }) {
  const NERO = '#1a1a1a'
  const ARANCIO = '#f97316'
  const chiaro = '#ffffff'
  const cartone = '#ffd9b3'                       // tinta calda del cartone
  const scuro = su === 'arancio' ? NERO : NERO    // mantello e visiera: sempre neri, reggono su entrambi

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ display: 'block' }}>
      {/* Rientro: dentro un pulsante TONDO gli angoli vengono tagliati, e il mantello finiva
          fuori dal cerchio. Tutto il disegno sta dentro un raggio sicuro. */}
      <g transform="translate(32 33.5) scale(0.8) translate(-32 -32)">
      {/* MANTELLO — dietro tutto, orlo ondulato: si legge come mantello anche a 24px */}
      <path
        d="M20 26 C10 30 5 42 5 54 C9 57 12 54 16 56 C20 58 23 55 27 56 L27 30 Z
           M44 26 C54 30 59 42 59 54 C55 57 52 54 48 56 C44 58 41 55 37 56 L37 30 Z"
        fill={scuro}
      />

      {/* ANTENNA (pallina piena) */}
      <rect x="30.7" y="3.5" width="2.6" height="8" rx="1.3" fill={chiaro} />
      <circle cx="32" cy="3" r="3" fill={chiaro} />
      <circle cx="32" cy="3" r="1.3" fill={ARANCIO} />

      {/* BRACCIA */}
      <rect x="10.5" y="37" width="7" height="14" rx="3.5" fill={chiaro} />
      <rect x="46.5" y="37" width="7" height="14" rx="3.5" fill={chiaro} />

      {/* COLLO + CORPO */}
      <rect x="27" y="38" width="10" height="5" rx="2" fill={scuro} />
      <rect x="19" y="41" width="26" height="17" rx="6" fill={chiaro} />

      {/* TESTA-PACCO: coperchio, scatola e nastro adesivo arancione */}
      <rect x="12" y="10.5" width="40" height="7.5" rx="2.5" fill={cartone} />
      <rect x="12" y="16" width="40" height="24" rx="4" fill={chiaro} />
      <rect x="29.3" y="10.5" width="5.4" height="7.5" rx="1" fill={ARANCIO} />
      <rect x="12" y="16" width="40" height="2.8" fill={ARANCIO} opacity="0.9" />

      {/* VISIERA e OCCHI */}
      <rect x="16.5" y="21.5" width="31" height="13.5" rx="6.75" fill={scuro} />
      <circle cx="25" cy="28.2" r="3.3" fill={chiaro} />
      <circle cx="39" cy="28.2" r="3.3" fill={chiaro} />
      <circle cx="25.9" cy="29" r="1.25" fill={scuro} />
      <circle cx="39.9" cy="29" r="1.25" fill={scuro} />
      </g>
    </svg>
  )
}
