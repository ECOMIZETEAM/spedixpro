// Icone a linea del calendario: tratto 1,7, estremi tondi, griglia 24, nel colore del testo (come la cornice nuova).
const P: Record<string, string> = {
  sinistra: 'M15 6l-6 6 6 6',
  destra: 'M9 6l6 6-6 6',
  piu: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  orologio: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  calendario: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  luogo: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  note: 'M5 5h14M5 10h14M5 15h9',
  campanella: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2.2 2.2 0 0 0 4 0',
  furgone: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  pacco: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9',
  persona: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  spunta: 'M5 12.5l4.5 4.5L19 7.5',
  cestino: 'M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13',
  matita: 'M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5',
  esterno: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  collegamento: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  riunione: 'M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16.5 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 19a5.5 5.5 0 0 1 11 0M14 14.2a4.5 4.5 0 0 1 7 3.8',
  bandiera: 'M5 21V4M5 4h11l-2 4 2 4H5',
}

export default function Ic({ n, titolo }: { n: keyof typeof P | string; titolo?: string }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden={titolo ? undefined : true} role={titolo ? 'img' : undefined}>
      {titolo && <title>{titolo}</title>}
      <path d={P[n] || ''} />
    </svg>
  )
}
