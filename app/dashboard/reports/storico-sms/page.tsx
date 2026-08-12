'use client'
import { useState, useEffect, useCallback } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

interface Cliente { id: string; ragione_sociale: string; credito_sms: number }
interface Mov { tipo: string; descrizione: string; importo: number; quantita_sms: number | null; saldo_dopo: number | null; cliente_id: string | null; created_at: string }

const eur = (n: number) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const dataIt = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? s : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
const TIPO_LABEL: Record<string, string> = { acquisto: 'Acquisto', trasferimento: 'Trasferimento', consumo: 'Invio SMS', rettifica: 'Rettifica' }

export default function NotificheSmsPage() {
  const dialog = useDialog()
  const [dati, setDati] = useState<{ creditoWallet: number; creditoSms: number; costoSms: number; movimenti: Mov[]; clienti: Cliente[]; radice?: boolean; puoTestare?: boolean; gatewayPronto?: boolean; cartaSalvata?: boolean; auto?: { attiva: boolean; soglia: number; pacchetto: number } } | null>(null)
  const [pacchetto, setPacchetto] = useState(1000)
  const [telProva, setTelProva] = useState('')
  const [aAttiva, setAAttiva] = useState(false)
  const [aSoglia, setASoglia] = useState(100)
  const [aPacchetto, setAPacchetto] = useState(1000)
  const [busy, setBusy] = useState(false)

  const carica = useCallback(async () => {
    try {
      const r = await fetch('/api/sms/stato')
      if (r.ok) { const j = await r.json(); setDati(j); setAAttiva(!!j.auto?.attiva); setASoglia(Number(j.auto?.soglia) || 100); setAPacchetto(Number(j.auto?.pacchetto) || 1000) }
    } catch {}
  }, [])
  useEffect(() => { carica() }, [carica])
  // Ritorno dalla cassa Stripe: il webhook accredita in un attimo, ricarico il saldo dopo un istante.
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('acquisto') === 'ok') {
      window.history.replaceState({}, '', window.location.pathname)
      const t = setTimeout(() => carica(), 1500); return () => clearTimeout(t)
    }
  }, [carica])

  const costoSms = dati?.costoSms || 0.084
  const smsDisponibili = dati ? Math.floor(dati.creditoSms / costoSms) : 0

  async function acquista() {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/sms/acquista', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantita: pacchetto }) })
      const j = await r.json()
      if (!r.ok || !j.url) { await dialog.alert({ title: 'Acquisto non riuscito', message: j.error || 'Errore' }); return }
      window.location.href = j.url   // cassa Stripe: gli SMS si accreditano a pagamento confermato
    } finally { setBusy(false) }
  }

  async function salvaAuto(attiva: boolean) {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/sms/autoricarica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attiva, soglia: aSoglia, pacchetto: aPacchetto }) })
      const j = await r.json()
      if (!r.ok) { await dialog.alert({ title: 'Auto-ricarica', message: j.error || 'Errore' }); return }
      setAAttiva(attiva); await carica()
    } finally { setBusy(false) }
  }

  async function inviaProva() {
    if (busy) return
    const tel = telProva.trim()
    if (!tel) { await dialog.alert({ message: 'Inserisci un numero di cellulare' }); return }
    setBusy(true)
    try {
      const r = await fetch('/api/sms/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telefono: tel }) })
      const j = await r.json()
      if (!r.ok) { await dialog.alert({ title: 'SMS di prova non riuscito', message: j.error || 'Errore' }); return }
      await dialog.alert({ title: 'SMS inviato', message: `SMS di prova inviato a ${j.inviatoA}. Controlla il telefono: se arriva, il gateway è a posto.` })
    } finally { setBusy(false) }
  }

  async function accreditoProva() {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/sms/test-accredito', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) { await dialog.alert({ title: 'Prova', message: j.error || 'Errore' }); return }
      await dialog.alert({ title: 'SMS di prova accreditati', message: `+${j.aggiunti} SMS aggiunti al tuo credito, gratis. Ora crea una spedizione con la notifica SMS attiva verso il tuo numero per provare l'invio completo.` })
      await carica()
    } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', padding: '18px 20px' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: '#9ca3af', marginBottom: '6px' }
  const inp: React.CSSProperties = { padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff' }
  const btn: React.CSSProperties = { background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 18px', fontSize: '13px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }

  return (
    <div style={{ maxWidth: '960px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Notifiche SMS</h1>
        <span style={{ display: 'block', marginTop: '4px', fontSize: '13px', color: '#666' }}>
          Compra i tuoi SMS con carta: sono per te e per i tuoi <b>clienti diretti</b> (mai i sotto-master). Ogni SMS di notifica costa {eur(costoSms)}.
        </span>
      </div>

      {/* SMS disponibili */}
      <div style={{ ...card, borderColor: '#fdba74', background: '#fff7ed', marginBottom: '16px', maxWidth: '360px' }}>
        <span style={lbl}>SMS disponibili</span>
        <div style={{ fontSize: '30px', fontWeight: 800, color: '#ea580c' }}>{smsDisponibili.toLocaleString('it-IT')}</div>
        <div style={{ fontSize: '12.5px', color: '#9a3412', marginTop: '2px' }}>≈ {dati ? eur(dati.creditoSms) : '—'} di credito · {eur(costoSms)}/SMS</div>
      </div>

      {/* SMS di prova — radice o master abilitato (il gateway è unico e globale) */}
      {dati?.puoTestare && (
        <div style={{ ...card, marginBottom: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Invia SMS di prova</div>
          <div style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>Verifica il gateway (mittente registrato e consegna) senza creare una spedizione. Non tocca il credito SMS.</div>
          {!dati.gatewayPronto && (
            <div style={{ fontSize: '12.5px', color: '#9a3412', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '6px', padding: '9px 12px', marginBottom: '11px' }}>
              ⚠️ Gateway non ancora configurato: aggiungi su Vercel <b>ESENDEX_USERNAME</b>, <b>ESENDEX_PASSWORD</b> e <b>ESENDEX_SENDER</b> (il mittente registrato), poi ridistribuisci.
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', maxWidth: '380px' }}>
            <input value={telProva} onChange={e => setTelProva(e.target.value)} placeholder="Cellulare (es. 3401234567)" style={{ ...inp, flex: 1 }} />
            <button onClick={inviaProva} disabled={busy || !dati.gatewayPronto} style={{ ...btn, opacity: (busy || !dati.gatewayPronto) ? 0.6 : 1 }}>Invia prova</button>
          </div>
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>Provare l'acquisto senza pagare? Accreditati qualche SMS gratis, poi crea una spedizione con la notifica SMS verso il tuo numero.</div>
            <button onClick={accreditoProva} disabled={busy} style={{ ...btn, background: '#fff', color: '#0369a1', border: '1px solid #bae6fd' }}>+ Accredita 25 SMS di prova (gratis)</button>
          </div>
        </div>
      )}

      {/* Compra SMS (carta / Stripe) */}
      <div style={{ ...card, marginBottom: '16px', maxWidth: '420px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Compra SMS</div>
        <div style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>Pagamento con carta. Gli SMS restano tuoi: nessun trasferimento, ognuno compra i suoi.</div>
        <label style={lbl}>Pacchetto</label>
        <select value={pacchetto} onChange={e => setPacchetto(Number(e.target.value))} style={{ ...inp, width: '100%', marginBottom: '10px' }}>
          {[1000, 5000, 10000].map(n => <option key={n} value={n}>{n.toLocaleString('it-IT')} SMS — {eur(n * costoSms)}</option>)}
        </select>
        <button onClick={acquista} disabled={busy} style={{ ...btn, width: '100%' }}>Paga con carta ({eur(pacchetto * costoSms)})</button>
      </div>

      {/* Auto-ricarica */}
      <div style={{ ...card, marginBottom: '16px', maxWidth: '420px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Auto-ricarica</div>
        <div style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>Sotto la soglia, ricarico il pacchetto sulla carta salvata.</div>
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
        {!dati?.cartaSalvata && <div style={{ fontSize: '11.5px', color: '#9a3412', marginBottom: '10px' }}>Fai un primo acquisto: la carta viene salvata e l'auto-ricarica può funzionare.</div>}
        {aAttiva
          ? <button onClick={() => salvaAuto(false)} disabled={busy} style={{ ...btn, background: '#fff', color: '#dc2626', border: '1px solid #fecaca' }}>Disattiva</button>
          : <button onClick={() => salvaAuto(true)} disabled={busy || !dati?.cartaSalvata} style={{ ...btn, opacity: (busy || !dati?.cartaSalvata) ? 0.6 : 1 }}>Attiva auto-ricarica</button>}
        {aAttiva && <span style={{ marginLeft: '10px', fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>● Attiva</span>}
      </div>

      {/* Storico */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e5e7eb', fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Storico credito SMS</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['Data', 'Movimento', 'Descrizione', 'Importo', 'Saldo'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '9px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!dati?.movimenti?.length ? (
                <tr><td colSpan={5} style={{ padding: '22px 16px', color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>Nessun movimento</td></tr>
              ) : dati.movimenti.map((m, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '9px 16px', color: '#6b7280', fontSize: '12px', whiteSpace: 'nowrap' }}>{dataIt(m.created_at)}</td>
                  <td style={{ padding: '9px 16px', color: '#1a1a1a', fontWeight: 600 }}>{TIPO_LABEL[m.tipo] || m.tipo}</td>
                  <td style={{ padding: '9px 16px', color: '#4b5563' }}>{m.descrizione}</td>
                  <td style={{ padding: '9px 16px', fontWeight: 700, color: m.importo < 0 ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>{m.importo < 0 ? '' : '+'}{eur(m.importo)}</td>
                  <td style={{ padding: '9px 16px', color: '#1a1a1a', whiteSpace: 'nowrap' }}>{m.saldo_dopo != null ? eur(m.saldo_dopo) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
