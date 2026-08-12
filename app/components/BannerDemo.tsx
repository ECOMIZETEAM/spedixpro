'use client'
import { useEffect, useState } from 'react'

// Banner sempre in cima al gestionale quando l'account è una DEMO: ricorda che è una prova e quanto
// manca alla scadenza. Serve a non far confondere il potenziale cliente — qui è tutto simulato.
export default function BannerDemo({ scadenza }: { scadenza: string }) {
  const [ora, setOra] = useState<number>(0)
  useEffect(() => {
    setOra(Date.now())
    const t = setInterval(() => setOra(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const fine = new Date(scadenza).getTime()
  const restaMs = ora ? Math.max(0, fine - ora) : NaN
  let quanto = 'oggi'
  if (!isNaN(restaMs)) {
    const h = Math.floor(restaMs / 3_600_000)
    if (h >= 48) quanto = `tra ${Math.floor(h / 24)} giorni`
    else if (h >= 24) quanto = 'tra 1 giorno'
    else if (h >= 2) quanto = `tra ${h} ore`
    else if (h >= 1) quanto = 'tra 1 ora'
    else quanto = 'a breve'
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '14px',
      background: 'linear-gradient(100deg,#111827,#1f2937)', border: '1px solid #374151',
      borderRadius: '10px', padding: '13px 18px', flexWrap: 'wrap', color: '#fff', marginBottom: '4px',
    }}>
      <span style={{ background: '#f97316', color: '#fff', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>Demo</span>
      <div style={{ flex: 1, minWidth: '220px' }}>
        <div style={{ fontSize: '14.5px', fontWeight: 700, lineHeight: 1.3 }}>
          Stai provando MoovExpress — la prova scade <strong style={{ color: '#fdba74' }}>{quanto}</strong>
        </div>
        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
          Puoi provare tutto liberamente: spedizioni, clienti, prezzi, report. Nulla viene spedito o addebitato davvero.
        </div>
      </div>
    </div>
  )
}
