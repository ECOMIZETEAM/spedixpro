'use client'
import { useState, useEffect, useCallback } from 'react'

// Pagina SMS del CLIENTE: quanti ne restano, comprane altri (carta/Stripe), auto-ricarica, e l'elenco
// di quelli inviati. Gli SMS sono suoi e li usa per le sue spedizioni; a 0 non partono.

const eur = (n: number) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const dataIt = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? s : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }

interface Stato {
  creditoSms: number; costoSms: number; smsDisponibili: number; gatewayPronto: boolean; cartaSalvata: boolean
  auto: { attiva: boolean; soglia: number; pacchetto: number }
  inviati: { numero: string; quando: string }[]
  acquisti: { quantita: number; quando: string }[]
}

export default function ClienteSmsPage() {
  const [d, setD] = useState<Stato | null>(null)
  const [pacchetto, setPacchetto] = useState(1000)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  // Auto-ricarica (form)
  const [aAttiva, setAAttiva] = useState(false)
  const [aSoglia, setASoglia] = useState(100)
  const [aPacchetto, setAPacchetto] = useState(1000)

  const carica = useCallback(async () => {
    try {
      const r = await fetch('/api/cliente/sms/stato')
      if (r.ok) { const j = await r.json(); setD(j); setAAttiva(!!j.auto?.attiva); setASoglia(Number(j.auto?.soglia) || 100); setAPacchetto(Number(j.auto?.pacchetto) || 1000) }
    } catch {}
  }, [])
  useEffect(() => { carica() }, [carica])
  // Ritorno dalla cassa: il webhook accredita in un attimo, ricarico dopo un istante.
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('acquisto') === 'ok') {
      window.history.replaceState({}, '', window.location.pathname)
      setMsg({ t: 'ok', x: 'Pagamento ricevuto: gli SMS si stanno accreditando.' })
      const t = setTimeout(() => carica(), 1500); return () => clearTimeout(t)
    }
  }, [carica])

  const costoSms = d?.costoSms || 0.10

  async function compra() {
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/sms/acquista', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantita: pacchetto }) })
      const j = await r.json()
      if (!r.ok || !j.url) { setMsg({ t: 'err', x: j.error || 'Errore' }); return }
      window.location.href = j.url
    } finally { setBusy(false) }
  }

  async function salvaAuto(attiva: boolean) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/sms/autoricarica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attiva, soglia: aSoglia, pacchetto: aPacchetto }) })
      const j = await r.json()
      if (!r.ok) { setMsg({ t: 'err', x: j.error || 'Errore' }); return }
      setAAttiva(attiva); setMsg({ t: 'ok', x: attiva ? 'Auto-ricarica attivata.' : 'Auto-ricarica disattivata.' }); carica()
    } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', padding: '18px 20px' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: '#9ca3af', marginBottom: '6px' }
  const inp: React.CSSProperties = { padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff' }
  const btn: React.CSSProperties = { background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 18px', fontSize: '13px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }
  const th: React.CSSProperties = { textAlign: 'left', padding: '9px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 16px', fontSize: '13px', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0' }

  return (
    <div style={{ maxWidth: '960px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>SMS</h1>
        <span style={{ display: 'block', marginTop: '4px', fontSize: '13px', color: '#666' }}>
          Avvisa i tuoi destinatari via SMS con il link al tracking. Compri i tuoi SMS con carta: sono per te. Ogni SMS costa {eur(costoSms)}. Se sei a 0, l'SMS non parte.
        </span>
      </div>

      {msg && <div style={{ padding: '9px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '12.5px', color: '#fff', background: msg.t === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.x}</div>}
      {d && !d.gatewayPronto && <div style={{ padding: '9px 12px', borderRadius: '6px', marginBottom: '14px', fontSize: '12.5px', color: '#9a3412', background: '#fff7ed', border: '1px solid #fdba74' }}>Le notifiche SMS sono in fase di attivazione sulla piattaforma: puoi già comprare il credito, gli invii partiranno appena attive.</div>}

      {/* Disponibili */}
      <div style={{ ...card, borderColor: '#fdba74', background: '#fff7ed', marginBottom: '16px', maxWidth: '360px' }}>
        <span style={lbl}>SMS disponibili</span>
        <div style={{ fontSize: '30px', fontWeight: 800, color: '#ea580c' }}>{(d?.smsDisponibili || 0).toLocaleString('it-IT')}</div>
        <div style={{ fontSize: '12.5px', color: '#9a3412', marginTop: '2px' }}>≈ {eur(d?.creditoSms || 0)} di credito · {eur(costoSms)}/SMS</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '14px', marginBottom: '16px' }}>
        {/* Compra */}
        <div style={card}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Compra SMS</div>
          <div style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>Pagamento con carta. Minimo 1000.</div>
          <label style={lbl}>Pacchetto</label>
          <select value={pacchetto} onChange={e => setPacchetto(Number(e.target.value))} style={{ ...inp, width: '100%', marginBottom: '10px' }}>
            {[1000, 5000, 10000].map(n => <option key={n} value={n}>{n.toLocaleString('it-IT')} SMS — {eur(n * costoSms)}</option>)}
          </select>
          <button onClick={compra} disabled={busy} style={{ ...btn, width: '100%' }}>Paga con carta ({eur(pacchetto * costoSms)})</button>
        </div>

        {/* Auto-ricarica */}
        <div style={card}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Auto-ricarica</div>
          <div style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>Quando scendi sotto la soglia, ricarico il pacchetto sulla carta salvata.</div>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Sotto (SMS)</label>
              <input type="number" min={0} value={aSoglia} onChange={e => setASoglia(Math.max(0, Math.floor(Number(e.target.value)) || 0))} style={{ ...inp, width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Ricarica</label>
              <select value={aPacchetto} onChange={e => setAPacchetto(Number(e.target.value))} style={{ ...inp, width: '100%' }}>
                {[1000, 5000, 10000].map(n => <option key={n} value={n}>{n.toLocaleString('it-IT')} SMS</option>)}
              </select>
            </div>
          </div>
          {!d?.cartaSalvata && <div style={{ fontSize: '11.5px', color: '#9a3412', marginBottom: '10px' }}>Fai un primo acquisto: così la carta viene salvata e l'auto-ricarica può funzionare.</div>}
          {aAttiva
            ? <button onClick={() => salvaAuto(false)} disabled={busy} style={{ ...btn, background: '#fff', color: '#dc2626', border: '1px solid #fecaca' }}>Disattiva auto-ricarica</button>
            : <button onClick={() => salvaAuto(true)} disabled={busy || !d?.cartaSalvata} style={{ ...btn, opacity: (busy || !d?.cartaSalvata) ? 0.6 : 1 }}>Attiva auto-ricarica</button>}
          {aAttiva && <span style={{ marginLeft: '10px', fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>● Attiva</span>}
        </div>
      </div>

      {/* Elenco SMS inviati */}
      <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: '16px' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e5e7eb', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>SMS inviati</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr style={{ background: '#f9fafb' }}>{['Spedizione', 'Inviato il'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {!d?.inviati?.length ? (
                <tr><td colSpan={2} style={{ padding: '22px 16px', color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>Nessun SMS inviato ancora</td></tr>
              ) : d.inviati.slice(0, 100).map((m, i) => (
                <tr key={i}><td style={{ ...td, fontWeight: 600 }}>{m.numero}</td><td style={{ ...td, color: '#6b7280' }}>{dataIt(m.quando)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ricariche */}
      {!!d?.acquisti?.length && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #e5e7eb', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Ricariche</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead><tr style={{ background: '#f9fafb' }}>{['SMS', 'Data'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {d.acquisti.map((m, i) => (
                  <tr key={i}><td style={{ ...td, fontWeight: 600 }}>+{(m.quantita || 0).toLocaleString('it-IT')}</td><td style={{ ...td, color: '#6b7280' }}>{dataIt(m.quando)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
