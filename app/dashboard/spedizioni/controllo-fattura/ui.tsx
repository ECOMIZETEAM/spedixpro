'use client'
import type { ReactNode } from 'react'

// Colori, numeri e icone della pagina Controllo fattura corriere: in un posto solo, così le sezioni della
// pagina (fattura, altri gestionali) si leggono uguali.
export const C = {
  testo: '#101828', attenuato: '#667085', filo: '#eaecf0', fondoTenue: '#f9fafb',
  arancio: '#f97316', arancioScuro: '#c2410c', arancioTenue: '#fff7ed', arancioOrlo: '#fed7aa',
  rosso: '#d92d20', rossoTenue: '#fef3f2', rossoOrlo: '#fecdca',
  verde: '#067647', verdeTenue: '#ecfdf3', verdeOrlo: '#abefc6',
  ambra: '#b54708', ambraTenue: '#fffaeb', ambraOrlo: '#fedf89',
}
export const carta = { background: '#fff', border: `1px solid ${C.filo}`, borderRadius: '14px', boxShadow: '0 1px 2px rgba(16,24,40,.05)' }
export const cifre = { fontVariantNumeric: 'tabular-nums' as const }

export const euro = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
export const conSegno = (n: number) => (n > 0.005 ? '+' : n < -0.005 ? '−' : '') + euro(Math.abs(n))
export const kg = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' kg'
export const r2 = (n: number) => Math.round(n * 100) / 100
export const coloreImporto = (n: number) => n > 0.005 ? C.rosso : n < -0.005 ? C.verde : C.attenuato

// Icone a linea (griglia 24, tratto 1,7, estremi tondi), nel colore del testo che le contiene.
export const TRATTI: Record<string, string> = {
  fattura: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
  carica: 'M12 15V4 M7.5 8.5 12 4l4.5 4.5 M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15',
  bilancia: 'M12 4v16 M8 20h8 M5 8h14 M5 8l-3 6.5a3 3 0 0 0 6 0z M19 8l-3 6.5a3 3 0 0 0 6 0z',
  etichetta: 'M3 12.2V4a1 1 0 0 1 1-1h8.2a1 1 0 0 1 .7.3l7.8 7.8a1 1 0 0 1 0 1.4l-8.2 8.2a1 1 0 0 1-1.4 0l-7.8-7.8a1 1 0 0 1-.3-.7z M7.5 7.5h.01',
  cursori: 'M4 20v-6 M4 10V4 M12 20v-8 M12 8V4 M20 20v-4 M20 12V4 M2 14h4 M10 8h4 M18 16h4',
  annullata: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15 9l-6 6 M9 9l6 6',
  pacco: 'M21 8 12 3 3 8l9 5 9-5z M3 8v8l9 5 9-5V8 M12 13v8',
  cerca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  scarica: 'M12 4v11 M7.5 10.5 12 15l4.5-4.5 M4 19h16',
  freccia: 'M5 12h14 M13 6l6 6-6 6',
  euro: 'M17 6.5A6.5 6.5 0 1 0 17 17.5 M4 10h9 M4 14h9',
  sale: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  spunta: 'M20 6 9 17l-5-5',
  avviso: 'M12 9v4 M12 17h.01 M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  rientro: 'M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3',
}
export function Icona({ nome, size = 18, colore }: { nome: string; size?: number; colore?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colore || 'currentColor'} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      {TRATTI[nome].split(' M').map((d, i) => <path key={i} d={(i ? 'M' : '') + d} />)}
    </svg>
  )
}
export function Tessera({ nome, colore, fondo }: { nome: string; colore: string; fondo: string }) {
  return <span style={{ width: 36, height: 36, borderRadius: 10, background: fondo, color: colore, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icona nome={nome} size={19} /></span>
}
export function Pillola({ children, colore, fondo, orlo }: { children: ReactNode; colore: string; fondo: string; orlo: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: colore, background: fondo, border: `1px solid ${orlo}`, whiteSpace: 'nowrap' }}>{children}</span>
}
