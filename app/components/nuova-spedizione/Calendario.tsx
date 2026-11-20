'use client'
import { useState } from 'react'
import { Icona } from '@/app/components/grafica/icone'
import { eFestivo, giornoDiRitiro, isoGiorno } from '@/lib/festivi'

const SETTIMANA = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do']

// IL GIORNO DEL RITIRO. Prima tre giorni fissi nel prototipo e un campo data nel modulo di oggi; Lorenzo (20/11): «non
// sarebbe meglio un calendario?». Il mese intero, avanti senza limite; spenti i giorni passati, il fine settimana e i
// festivi nazionali (lib/festivi), perché lì il corriere non ritira.
export default function Calendario({ valore, onChange }: { valore: string; onChange: (iso: string) => void }) {
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0)
  const scelto = valore ? new Date(valore + 'T00:00:00') : oggi
  // Si apre sul mese del giorno scelto, mai prima del mese corrente.
  const [spost, setSpost] = useState(() => Math.max(0, (scelto.getFullYear() - oggi.getFullYear()) * 12 + scelto.getMonth() - oggi.getMonth()))
  const vista = new Date(oggi.getFullYear(), oggi.getMonth() + spost, 1)
  const vuoti = (vista.getDay() + 6) % 7
  const ultimo = new Date(vista.getFullYear(), vista.getMonth() + 1, 0).getDate()
  const giorni = Array.from({ length: ultimo }, (_, i) => new Date(vista.getFullYear(), vista.getMonth(), i + 1))
  const titolo = vista.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
  return (
    <div className="ns-cal" role="group" aria-label="Giorno del ritiro">
      <div className="ns-cal__testa">
        <button type="button" className="ns-cal__freccia" onClick={() => setSpost(s => Math.max(0, s - 1))} disabled={spost === 0} aria-label="Mese prima">
          <Icona id="i-chevron" className="ns-cal__indietro" />
        </button>
        <span className="ns-cal__mese">{titolo}</span>
        <button type="button" className="ns-cal__freccia" onClick={() => setSpost(s => s + 1)} aria-label="Mese dopo">
          <Icona id="i-chevron" />
        </button>
      </div>
      <div className="ns-cal__griglia">
        {SETTIMANA.map(g => <span key={g} className="ns-cal__sett" aria-hidden="true">{g}</span>)}
        {Array.from({ length: vuoti }, (_, i) => <span key={'v' + i} aria-hidden="true" />)}
        {giorni.map(d => {
          const iso = isoGiorno(d)
          const festa = eFestivo(d)
          const spento = d < oggi || !giornoDiRitiro(d)
          const motivo = festa ? ', festivo' : (d.getDay() === 0 || d.getDay() === 6) ? ', fine settimana' : d < oggi ? ', passato' : ''
          return (
            <button key={iso} type="button" disabled={spento} onClick={() => onChange(iso)}
              className={'ns-cal__g' + (iso === isoGiorno(oggi) ? ' ns-cal__g--oggi' : '') + (iso === valore ? ' ns-cal__g--su' : '') + (festa ? ' ns-cal__g--festa' : '')}
              aria-pressed={iso === valore} aria-label={d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) + motivo}>
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
