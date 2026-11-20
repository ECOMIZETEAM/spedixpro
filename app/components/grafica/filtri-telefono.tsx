'use client'
// I filtri dell'Elenco spedizioni sul telefono (Lorenzo 20/11, «sistema anche i filtri»): 16 campi uno sotto l'altro e
// la prima spedizione a 1.481 px dall'inizio della pagina. Nella grafica nuova, sul telefono, il riquadro si chiude
// dietro «Filtri» (col numero di quelli attivi) e si apre su due colonne. Sul computer resta aperto com'era: il titolo
// non si clicca e non entra nel giro del tasto Tab. Chiuso o aperto lo decide il foglio di stile (elenco.css) dal primo
// disegno, così il telefono non vede i filtri aprirsi e richiudersi mentre la pagina parte.
// Con la grafica di oggi la pagina non usa niente di qui: il titolo resta «▼ Filtri».
import { useEffect, useState } from 'react'
import BadgeFiltri from '@/app/components/BadgeFiltri'
import { Icona } from './icone'

const TELEFONO = '(max-width: 720px)'

export function useFiltriTelefono(nuova: boolean) {
  const [aperti, setAperti] = useState(false)
  const [telefono, setTelefono] = useState(false)
  useEffect(() => {
    const m = window.matchMedia(TELEFONO)
    const segui = () => setTelefono(m.matches)
    segui()
    m.addEventListener('change', segui)
    return () => m.removeEventListener('change', segui)
  }, [])
  return {
    // da stendere sul riquadro dei filtri: senza grafica nuova non aggiunge niente
    scheda: nuova ? { 'data-aperti': aperti ? '1' : '0' } : {},
    titolo: (attivi: number) => (
      <button type="button" className="el-filtri__apri" aria-expanded={telefono ? aperti : true} tabIndex={telefono ? 0 : -1}
        onClick={() => { if (telefono) setAperti(a => !a) }}>
        <Icona id="i-filtro" />Filtri<BadgeFiltri n={attivi} />
        <span className="el-filtri__freccia" aria-hidden="true"><Icona id="i-chevron" /></span>
      </button>
    ),
  }
}
