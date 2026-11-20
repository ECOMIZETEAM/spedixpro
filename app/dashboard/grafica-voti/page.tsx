'use client'
// I risultati del voto sulla nuova versione (Lorenzo 19/11). Solo per il super master: la rotta /api/grafica/voti
// risponde 403 a chiunque altro, e qui lo si dice.
import { useEffect, useState } from 'react'
import { ARGOMENTI, type Argomento } from '@/app/components/grafica/argomenti'

type Voto = { argomento: string; voto: number; commento: string | null; pagina: string | null; quando: string; chi: string; ruolo: string | null; master: string | null; cliente: string | null }
type Conti = { totale: number; media: number | null; conti: number[] }
type Risposta = { per: Record<string, Conti>; voti: Voto[] }

const DICITURE = ['Per niente', 'Poco', 'Così così', 'Mi piace', 'Moltissimo']
const testo = '#1a1a1a', grigio = '#6b7280', filo = '#e5e7eb', arancio = '#FF4F00'

export default function GraficaVoti() {
  const [d, setD] = useState<Risposta | null>(null)
  const [errore, setErrore] = useState('')
  const [soloCommenti, setSoloCommenti] = useState(false)
  // un voto per argomento: la nuova versione e, a parte, la Nuova spedizione
  const [arg, setArg] = useState<Argomento>('versione')
  useEffect(() => {
    fetch('/api/grafica/voti', { cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error(r.status === 403 ? 'Questa pagina è solo per il super master.' : 'Voti non caricati.'); return r.json() })
      .then(setD).catch(e => setErrore(e.message))
  }, [])
  if (errore) return <div style={{ padding: '40px', color: testo }}>{errore}</div>
  if (!d) return <div style={{ padding: '40px', color: grigio }}>Caricamento…</div>
  const c: Conti = d.per[arg] || { totale: 0, media: null, conti: [0, 0, 0, 0, 0] }
  const max = Math.max(1, ...c.conti)
  const lista = d.voti.filter(v => v.argomento === arg && (!soloCommenti || v.commento))
  return (
    <div style={{ maxWidth: '980px', color: testo }}>
      <h1 style={{ fontSize: '26px', fontWeight: 600, margin: '0 0 4px' }}>Voti sulla nuova versione</h1>
      <p style={{ margin: '0 0 16px', color: grigio, fontSize: '14px' }}>Chi ha provato «Scopri la nuova versione» e cosa ne pensa. Un voto per persona e per argomento: vale l'ultimo.</p>
      <div role="tablist" aria-label="Cosa si vota" style={{ display: 'inline-flex', gap: '4px', padding: '4px', borderRadius: '12px', background: '#f1f2f4', marginBottom: '18px' }}>
        {(Object.keys(ARGOMENTI) as Argomento[]).map(a => (
          <button key={a} type="button" role="tab" aria-selected={arg === a} onClick={() => setArg(a)}
            style={{ border: 0, borderRadius: '9px', padding: '7px 14px', fontSize: '13.5px', cursor: 'pointer', background: arg === a ? '#fff' : 'transparent', color: testo, fontWeight: arg === a ? 600 : 400, boxShadow: arg === a ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>
            {ARGOMENTI[a].nome} <span style={{ color: grigio, fontWeight: 400 }}>{d.per[a]?.totale || 0}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '16px', marginBottom: '22px' }}>
        <div style={{ background: '#fff', border: `1px solid ${filo}`, borderRadius: '18px', padding: '18px 20px' }}>
          <div style={{ fontSize: '12px', color: grigio, textTransform: 'uppercase', letterSpacing: '.08em' }}>Media</div>
          <div style={{ fontSize: '44px', fontWeight: 500, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{c.media != null ? c.media.toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—'}<span style={{ fontSize: '18px', color: grigio }}> / 5</span></div>
          <div style={{ fontSize: '13px', color: grigio }}>{c.totale} {c.totale === 1 ? 'voto' : 'voti'}</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${filo}`, borderRadius: '18px', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center' }}>
          {[5, 4, 3, 2, 1].map(n => (
            <div key={n} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 40px', alignItems: 'center', gap: '12px', fontSize: '13px' }}>
              <span><b>{n}</b> <span style={{ color: grigio }}>{DICITURE[n - 1]}</span></span>
              <span style={{ height: '8px', borderRadius: '99px', background: '#f1f2f4', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(c.conti[n - 1] / max) * 100}%`, background: arancio, borderRadius: '99px' }} /></span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.conti[n - 1]}</span>
            </div>
          ))}
        </div>
      </div>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: grigio, marginBottom: '10px', cursor: 'pointer' }}>
        <input type="checkbox" checked={soloCommenti} onChange={e => setSoloCommenti(e.target.checked)} /> Solo chi ha scritto un commento
      </label>
      <div style={{ background: '#fff', border: `1px solid ${filo}`, borderRadius: '18px', overflow: 'hidden' }}>
        {lista.length === 0 && <div style={{ padding: '24px', color: grigio, fontSize: '14px' }}>Ancora nessun voto.</div>}
        {lista.map((v, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 150px', gap: '14px', padding: '14px 18px', borderTop: i ? `1px solid ${filo}` : 'none', alignItems: 'start' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: '40px', height: '40px', borderRadius: '12px', background: v.voto >= 4 ? '#ecfdf3' : v.voto <= 2 ? '#fef2f2' : '#f3f4f6', color: v.voto >= 4 ? '#12805a' : v.voto <= 2 ? '#d23446' : testo, fontWeight: 600, fontSize: '18px' }}>{v.voto}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>{v.cliente ? `${v.cliente} · cliente di ${v.master}` : v.master || '—'}</div>
              <div style={{ fontSize: '12.5px', color: grigio }}>{v.chi}{v.ruolo ? ` · ${v.ruolo}` : ''}</div>
              {v.commento && <div style={{ marginTop: '6px', fontSize: '14px', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{v.commento}</div>}
            </div>
            <div style={{ fontSize: '12.5px', color: grigio, textAlign: 'right' }}>{new Date(v.quando).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{v.pagina ? <div>da {v.pagina.replace('/dashboard', 'Dashboard').replace('/spedizioni', ' › Elenco')}</div> : null}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
