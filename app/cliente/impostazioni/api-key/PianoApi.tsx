'use client'
import { useState, useEffect } from 'react'

const ACCENT = '#f97316'

// IL PACCHETTO API, DAL LATO DI CHI LO PAGA.
//
// Una domanda sola: quante spedizioni ho fatto questo mese, e il pacchetto che ho basta?
// Tutto il resto — i prezzi, il confronto, il tasto per pagare — sta sotto quella risposta.

export default function PianoApi() {
  const [d, setD] = useState<any>(null)
  const [inCorso, setInCorso] = useState('')
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)

  async function carica() {
    const x = await fetch('/api/cliente/api-piano').then(r => r.json()).catch(() => null)
    setD(x)
  }
  useEffect(() => {
    carica()
    if (new URLSearchParams(window.location.search).get('pagato')) {
      setMsg({ t: 'ok', x: 'Pagamento registrato. Il pacchetto è attivo.' })
    }
  }, [])

  async function scegli(codice: string) {
    setInCorso(codice); setMsg(null)
    try {
      const r = await fetch('/api/cliente/api-piano', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ piano: codice }),
      })
      const x = await r.json()
      if (x?.url) { window.location.href = x.url; return }
      if (x?.cambiato) { setMsg({ t: 'ok', x: 'Pacchetto cambiato.' }); carica() }
      else setMsg({ t: 'err', x: x?.error || 'Non riesco ad aprire il pagamento' })
    } catch { setMsg({ t: 'err', x: 'Errore di rete' }) }
    setInCorso('')
  }

  if (!d) return <div style={{ padding: '30px', color: '#8a8a8a', fontSize: '13px' }}>Caricamento…</div>
  if (d.error) return <div style={{ padding: '30px', color: '#dc2626', fontSize: '13px' }}>{d.error}</div>
  if (!d.haChiavi) return null   // non usa le API: questa sezione non lo riguarda

  const s = d.stato || {}
  const usate = Number(s.usate || 0), limite = Number(s.limite || 0)
  const pieno = limite > 0 ? Math.min(100, Math.round((usate / limite) * 100)) : 0
  const oltre = !!s.oltre_limite
  const colore = oltre ? '#dc2626' : pieno >= 80 ? '#d97706' : '#16a34a'

  return (
    <div style={{ marginTop: '26px' }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Pacchetto API</div>
      <div style={{ fontSize: '13px', color: '#666', marginBottom: '14px', maxWidth: '640px', lineHeight: 1.6 }}>
        Fino a 50 spedizioni al mese le API sono gratuite. Sopra, serve un pacchetto.
      </div>

      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px',
          background: msg.t === 'ok' ? '#f0fdf4' : '#fef2f2', color: msg.t === 'ok' ? '#166534' : '#991b1b',
          border: `1px solid ${msg.t === 'ok' ? '#bbf7d0' : '#fecaca'}`,
        }}>{msg.x}</div>
      )}

      {/* Il consumo: la prima cosa da vedere */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '16px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <span style={{ fontSize: '26px', fontWeight: 800, color: colore }}>{usate}</span>
            <span style={{ fontSize: '14px', color: '#666' }}> di {limite.toLocaleString('it-IT')} spedizioni questo mese</span>
          </div>
          <div style={{ fontSize: '13px', color: '#666' }}>
            pacchetto <strong style={{ color: '#1a1a1a' }}>{s.nome || 'Free'}</strong>
            {Number(s.prezzo) > 0 ? ` · € ${Number(s.prezzo).toFixed(0)}/mese` : ' · gratis'}
          </div>
        </div>
        <div style={{ height: '8px', background: '#f0f0f0', borderRadius: '4px', marginTop: '10px', overflow: 'hidden' }}>
          <div style={{ width: `${pieno}%`, height: '100%', background: colore }} />
        </div>
        {oltre && (
          <div style={{ marginTop: '10px', fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>
            Pacchetto esaurito: le API sono ferme finché non passi a uno più grande. Il portale resta
            aperto e le spedizioni già create continuano il loro giro.
          </div>
        )}
        {s.scaduto_dal && !oltre && (
          <div style={{ marginTop: '10px', fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>
            L’ultimo pagamento non è andato a buon fine. Hai 3 giorni per sistemarlo, poi le API si fermano.
          </div>
        )}
      </div>

      {/* I pacchetti */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '10px' }}>
        {(d.piani || []).map((p: any) => {
          const attuale = p.codice === s.piano
          const basta = usate <= p.limite
          return (
            <div key={p.codice} style={{
              background: '#fff', border: attuale ? `2px solid ${ACCENT}` : '1px solid #e8e8e8',
              borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '4px',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#8a8a8a', textTransform: 'uppercase' }}>{p.nome}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#1a1a1a' }}>
                {Number(p.prezzo) > 0 ? <>€ {Number(p.prezzo).toFixed(0)}<span style={{ fontSize: '13px', fontWeight: 500, color: '#8a8a8a' }}> /mese</span></> : 'Gratis'}
              </div>
              <div style={{ fontSize: '13px', color: '#444' }}>{p.limite.toLocaleString('it-IT')} spedizioni al mese</div>
              <div style={{ fontSize: '12px', color: '#8a8a8a', lineHeight: 1.5, marginTop: '4px' }}>
                Tutti i canali di vendita · salvataggio settimanale · aggiornamenti gratuiti
                {Number(p.prezzo) > 0 ? ' · assistenza chat ed email' : ''}
              </div>
              <div style={{ marginTop: 'auto', paddingTop: '12px' }}>
                {attuale ? (
                  <div style={{ fontSize: '13px', fontWeight: 700, color: ACCENT }}>Il tuo pacchetto</div>
                ) : Number(p.prezzo) === 0 ? (
                  <div style={{ fontSize: '12.5px', color: '#8a8a8a' }}>Si torna qui disdicendo</div>
                ) : (
                  <button disabled={!!inCorso || !d.pagamentoAttivo} onClick={() => scegli(p.codice)}
                    style={{
                      width: '100%', background: basta && !oltre ? '#fff' : ACCENT,
                      color: basta && !oltre ? '#1a1a1a' : '#fff',
                      border: basta && !oltre ? '1px solid #d5d5d5' : 'none',
                      borderRadius: '8px', padding: '10px', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer',
                    }}>
                    {inCorso === p.codice ? '…' : s.ha_carta ? 'Passa a questo' : 'Attiva'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {(d.storico || []).length > 1 && (
        <div style={{ marginTop: '14px', fontSize: '12.5px', color: '#8a8a8a' }}>
          Mesi precedenti: {(d.storico || []).slice(1, 4).map((x: any) => `${x.mese} → ${x.n}`).join(' · ')}
        </div>
      )}
    </div>
  )
}
