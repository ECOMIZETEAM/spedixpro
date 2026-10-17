'use client'
import { COLORI_RESI, testoSoglie, type LivelloResi } from '@/lib/resi-percentuale'

// I pezzi comuni della percentuale resi: l'etichetta colorata e la legenda delle soglie. Li usano la
// dashboard e la sezione Resi, del master e del cliente: stessi colori ovunque (lib/resi-percentuale).

export function BadgeResi({ pct, livello, grande = false }: { pct: number; livello: LivelloResi; grande?: boolean }) {
  const c = COLORI_RESI[livello]
  return (
    <span title={c.etichetta} style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
      background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: '999px',
      padding: grande ? '4px 12px' : '2px 9px', fontSize: grande ? '15px' : '12px', fontWeight: 800,
    }}>
      {String(pct).replace('.', ',')}%
      {livello === 'pochi' && <span style={{ fontWeight: 600, fontSize: grande ? '12px' : '10.5px' }}>pochi dati</span>}
    </span>
  )
}

export function LegendaResi() {
  const voci: LivelloResi[] = ['ok', 'giallo', 'arancione', 'rosso']
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', fontSize: '11.5px', color: '#6b7280' }}>
      {voci.map(l => (
        <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: COLORI_RESI[l].bg, border: `1.5px solid ${COLORI_RESI[l].bd}` }} />
          {l === 'ok' ? 'sotto 8%' : l === 'giallo' ? '8–10%' : l === 'arancione' ? 'oltre 10%' : 'oltre 20%'}
        </span>
      ))}
      <span title={testoSoglie()}>· colorato da 20 spedizioni in su</span>
    </div>
  )
}

// La percentuale di una RETE (un sotto-master, o tutta la propria rete): in grigio. Il colore e' una regola
// per cliente — una rete sana in media puo' avere dentro clienti rossi, e un verde sulla sua riga ingannerebbe.
export function PctRete({ pct, grande = false }: { pct: number; grande?: boolean }) {
  return (
    <span title="Percentuale della rete: i colori valgono per i singoli clienti" style={{
      display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', background: '#f3f4f6', border: '1px solid #e5e7eb',
      color: '#374151', borderRadius: '999px', padding: grande ? '4px 12px' : '2px 9px', fontSize: grande ? '15px' : '12px', fontWeight: 800,
    }}>
      {String(pct).replace('.', ',')}%
    </span>
  )
}
