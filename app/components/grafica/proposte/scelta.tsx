'use client'
// Il selettore delle quattro proposte di Plancia (27/10), in basso al centro: si vede solo con la grafica nuova, che
// oggi è solo in anteprima. Ogni proposta sta nella sua cartella (a, b, c, d) e non tocca le altre né la v11.
import PlanciaA from './a/PlanciaA'
import PlanciaB from './b/PlanciaB'
import PlanciaC from './c/PlanciaC'
import PlanciaD from './d/PlanciaD'
import './scelta.css'

export const PROPOSTE = [
  { k: 'a', nome: 'A', C: PlanciaA },
  { k: 'b', nome: 'B', C: PlanciaB },
  { k: 'c', nome: 'C', C: PlanciaC },
  { k: 'd', nome: 'D', C: PlanciaD },
]

export function SceltaProposta({ attuale }: { attuale: string }) {
  const vai = (k: string) => { window.location.href = `/api/grafica?v=nuova&plancia=${k}&torna=/dashboard` }
  return (
    <div className="px-scelta gx-vetro gx-pillola" role="group" aria-label="Proposte di Plancia">
      <span>Proposte</span>
      <button type="button" aria-pressed={!attuale} onClick={() => vai('attuale')}>Attuale</button>
      {PROPOSTE.map(p => <button key={p.k} type="button" aria-pressed={attuale === p.k} onClick={() => vai(p.k)}>{p.nome}</button>)}
    </div>
  )
}
