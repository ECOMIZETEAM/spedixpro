'use client'
import { useEffect, useState } from 'react'

// Banner d'ingresso: avvisa il master se ha listini CLIENTE con prezzi sotto il minimo del contratto
// (pavimento). Porta alla pagina "Listini da adeguare". Chiudibile: la chiusura si ricorda per la
// sessione, ma se restano listini sotto ricompare alla sessione dopo. Non si mostra se non ci sono
// listini sotto (o se l'endpoint nega: agente/cliente).
export default function BannerPavimento() {
  const [tot, setTot] = useState(0)
  const [listini, setListini] = useState(0)
  const [chiuso, setChiuso] = useState(true)
  useEffect(() => {
    fetch('/api/network/pavimento-da-adeguare').then(r => r.ok ? r.json() : null).then(j => {
      if (j && Number(j.totaleFasce) > 0) {
        setTot(Number(j.totaleFasce)); setListini(Number(j.totaleListini) || 0)
        let dismiss = false
        try { dismiss = sessionStorage.getItem('pavimento_banner_chiuso') === '1' } catch {}
        setChiuso(dismiss)
      }
    }).catch(() => {})
  }, [])
  if (!tot || chiuso) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '16px',
      background: 'linear-gradient(100deg,#fff7ed,#ffedd5)', border: '1px solid #fdba74',
      borderRadius: '10px', padding: '14px 20px', flexWrap: 'wrap',
    }}>
      <div style={{ width: '46px', height: '46px', background: '#fff', border: '1px solid #fdba74', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>⚠️</div>
      <div style={{ flex: 1, minWidth: '200px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: '#9a3412' }}>Listini da adeguare</div>
        <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1a1a', marginTop: '2px', lineHeight: 1.2 }}>
          Hai {tot.toLocaleString('it-IT')} {tot === 1 ? 'fascia' : 'fasce'} sotto il prezzo minimo del contratto su {listini} {listini === 1 ? 'listino' : 'listini'}
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
          Su quelle fasce/zone il cliente non vede il prezzo e non può spedire finché non le adegui. Puoi allinearle in un clic.
        </div>
      </div>
      <a href="/dashboard/listini/da-adeguare" style={{ background: '#f97316', color: '#fff', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', textDecoration: 'none' }}>
        Adegua ora →
      </a>
      <button onClick={() => { try { sessionStorage.setItem('pavimento_banner_chiuso', '1') } catch {}; setChiuso(true) }}
        aria-label="Chiudi" title="Chiudi per questa sessione"
        style={{ background: 'none', border: 'none', color: '#9a3412', fontSize: '20px', cursor: 'pointer', lineHeight: 1, padding: '2px 6px' }}>×</button>
    </div>
  )
}
