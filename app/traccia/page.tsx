'use client'
import { useEffect, useState } from 'react'
import { CardTracking, CartaCaricamento, CartaMessaggio, GuscioTracking, Icona, testiTracking, useLinguaTracking, type DatiTracking } from './CardTracking'

// PORTALE PUBBLICO "cerca spedizioni": il cliente digita il numero/LDV e vede lo stato. Nessun login.
// Complementa /traccia/[token] (link diretto da SMS/email). Espone solo stato + città (nessun dato
// personale — la protezione sta nell'API /api/pubblico/tracking). Supporta anche il link ?n=NUMERO.

export default function CercaSpedizione() {
  const lingua = useLinguaTracking()
  const t = testiTracking(lingua)
  const [numero, setNumero] = useState('')
  const [dati, setDati] = useState<DatiTracking | null>(null)
  const [stato, setStato] = useState<'idle' | 'carico' | 'ok' | 'nontrovato'>('idle')

  async function cerca(n: string) {
    const q = n.trim()
    if (!q) return
    setStato('carico'); setDati(null)
    try {
      const r = await fetch('/api/pubblico/tracking?n=' + encodeURIComponent(q))
      if (!r.ok) { setStato('nontrovato'); return }
      setDati(await r.json()); setStato('ok')
    } catch { setStato('nontrovato') }
  }

  // Link diretto ?n=NUMERO → ricerca automatica (come track.spedisci.online).
  useEffect(() => {
    try { const p = new URLSearchParams(window.location.search).get('n'); if (p) { setNumero(p); cerca(p) } } catch {}
  }, [])

  // La ricerca è della piattaforma: il marchio del master compare solo col risultato.
  return (
    <GuscioTracking brand={stato === 'ok' && dati ? dati.brand : null} lingua={lingua}>
      <div className="tk-card tk-cerca tk-unica" style={{ marginBottom: 18 }}>
        <h1>{t.cercaTitolo}</h1>
        <p>{t.cercaTesto}</p>
        <form onSubmit={(e) => { e.preventDefault(); cerca(numero) }}>
          <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder={t.cercaEsempio}
            autoCapitalize="characters" autoCorrect="off" spellCheck={false} aria-label={t.numero} />
          <button type="submit" className="tk-bottone" disabled={stato === 'carico' || !numero.trim()}>
            <Icona nome="cerca" size={17} />{stato === 'carico' ? t.cerco : t.cerca}
          </button>
        </form>
      </div>
      {stato === 'carico' && <CartaCaricamento />}
      {stato === 'nontrovato' && <CartaMessaggio icona="cerca" titolo={t.nonTrovataTitolo} testo={t.cercaNonTrovataTesto} />}
      {stato === 'ok' && dati && <CardTracking dati={dati} lingua={lingua} />}
    </GuscioTracking>
  )
}
