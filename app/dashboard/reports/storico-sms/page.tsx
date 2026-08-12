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
  const [dati, setDati] = useState<{ creditoWallet: number; creditoSms: number; costoSms: number; movimenti: Mov[]; clienti: Cliente[]; radice?: boolean; gatewayPronto?: boolean } | null>(null)
  const [pacchetto, setPacchetto] = useState(1000)
  const [clienteSel, setClienteSel] = useState('')
  const [importoTrasf, setImportoTrasf] = useState('')
  const [telProva, setTelProva] = useState('')
  const [busy, setBusy] = useState(false)

  const carica = useCallback(async () => {
    try { const r = await fetch('/api/sms/stato'); if (r.ok) setDati(await r.json()) } catch {}
  }, [])
  useEffect(() => { carica() }, [carica])

  const costoSms = dati?.costoSms || 0.084
  const smsDisponibili = dati ? Math.floor(dati.creditoSms / costoSms) : 0

  async function acquista() {
    if (busy) return
    const costo = pacchetto * costoSms
    const ok = await dialog.confirm({ title: 'Conferma acquisto', message: `Acquistare ${pacchetto.toLocaleString('it-IT')} SMS per ${eur(costo)}? L'importo viene scalato dal tuo credito.` })
    if (!ok) return
    setBusy(true)
    try {
      const r = await fetch('/api/sms/acquista', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantita: pacchetto }) })
      const j = await r.json()
      if (!r.ok) { await dialog.alert({ title: 'Acquisto non riuscito', message: j.error || 'Errore' }); return }
      await carica()
    } finally { setBusy(false) }
  }

  async function trasferisci() {
    if (busy) return
    const importo = Number(String(importoTrasf).replace(',', '.'))
    if (!clienteSel) { await dialog.alert({ message: 'Seleziona un cliente' }); return }
    if (!Number.isFinite(importo) || importo <= 0) { await dialog.alert({ message: 'Inserisci un importo valido' }); return }
    setBusy(true)
    try {
      const r = await fetch('/api/sms/trasferisci', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: clienteSel, importo }) })
      const j = await r.json()
      if (!r.ok) { await dialog.alert({ title: 'Trasferimento non riuscito', message: j.error || 'Errore' }); return }
      setImportoTrasf('')
      await carica()
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

  const card: React.CSSProperties = { background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', padding: '18px 20px' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: '#9ca3af', marginBottom: '6px' }
  const inp: React.CSSProperties = { padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', background: '#fff' }
  const btn: React.CSSProperties = { background: '#f97316', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 18px', fontSize: '13px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }

  return (
    <div style={{ maxWidth: '960px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Notifiche SMS</h1>
        <span style={{ display: 'block', marginTop: '4px', fontSize: '13px', color: '#666' }}>
          Acquista credito SMS e distribuiscilo ai tuoi clienti. Ogni SMS con il link di tracking costa {eur(costoSms)}.
        </span>
      </div>

      {/* Saldi */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '14px', marginBottom: '16px' }}>
        <div style={{ ...card, borderColor: '#fdba74', background: '#fff7ed' }}>
          <span style={lbl}>Credito SMS disponibile</span>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#ea580c' }}>{dati ? eur(dati.creditoSms) : '—'}</div>
          <div style={{ fontSize: '12.5px', color: '#9a3412', marginTop: '2px' }}>≈ {smsDisponibili.toLocaleString('it-IT')} SMS</div>
        </div>
        <div style={card}>
          <span style={lbl}>Credito conto (per acquistare)</span>
          <div style={{ fontSize: '26px', fontWeight: 800, color: '#1a1a1a' }}>{dati ? eur(dati.creditoWallet) : '—'}</div>
          <div style={{ fontSize: '12.5px', color: '#9ca3af', marginTop: '2px' }}>Il credito SMS si compra da qui</div>
        </div>
      </div>

      {/* SMS di prova — solo il master radice (il gateway è unico e globale) */}
      {dati?.radice && (
        <div style={{ ...card, marginBottom: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Invia SMS di prova</div>
          <div style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '12px' }}>Verifica il gateway (mittente registrato e consegna) senza creare una spedizione. Non tocca il credito SMS.</div>
          {!dati.gatewayPronto && (
            <div style={{ fontSize: '12.5px', color: '#9a3412', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '6px', padding: '9px 12px', marginBottom: '11px' }}>
              ⚠️ Gateway non ancora configurato: aggiungi su Vercel <b>SKEBBY_USERNAME</b>, <b>SKEBBY_PASSWORD</b> e <b>SKEBBY_SENDER</b> (il mittente registrato), poi ridistribuisci.
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', maxWidth: '380px' }}>
            <input value={telProva} onChange={e => setTelProva(e.target.value)} placeholder="Cellulare (es. 3401234567)" style={{ ...inp, flex: 1 }} />
            <button onClick={inviaProva} disabled={busy || !dati.gatewayPronto} style={{ ...btn, opacity: (busy || !dati.gatewayPronto) ? 0.6 : 1 }}>Invia prova</button>
          </div>
        </div>
      )}

      {/* Acquisto + Trasferimento */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '14px', marginBottom: '16px' }}>
        <div style={card}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '12px' }}>Acquista credito SMS</div>
          <label style={lbl}>Pacchetto</label>
          <select value={pacchetto} onChange={e => setPacchetto(Number(e.target.value))} style={{ ...inp, width: '100%', marginBottom: '10px' }}>
            {[1000, 5000, 10000].map(n => <option key={n} value={n}>{n.toLocaleString('it-IT')} SMS — {eur(n * costoSms)}</option>)}
          </select>
          <button onClick={acquista} disabled={busy} style={{ ...btn, width: '100%' }}>Acquista ({eur(pacchetto * costoSms)})</button>
        </div>

        <div style={card}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a', marginBottom: '12px' }}>Trasferisci a un cliente</div>
          <label style={lbl}>Cliente</label>
          <select value={clienteSel} onChange={e => setClienteSel(e.target.value)} style={{ ...inp, width: '100%', marginBottom: '10px' }}>
            <option value="">— seleziona —</option>
            {(dati?.clienti || []).map(c => <option key={c.id} value={c.id}>{c.ragione_sociale} ({eur(c.credito_sms)})</option>)}
          </select>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input value={importoTrasf} onChange={e => setImportoTrasf(e.target.value)} placeholder="Importo €" style={{ ...inp, flex: 1 }} />
            <button onClick={trasferisci} disabled={busy} style={btn}>Trasferisci</button>
          </div>
        </div>
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
