'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import CampoPassword from '../components/CampoPassword'

export default function ImpostaPassword() {
  const supabase = createClient()
  const [ready, setReady] = useState(false)      // client ha finito di controllare la sessione dell'invito
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [conferma, setConferma] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err', testo: string } | null>(null)

  useEffect(() => {
    // Il client browser (@supabase/ssr) scambia automaticamente il token dell'invito
    // presente nell'URL e crea la sessione: la intercetto qui.
    // Con un token nell'indirizzo la sessione valida è SOLO quella che nasce dalla verifica:
    // altrimenti questo ascoltatore, che scatta subito con la sessione già presente nel browser,
    // sbloccherebbe il modulo sull'account sbagliato prima ancora che la verifica sia finita.
    const conToken = new URLSearchParams(window.location.search).has('token_hash')
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session && !conToken) { setHasSession(true); setReady(true) }
    })
    ;(async () => {
      // Link di RECUPERO PASSWORD: arriva con ?token_hash=...&type=recovery e la sessione la
      // creiamo qui, senza dipendere dalla lista di indirizzi autorizzati del pannello Supabase.
      const p = new URLSearchParams(window.location.search)
      const tokenHash = p.get('token_hash')
      // Tipo preso dall'indirizzo ma limitato ai valori previsti: non si passa al verificatore
      // un valore arbitrario scritto da chi confeziona il link.
      const richiesto = String(p.get('type') || 'recovery')
      const tipo = (['recovery', 'invite', 'magiclink', 'email'].includes(richiesto) ? richiesto : 'recovery') as any
      if (tokenHash) {
        // La sessione eventualmente già aperta in questo browser va CHIUSA prima di verificare:
        // se il token è scaduto o già consumato e restasse quella di prima, il modulo comparirebbe
        // lo stesso e cambierebbe la password dell'account SBAGLIATO (tipico: il master apre nel
        // proprio browser il link di recupero girato da un cliente).
        // scope 'local': serve solo a non far ripiegare il modulo sulla sessione gia' aperta in
        // QUESTO browser. Senza argomenti supabase-js revoca le sessioni su tutti i dispositivi:
        // il master che apriva il link di recupero girato da un cliente si sloggiava ovunque.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        const { data: v, error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash })
        // Pulisco l'indirizzo: il token è a uso singolo, non deve restare nella cronologia.
        window.history.replaceState(null, '', '/imposta-password')
        if (v?.session && !error) { setHasSession(true); setReady(true); return }
        // Link non valido: nessun ripiego sulla sessione presente, si dice e basta.
        setHasSession(false); setReady(true); return
      }
      const { data } = await supabase.auth.getSession()
      if (data.session) setHasSession(true)
      setReady(true)
    })()
    return () => { sub.subscription.unsubscribe() }
  }, [])

  async function salva() {
    if (password.length < 12) { setMsg({ tipo: 'err', testo: 'La password deve avere almeno 12 caratteri' }); return }
    if (password !== conferma) { setMsg({ tipo: 'err', testo: 'Le password non coincidono' }); return }
    setSalvando(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'err', testo: error.message || 'Errore durante il salvataggio' }); return }
    setMsg({ tipo: 'ok', testo: 'Password impostata! Accesso in corso...' })
    // Ogni ruolo al SUO portale. Prima si andava sempre su /dashboard e il cliente veniva poi
    // rimbalzato dal middleware su /cliente/dashboard: un giro in piu' a vuoto, e per un istante
    // vedeva l'area sbagliata. Il caricamento e' pieno (window.location), quindi il layout viene
    // reso lato server con la sessione e la sidebar c'e' subito.
    let destinazione = '/dashboard'
    try {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (u) {
        const { data: riga } = await supabase.from('utenti').select('cliente_id').eq('id', u.id).maybeSingle()
        if (riga?.cliente_id) destinazione = '/cliente/dashboard'
      }
    } catch {}
    setTimeout(() => { window.location.href = destinazione }, 800)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1px solid #e8e8e8', borderRadius: '6px', fontSize: '13px', color: '#1a1a1a', boxSizing: 'border-box' as const }
  const lbl = { fontSize: '11.5px', fontWeight: 600 as const, color: '#666', display: 'block' as const, marginBottom: '4px' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f5f5', fontFamily: 'var(--font-geist-sans),system-ui,sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '40px', width: '400px', boxShadow: '0 2px 16px rgba(0,0,0,.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a' }}>Moov<span style={{ color: '#f97316' }}>Express</span></div>
          <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>Imposta la tua password</div>
        </div>

        {msg && (
          <div style={{ padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: '13px', color: '#fff', background: msg.tipo === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.testo}</div>
        )}

        {!ready ? (
          <div style={{ textAlign: 'center', color: '#888', fontSize: '13px', padding: '20px 0' }}>Verifica dell'invito in corso...</div>
        ) : !hasSession ? (
          <div style={{ textAlign: 'center', color: '#dc2626', fontSize: '13px', padding: '10px 0' }}>
            Link non valido o scaduto.<br />Chiedi all'amministratore un nuovo invito.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={lbl}>Nuova password</label>
              <CampoPassword value={password} onChange={setPassword} required={false} />
            </div>
            <div>
              <label style={lbl}>Conferma password</label>
              <CampoPassword value={conferma} onChange={setConferma} required={false} />
            </div>
            <button onClick={salva} disabled={salvando} style={{ background: salvando ? '#fbbf24' : '#f97316', color: '#fff', border: 'none', padding: '11px', borderRadius: '6px', fontSize: '14px', fontWeight: 700, cursor: salvando ? 'default' : 'pointer' }}>
              {salvando ? 'Salvataggio...' : 'Imposta password ed entra'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
