'use client'
// Live View (anteprima 18/11, Lorenzo: «inseriscila sull'anteprima così la faccio vedere»). È la pagina di prova di
// esempi-v6/live, dentro la cornice nuova: i numeri sono DI PROVA e la pagina lo dice (cartellino «dati di prova»).
// Il nome in testa è quello di chi guarda, e il giorno/notte segue la cornice: all'apertura dall'indirizzo, dopo con un
// messaggio, così la pagina non si ricarica e la mappa non riparte da capo.
import { useContext, useEffect, useRef } from 'react'
import { GraficaNuova } from '@/app/components/grafica/contesto'

export default function LiveView() {
  const g = useContext(GraficaNuova)
  const tema = g.tema === 'notte' || g.luce === 'notte' ? 'notte' : 'giorno'
  const nome = (g.chi || '').split('|')[0] || 'MoovExpress'
  const iframe = useRef<HTMLIFrameElement>(null)
  const temaIniziale = useRef(tema)
  useEffect(() => { iframe.current?.contentWindow?.postMessage({ tema }, window.location.origin) }, [tema])
  return (
    <iframe ref={iframe} title="Live View"
      src={`/grafica/live/live-view.html?incornice=1&tema=${temaIniziale.current}&nome=${encodeURIComponent(nome)}`}
      style={{ display: 'block', width: '100%', height: 'calc(100vh - 110px)', border: 0, borderRadius: '24px', background: 'transparent' }} />
  )
}
