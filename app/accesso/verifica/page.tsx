'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// PAGINA DEL CODICE (verifica in due passaggi). Ci arriva:
//  - chi ha messo la password e ha la verifica attiva: scrive il codice dell'app e prosegue;
//  - chi non l'ha ancora attivata e ora e' obbligatoria (o vuole attivarla): inquadra il codice QR
//    con l'app sul telefono, scrive il primo codice, e da li' in poi a ogni accesso.
// La pagina non e' sotto il middleware (altrimenti rimanderebbe a se stessa): legge da sola se c'e'
// una sessione. Tutto passa da Supabase Auth, che non e' toccato dal controllo del database.

type Fase = 'carico' | 'codice' | 'attiva' | 'senza-sessione' | 'errore'

// Solo percorsi interni: "dopo" arriva dall'indirizzo, e non deve poter mandare fuori dal sito.
function destinazione(): string {
  try {
    const d = new URLSearchParams(window.location.search).get('dopo') || '/'
    return d.startsWith('/') && !d.startsWith('//') && !d.startsWith('/\\') ? d : '/'
  } catch { return '/' }
}

function dataItaliana(iso: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return '' }
}

const scheda = { background: '#fff', borderRadius: '12px', padding: '36px', width: '420px', maxWidth: 'calc(100vw - 32px)', boxShadow: '0 2px 16px rgba(0,0,0,.08)' }
const campo = { width: '100%', padding: '12px', fontSize: '22px', letterSpacing: '6px', textAlign: 'center' as const, border: '1px solid #ddd', borderRadius: '8px', boxSizing: 'border-box' as const }
const bottone = { width: '100%', padding: '12px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginTop: '14px' }
const passo = { fontSize: '14px', color: '#333', lineHeight: 1.5, margin: '0 0 10px' }

export default function VerificaDuePassaggi() {
  const supabase = useMemo(() => createClient(), [])
  const [fase, setFase] = useState<Fase>('carico')
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [segreto, setSegreto] = useState('')
  const [codice, setCodice] = useState('')
  const [errore, setErrore] = useState('')
  const [invio, setInvio] = useState(false)
  const [obbligatoria, setObbligatoria] = useState(false)
  const [dal, setDal] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setFase('senza-sessione'); return }
      try {
        const st = await fetch('/api/accesso/stato').then(r => r.ok ? r.json() : null)
        setObbligatoria(!!st?.obbligatoria); setDal(st?.obbligatoriaDal || null)
      } catch { /* senza stato si mostra la versione prudente: niente "piu' tardi" */ setObbligatoria(true) }

      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) { setErrore('Non riesco a leggere la verifica del tuo account. Ricarica la pagina.'); setFase('errore'); return }
      const attivo = (data?.totp || []).find((f: any) => f.status === 'verified')
      if (attivo) { setFactorId(attivo.id); setFase('codice'); return }

      // Da attivare. Un'attivazione lasciata a meta' (pagina chiusa prima del primo codice) resta come
      // fattore "non verificato" e bloccherebbe la nuova: si toglie e si riparte pulito.
      for (const f of (data?.all || []).filter((f: any) => f.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data: nuovo, error: eErr } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'MoovExpress', issuer: 'MoovExpress' })
      if (eErr || !nuovo) { setErrore('Non riesco a preparare la verifica. Ricarica la pagina tra qualche secondo.'); setFase('errore'); return }
      setFactorId(nuovo.id); setQr(nuovo.totp.qr_code); setSegreto(nuovo.totp.secret); setFase('attiva')
    })()
  }, [supabase])

  async function conferma(e: React.FormEvent) {
    e.preventDefault()
    const pulito = codice.replace(/\D/g, '')
    if (pulito.length !== 6) { setErrore('Il codice ha 6 cifre.'); return }
    setInvio(true); setErrore('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: pulito })
    setInvio(false)
    if (error) {
      setCodice('')
      setErrore('Codice non valido o scaduto. Scrivi quello che vedi adesso nell\'app: cambia ogni 30 secondi.')
      return
    }
    // Ricarica intera: il middleware rilegge la sessione, ora con il codice, e porta alla pagina giusta.
    window.location.href = destinazione()
  }

  const intestazione = (
    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
      <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a' }}>Moov<span style={{ color: '#f97316' }}>Express</span></div>
      <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>Verifica in due passaggi</div>
    </div>
  )
  const avviso = errore && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px', margin: '12px 0 0', fontSize: '13px', color: '#dc2626' }}>{errore}</div>
  const esci = <div style={{ textAlign: 'center', marginTop: '18px' }}><a href="/api/auth/logout" style={{ fontSize: '13px', color: '#999' }}>Esci</a></div>

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f5f5', fontFamily: 'var(--font-geist-sans),system-ui,sans-serif', padding: '16px 0' }}>
      <div style={scheda}>
        {intestazione}

        {fase === 'carico' && <p style={{ ...passo, textAlign: 'center', color: '#999' }}>Un momento…</p>}

        {fase === 'senza-sessione' && <>
          <p style={passo}>La sessione è scaduta. Accedi di nuovo con email e password.</p>
          <a href="/" style={{ ...bottone, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Vai all&apos;accesso</a>
        </>}

        {fase === 'errore' && <>{avviso}{esci}</>}

        {fase === 'codice' && <form onSubmit={conferma}>
          <p style={passo}>Apri l&apos;app di autenticazione sul telefono e scrivi il codice di 6 cifre che vedi per <b>MoovExpress</b>.</p>
          <input style={campo} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7}
            value={codice} onChange={e => setCodice(e.target.value)} placeholder="000000" aria-label="Codice di 6 cifre" />
          {avviso}
          <button style={{ ...bottone, opacity: invio ? 0.6 : 1 }} disabled={invio}>{invio ? 'Verifico…' : 'Entra'}</button>
          <p style={{ fontSize: '12px', color: '#999', marginTop: '14px', lineHeight: 1.5 }}>Hai cambiato o perso il telefono? Chiedi a chi ti ha dato l&apos;accesso di azzerare la verifica: al prossimo accesso la riattivi.</p>
          {esci}
        </form>}

        {fase === 'attiva' && <form onSubmit={conferma}>
          {obbligatoria
            ? <p style={{ ...passo, fontWeight: 600 }}>Per entrare serve la verifica in due passaggi: oltre alla password, un codice dall&apos;app sul telefono.</p>
            : <p style={{ ...passo, fontWeight: 600 }}>Proteggi l&apos;account: oltre alla password, all&apos;accesso servirà un codice dall&apos;app sul telefono.{dal ? ` Dal ${dataItaliana(dal)} sarà obbligatoria per tutti.` : ''}</p>}
          <p style={passo}><b>1.</b> Installa sul telefono un&apos;app di autenticazione gratuita, per esempio <b>Google Authenticator</b> o <b>Microsoft Authenticator</b>.</p>
          <p style={passo}><b>2.</b> Nell&apos;app tocca <b>+</b> e inquadra questo codice:</p>
          {qr && <div style={{ textAlign: 'center', margin: '8px 0 6px' }}><img src={qr} alt="Codice QR da inquadrare con l'app" width={180} height={180} /></div>}
          <p style={{ fontSize: '12px', color: '#666', textAlign: 'center', margin: '0 0 14px', wordBreak: 'break-all' }}>
            Se non riesci a inquadrarlo, nell&apos;app scegli «inserisci una chiave» e scrivi:<br /><b style={{ fontFamily: 'monospace', fontSize: '13px', color: '#333' }}>{segreto}</b>
          </p>
          <p style={passo}><b>3.</b> Scrivi qui il codice di 6 cifre che compare nell&apos;app:</p>
          <input style={campo} inputMode="numeric" autoComplete="one-time-code" maxLength={7}
            value={codice} onChange={e => setCodice(e.target.value)} placeholder="000000" aria-label="Codice di 6 cifre" />
          {avviso}
          <button style={{ ...bottone, opacity: invio ? 0.6 : 1 }} disabled={invio}>{invio ? 'Verifico…' : 'Attiva e entra'}</button>
          {!obbligatoria && <div style={{ textAlign: 'center', marginTop: '14px' }}>
            <a href={typeof window === 'undefined' ? '/' : destinazione()} style={{ fontSize: '13px', color: '#666' }}>Più tardi</a>
          </div>}
          {esci}
        </form>}
      </div>
    </div>
  )
}
