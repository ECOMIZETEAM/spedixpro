import type { Metadata, Viewport } from 'next'

// La schermata dell'autista vive sul telefono, in mano, spesso al sole e con i guanti: niente
// barra laterale, niente menu, niente zoom involontario mentre si tocca un tasto.
export const metadata: Metadata = {
  title: 'Consegne',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1a1a1a',
}

export default function AutistaLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100dvh', background: '#f4f4f5' }}>{children}</div>
}
