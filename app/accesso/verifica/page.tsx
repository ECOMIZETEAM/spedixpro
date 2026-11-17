'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// PAGINA DEL CODICE (verifica in due passaggi). Ci arriva:
//  - chi ha messo la password e ha la verifica attiva: scrive il codice dell'app e prosegue;
//  - chi non l'ha ancora attivata e ora e' obbligatoria (o vuole attivarla): inquadra il codice QR
//    con l'app sul telefono, scrive il primo codice, e da li' in poi a ogni accesso.
// La pagina non e' sotto il middleware (altrimenti rimanderebbe a se stessa): legge da sola se c'e'
// una sessione. Tutto passa da Supabase Auth, che non e' toccato dal controllo del database.

// 'ripresa' = c'e' un'attivazione iniziata ma il suo codice QR non e' piu' a schermo (pagina ricaricata).
type Fase = 'carico' | 'codice' | 'attiva' | 'ripresa' | 'senza-sessione' | 'errore'

// L'ATTIVAZIONE IN CORSO NON SI RIFA' A OGNI CARICAMENTO DELLA PAGINA.
// Prima ogni apertura cancellava l'attivazione lasciata a meta' e ne creava una nuova, con un codice
// QR diverso. Bastava che la pagina si ricaricasse dopo che la persona aveva gia' inquadrato il QR
// (sul telefono succede passando all'app di autenticazione e tornando indietro, o con un secondo
// accesso aperto in un'altra scheda) e l'app restava con il codice di un'attivazione che non
// esisteva piu': ogni numero veniva rifiutato, e a ogni nuovo tentativo nell'app si aggiungeva
// un'altra voce «MoovExpress» uguale alle altre. Misurato il 16/11/2026: un cliente ha avuto 4 codici
// QR in 18 minuti e non e' mai riuscito ad attivarla, e in 24 ore 5 conferme sono finite su
// un'attivazione gia' cancellata, mostrando «codice non valido».
// Ora il QR resta nella scheda del browser finche' l'attivazione non e' conclusa (sessionStorage:
// e' lo stesso dato che la pagina mostra a schermo, e muore con la scheda), e un QR nuovo si crea
// solo quando la persona lo chiede.
const CHIAVE_ATTIVAZIONE = 'mx-attivazione-verifica'
type Attivazione = { id: string; qr: string; segreto: string; uri: string }

function leggiAttivazione(): Attivazione | null {
  try {
    const a = JSON.parse(sessionStorage.getItem(CHIAVE_ATTIVAZIONE) || 'null')
    return a && typeof a.id === 'string' && a.qr ? a : null
  } catch { return null }
}
function salvaAttivazione(a: Attivazione | null) {
  try {
    if (a) sessionStorage.setItem(CHIAVE_ATTIVAZIONE, JSON.stringify(a))
    else sessionStorage.removeItem(CHIAVE_ATTIVAZIONE)
  } catch { /* senza memoria della scheda si perde solo il QR al ricaricamento: resta la ripresa */ }
}

// Le attivazioni iniziate e non concluse, la piu' recente per prima.
type Fattore = { id: string; status: string; factor_type: string; created_at: string }
function inSospeso(tutti: Fattore[] | undefined): Fattore[] {
  return (tutti || [])
    .filter(f => f.status === 'unverified' && f.factor_type === 'totp')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

// Una sola attivazione alla volta: quelle lasciate a meta' si tolgono (con lo stesso nome Supabase
// rifiuterebbe la nuova), poi se ne crea una e la si ricorda nella scheda.
async function creaAttivazione(supabase: ReturnType<typeof createClient>): Promise<Attivazione | null> {
  const { data } = await supabase.auth.mfa.listFactors()
  for (const f of (data?.all || []).filter(f => f.status === 'unverified')) {
    await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data: nuovo, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'MoovExpress', issuer: 'MoovExpress' })
  if (error || !nuovo) return null
  const a = { id: nuovo.id, qr: nuovo.totp.qr_code, segreto: nuovo.totp.secret, uri: nuovo.totp.uri }
  salvaAttivazione(a)
  return a
}

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
  const [uri, setUri] = useState('')
  const [codice, setCodice] = useState('')
  const [errore, setErrore] = useState('')
  const [invio, setInvio] = useState(false)
  const [obbligatoria, setObbligatoria] = useState(false)
  const [dal, setDal] = useState<string | null>(null)

  function mostra(a: Attivazione) {
    setFactorId(a.id); setQr(a.qr); setSegreto(a.segreto); setUri(a.uri); setFase('attiva')
  }

  // Un avvio solo per pagina: due avvii insieme si cancellavano l'attivazione a vicenda (React in
  // sviluppo lo fa sempre, montando due volte; trovato provando questa pagina il 17/11/2026).
  const avviata = useRef(false)
  useEffect(() => {
    if (avviata.current) return
    avviata.current = true
    ;(async () => {
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

      // Da attivare. Se c'e' gia' un'attivazione iniziata si riprende quella (vedi sopra): con il suo
      // QR se questa scheda lo ricorda, altrimenti chiedendo il codice che l'app gia' mostra.
      const inCorso = inSospeso(data?.all)
      const ricordata = leggiAttivazione()
      if (ricordata && inCorso.some(f => f.id === ricordata.id)) { mostra(ricordata); return }
      if (inCorso.length) { setFactorId(inCorso[0].id); setFase('ripresa'); return }

      const nuova = await creaAttivazione(supabase)
      if (nuova) { mostra(nuova); return }
      // Un'altra pagina l'ha creata nello stesso istante (con lo stesso nome Supabase rifiuta la
      // seconda): si riprende quella invece di dare errore.
      const { data: dopo } = await supabase.auth.mfa.listFactors()
      const altra = inSospeso(dopo?.all)[0]
      if (altra) { setFactorId(altra.id); setFase('ripresa'); return }
      setErrore('Non riesco a preparare la verifica. Ricarica la pagina tra qualche secondo.'); setFase('errore')
    })()
  }, [supabase])

  // Solo su richiesta: un QR nuovo rende inutile quello gia' inquadrato.
  async function ricomincia() {
    setInvio(true); setErrore(''); setCodice('')
    const nuova = await creaAttivazione(supabase)
    setInvio(false)
    if (!nuova) { setErrore('Non riesco a preparare un codice nuovo. Riprova tra qualche secondo.'); return }
    mostra(nuova)
  }

  async function conferma(e: React.FormEvent) {
    e.preventDefault()
    const pulito = codice.replace(/\D/g, '')
    if (pulito.length !== 6) { setErrore('Il codice ha 6 cifre.'); return }
    setInvio(true); setErrore('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: pulito })
    setInvio(false)
    if (error) {
      setCodice('')
      // Un'attivazione cancellata non e' un codice sbagliato: dirlo come tale faceva ripetere
      // all'infinito un numero che non poteva funzionare.
      if (error.code === 'mfa_factor_not_found') {
        setErrore('Questa attivazione non esiste più: è stata ricominciata da un\'altra pagina. Ricarica questa pagina.')
      } else if (fase === 'codice') {
        setErrore('Codice non valido o scaduto. Scrivi quello che vedi adesso nell\'app: cambia ogni 30 secondi. Se viene sempre rifiutato, controlla che l\'ora del telefono sia impostata in automatico.')
      } else {
        setErrore('Codice non valido. Scrivi quello che vedi adesso nell\'app, alla voce MoovExpress aggiunta per ultima: se ce n\'è più d\'una, cancella le altre. Se viene sempre rifiutato, controlla che l\'ora del telefono sia impostata in automatico.')
      }
      return
    }
    salvaAttivazione(null)
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
          <p style={passo}><b>2.</b> Nell&apos;app tocca <b>+</b> e inquadra questo codice. Se nell&apos;app c&apos;è già una voce MoovExpress di un tentativo precedente, cancellala.</p>
          {qr && <div style={{ textAlign: 'center', margin: '8px 0 6px' }}><img src={qr} alt="Codice QR da inquadrare con l'app" width={180} height={180} /></div>}
          {/* Chi entra dal telefono non puo' inquadrare il proprio schermo: il link apre l'app con la chiave gia' scritta. */}
          {uri && <p style={{ fontSize: '13px', textAlign: 'center', margin: '0 0 8px' }}>
            <a href={uri} style={{ color: '#f97316', fontWeight: 600 }}>Sei sul telefono? Tocca qui per aggiungerlo all&apos;app</a>
          </p>}
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

        {fase === 'ripresa' && <form onSubmit={conferma}>
          <p style={{ ...passo, fontWeight: 600 }}>Hai già iniziato ad attivare la verifica in due passaggi.</p>
          <p style={passo}>Se hai già aggiunto <b>MoovExpress</b> nell&apos;app sul telefono, scrivi il codice di 6 cifre che vedi adesso:</p>
          <input style={campo} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7}
            value={codice} onChange={e => setCodice(e.target.value)} placeholder="000000" aria-label="Codice di 6 cifre" />
          {avviso}
          <button style={{ ...bottone, opacity: invio ? 0.6 : 1 }} disabled={invio}>{invio ? 'Verifico…' : 'Attiva e entra'}</button>
          <div style={{ borderTop: '1px solid #eee', marginTop: '18px', paddingTop: '14px' }}>
            <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5, margin: '0 0 8px' }}>Non l&apos;hai ancora aggiunta, o l&apos;app non ti dà il codice giusto? Fatti mostrare un codice QR nuovo. Se nell&apos;app c&apos;è già una voce MoovExpress, cancellala prima: con il codice nuovo non varrà più.</p>
            <button type="button" onClick={ricomincia} disabled={invio} style={{ width: '100%', padding: '10px', background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: invio ? 0.6 : 1 }}>Mostra un codice QR nuovo</button>
          </div>
          {!obbligatoria && <div style={{ textAlign: 'center', marginTop: '14px' }}>
            <a href={typeof window === 'undefined' ? '/' : destinazione()} style={{ fontSize: '13px', color: '#666' }}>Più tardi</a>
          </div>}
          {esci}
        </form>}
      </div>
    </div>
  )
}
