'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import CodiciRiserva from '@/app/components/CodiciRiserva'

// PAGINA DEL CODICE (verifica in due passaggi). Ci arriva:
//  - chi ha messo la password e ha gia' attivato almeno un metodo: usa quello dell'ultima volta (l'app
//    o la mail), oppure un altro dei suoi, oppure un codice di riserva;
//  - chi non l'ha ancora attivata e ora e' obbligatoria (o vuole attivarla): sceglie l'app o la mail, la
//    attiva con il primo codice e riceve 10 codici di riserva;
//  - chi dalle impostazioni aggiunge un metodo (?aggiungi=app|mail).
// I metodi a scelta sono di Lorenzo (17/11/2026), la regola sta in scripts/verifica-metodi.sql e
// lib/verifica-metodi.ts. La pagina non e' sotto il middleware (altrimenti rimanderebbe a se stessa):
// legge da sola se c'e' una sessione.

type Fase = 'carico' | 'scegli' | 'attiva' | 'ripresa' | 'codice' | 'mail' | 'riserva' | 'mostra-riserva' | 'senza-sessione' | 'errore'
type Metodi = { app: boolean; mail: boolean; riserva: number }

// Chi ha scelto la mail e ricarica la pagina prima di scrivere il primo codice resta sulla mail: la
// scelta diventa definitiva solo al primo codice giusto, e fino ad allora la ricorda la scheda.
const CHIAVE_MAIL = 'mx-verifica-mail'
function mailInCorso(): boolean {
  try { return sessionStorage.getItem(CHIAVE_MAIL) === '1' } catch { return false }
}
function segnaMail(si: boolean) {
  try { if (si) sessionStorage.setItem(CHIAVE_MAIL, '1'); else sessionStorage.removeItem(CHIAVE_MAIL) } catch { /* niente */ }
}

// Il metodo usato l'ultima volta su questo browser: chi li ha tutti e due riparte da quello.
const CHIAVE_ULTIMO = 'mx-ultimo-metodo'
function ultimoMetodo(): string | null {
  try { return localStorage.getItem(CHIAVE_ULTIMO) } catch { return null }
}
function segnaUltimo(m: 'app' | 'mail') {
  try { localStorage.setItem(CHIAVE_ULTIMO, m) } catch { /* niente */ }
}

// Dalle impostazioni: aggiungere un metodo a quelli che si hanno gia'.
function daAggiungere(): 'app' | 'mail' | null {
  try {
    const a = new URLSearchParams(window.location.search).get('aggiungi')
    return a === 'app' || a === 'mail' ? a : null
  } catch { return null }
}

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
const linkBottone = { background: 'none', border: 'none', padding: 0, color: '#f97316', fontSize: '13px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }
const carta = { display: 'block', width: '100%', textAlign: 'left' as const, background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px 16px', cursor: 'pointer', marginTop: '10px' }

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
  const [metodi, setMetodi] = useState<Metodi>({ app: false, mail: false, riserva: 0 })
  const [aggiunta, setAggiunta] = useState<'app' | 'mail' | null>(null)
  const [mailA, setMailA] = useState('')                // l'indirizzo, mascherato
  const [attesa, setAttesa] = useState(0)               // secondi prima di poter chiedere un altro codice
  const [codiciNuovi, setCodiciNuovi] = useState<string[]>([])

  // Ha gia' almeno un metodo: e' un accesso (o un'aggiunta), non la prima attivazione.
  const attivata = metodi.app || metodi.mail

  function mostra(a: Attivazione) {
    setFactorId(a.id); setQr(a.qr); setSegreto(a.segreto); setUri(a.uri); setFase('attiva')
  }

  async function mandaCodiceMail() {
    setInvio(true); setErrore('')
    try {
      const r = await fetch('/api/auth/verifica/mail/invia', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErrore(d.error || 'La mail non è partita, riprova tra poco.'); return }
      setMailA(d.a || ''); setAttesa(60)
    } catch { setErrore('La mail non è partita, riprova tra poco.') } finally { setInvio(false) }
  }

  async function apriMail() {
    segnaMail(true); setCodice(''); setErrore(''); setFase('mail')
    await mandaCodiceMail()
  }

  // L'app: il codice per chi l'ha gia', altrimenti l'attivazione (ripresa, QR ricordato o QR nuovo).
  async function apriApp() {
    segnaMail(false); setCodice(''); setErrore('')
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) { setErrore('Non riesco a leggere la verifica del tuo account. Ricarica la pagina.'); setFase('errore'); return }
    const attivo = (data?.totp || []).find(f => f.status === 'verified')
    if (attivo) { setFactorId(attivo.id); setFase('codice'); return }
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
  }

  useEffect(() => {
    if (attesa <= 0) return
    const t = setTimeout(() => setAttesa(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [attesa])

  // Un avvio solo per pagina: due avvii insieme si cancellavano l'attivazione a vicenda (React in
  // sviluppo lo fa sempre, montando due volte; trovato provando questa pagina il 17/11/2026).
  const avviata = useRef(false)
  useEffect(() => {
    if (avviata.current) return
    avviata.current = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setFase('senza-sessione'); return }
      let m: Metodi = { app: false, mail: false, riserva: 0 }
      try {
        const st = await fetch('/api/accesso/stato').then(r => r.ok ? r.json() : null)
        setObbligatoria(!!st?.obbligatoria); setDal(st?.obbligatoriaDal || null)
        if (st?.metodi) m = st.metodi
      } catch { /* senza stato si mostra la versione prudente: niente "piu' tardi" */ setObbligatoria(true) }
      setMetodi(m)

      const aggiungi = daAggiungere()
      setAggiunta(aggiungi)
      if (aggiungi === 'mail') { await apriMail(); return }
      if (aggiungi === 'app') { await apriApp(); return }
      if (m.app || m.mail) {
        // Accesso: dal metodo usato l'ultima volta su questo browser, se c'e' ancora.
        if (m.mail && (ultimoMetodo() === 'mail' || !m.app)) { await apriMail(); return }
        await apriApp(); return
      }
      // Prima attivazione: chi l'aveva gia' iniziata riprende da li', gli altri scelgono.
      if (mailInCorso()) { await apriMail(); return }
      const { data } = await supabase.auth.mfa.listFactors()
      if (leggiAttivazione() || inSospeso(data?.all).length) { await apriApp(); return }
      setFase('scegli')
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

  // Dopo il codice giusto. Alla PRIMA attivazione si mostrano i 10 codici di riserva; se non si riescono
  // a preparare si entra lo stesso (si generano anche dalle impostazioni).
  async function fine(primaAttivazione: boolean) {
    salvaAttivazione(null); segnaMail(false)
    if (primaAttivazione) {
      const r = await fetch('/api/auth/verifica/riserva/genera', { method: 'POST' }).catch(() => null)
      const d = r ? await r.json().catch(() => ({})) : {}
      if (r?.ok && Array.isArray(d.codici)) { setCodiciNuovi(d.codici); setInvio(false); setFase('mostra-riserva'); return }
    }
    // Ricarica intera: il middleware rilegge la sessione, ora verificata, e porta alla pagina giusta.
    window.location.href = destinazione()
  }

  async function usaRiserva() {
    const pulito = codice.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (pulito.length !== 8) { setErrore('Il codice di riserva ha 8 caratteri, per esempio ABCD-EF23.'); return }
    setInvio(true); setErrore('')
    const r = await fetch('/api/auth/verifica/riserva/usa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codice: pulito }) }).catch(() => null)
    const d = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setInvio(false); setCodice(''); setErrore(d.error || 'Codice di riserva non valido.'); return }
    window.location.href = destinazione()
  }

  async function conferma(e: React.FormEvent) {
    e.preventDefault()
    if (fase === 'riserva') { await usaRiserva(); return }
    const pulito = codice.replace(/\D/g, '')
    if (pulito.length !== 6) { setErrore('Il codice ha 6 cifre.'); return }
    setInvio(true); setErrore('')

    if (fase === 'mail') {
      const r = await fetch('/api/auth/verifica/mail/conferma', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codice: pulito }) }).catch(() => null)
      const d = r ? await r.json().catch(() => ({})) : {}
      if (!r?.ok) { setInvio(false); setCodice(''); setErrore(d.error || 'Codice non valido, riprova.'); return }
      segnaUltimo('mail')
      await fine(!attivata)
      return
    }

    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: pulito })
    if (error) {
      setInvio(false); setCodice('')
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
    if (fase !== 'codice') {
      // App appena attivata: il portale la riconosce (scripts/verifica-metodi.sql). A chi ha anche la mail
      // un'app non riconosciuta non basterebbe per entrare.
      const r = await fetch('/api/auth/verifica/app/approva', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ factorId }) }).catch(() => null)
      if (!r?.ok) {
        const d = r ? await r.json().catch(() => ({})) : {}
        setInvio(false); setErrore(d.error || 'App attivata, ma non riesco a registrarla: riprova.'); return
      }
    }
    segnaUltimo('app')
    await fine(fase !== 'codice' && !attivata)
  }

  const intestazione = (
    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
      <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a' }}>Moov<span style={{ color: '#f97316' }}>Express</span></div>
      <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>Verifica in due passaggi</div>
    </div>
  )
  const avviso = errore && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px', margin: '12px 0 0', fontSize: '13px', color: '#dc2626' }}>{errore}</div>
  const esci = <div style={{ textAlign: 'center', marginTop: '18px' }}><a href="/api/auth/logout" style={{ fontSize: '13px', color: '#999' }}>Esci</a></div>
  const piuTardi = !obbligatoria && !attivata && <div style={{ textAlign: 'center', marginTop: '14px' }}>
    <a href={typeof window === 'undefined' ? '/' : destinazione()} style={{ fontSize: '13px', color: '#666' }}>Più tardi</a>
  </div>
  // In attivazione si torna alla scelta; in aggiunta si annulla e si torna alle impostazioni.
  const indietro = aggiunta
    ? <div style={{ textAlign: 'center', marginTop: '14px' }}><a href={typeof window === 'undefined' ? '/' : destinazione()} style={{ fontSize: '13px', color: '#666' }}>Annulla</a></div>
    : !attivata && <div style={{ textAlign: 'center', marginTop: '14px' }}>
        <button type="button" onClick={() => { segnaMail(false); setErrore(''); setCodice(''); setFase('scegli') }} style={linkBottone}>← Scegli un altro metodo</button>
      </div>
  // All'accesso, chi ha piu' metodi passa a un altro senza ricominciare.
  const altri = attivata && !aggiunta && (
    <div style={{ borderTop: '1px solid #eee', marginTop: '18px', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
      {fase !== 'codice' && metodi.app && <button type="button" style={linkBottone} onClick={() => apriApp()}>Usa l&apos;app sul telefono</button>}
      {fase !== 'mail' && metodi.mail && <button type="button" style={linkBottone} onClick={() => apriMail()}>Ricevi il codice via mail</button>}
      {fase !== 'riserva' && metodi.riserva > 0 && <button type="button" style={linkBottone} onClick={() => { setCodice(''); setErrore(''); setFase('riserva') }}>Usa un codice di riserva</button>}
      {!(metodi.app && metodi.mail) && metodi.riserva === 0 && <span style={{ fontSize: '12px', color: '#999', lineHeight: 1.5, textAlign: 'center' }}>Hai perso l&apos;accesso al tuo metodo? Chiedi a chi ti ha dato l&apos;accesso di azzerare la verifica.</span>}
    </div>
  )

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

        {fase === 'scegli' && <>
          {obbligatoria
            ? <p style={{ ...passo, fontWeight: 600 }}>Per entrare serve la verifica in due passaggi: dopo la password, un codice che solo tu puoi ricevere.</p>
            : <p style={{ ...passo, fontWeight: 600 }}>Proteggi l&apos;account: dopo la password ti chiederemo un codice che solo tu puoi ricevere.{dal ? ` Dal ${dataItaliana(dal)} sarà obbligatoria per tutti.` : ''}</p>}
          <p style={passo}>Scegli come riceverlo. Potrai aggiungere l&apos;altro modo quando vuoi, dalle impostazioni.</p>
          <button type="button" style={carta} disabled={invio} onClick={() => apriApp()}>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>App sul telefono</span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#16a34a', marginLeft: '8px' }}>CONSIGLIATA</span>
            <span style={{ display: 'block', fontSize: '12.5px', color: '#666', marginTop: '4px', lineHeight: 1.45 }}>Google Authenticator o Microsoft Authenticator: il codice cambia ogni 30 secondi e funziona anche senza rete.</span>
          </button>
          <button type="button" style={carta} disabled={invio} onClick={() => apriMail()}>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>Codice via mail</span>
            <span style={{ display: 'block', fontSize: '12.5px', color: '#666', marginTop: '4px', lineHeight: 1.45 }}>A ogni accesso ti mandiamo un codice di 6 cifre alla tua mail.</span>
          </button>
          {avviso}
          {piuTardi}
          {esci}
        </>}

        {fase === 'codice' && <form onSubmit={conferma}>
          <p style={passo}>Apri l&apos;app di autenticazione sul telefono e scrivi il codice di 6 cifre che vedi per <b>MoovExpress</b>.</p>
          <input style={campo} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7}
            value={codice} onChange={e => setCodice(e.target.value)} placeholder="000000" aria-label="Codice di 6 cifre" />
          {avviso}
          <button style={{ ...bottone, opacity: invio ? 0.6 : 1 }} disabled={invio}>{invio ? 'Verifico…' : 'Entra'}</button>
          {altri}
          {indietro}
          {esci}
        </form>}

        {fase === 'attiva' && <form onSubmit={conferma}>
          {!attivata && (obbligatoria
            ? <p style={{ ...passo, fontWeight: 600 }}>Per entrare serve la verifica in due passaggi: oltre alla password, un codice dall&apos;app sul telefono.</p>
            : <p style={{ ...passo, fontWeight: 600 }}>Proteggi l&apos;account: oltre alla password, all&apos;accesso servirà un codice dall&apos;app sul telefono.{dal ? ` Dal ${dataItaliana(dal)} sarà obbligatoria per tutti.` : ''}</p>)}
          {aggiunta && <p style={{ ...passo, fontWeight: 600 }}>Aggiungi l&apos;app sul telefono ai tuoi metodi.</p>}
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
          <button style={{ ...bottone, opacity: invio ? 0.6 : 1 }} disabled={invio}>{invio ? 'Verifico…' : aggiunta ? 'Aggiungi' : 'Attiva e entra'}</button>
          {indietro}
          {piuTardi}
          {esci}
        </form>}

        {fase === 'ripresa' && <form onSubmit={conferma}>
          <p style={{ ...passo, fontWeight: 600 }}>Hai già iniziato ad attivare l&apos;app sul telefono.</p>
          <p style={passo}>Se hai già aggiunto <b>MoovExpress</b> nell&apos;app, scrivi il codice di 6 cifre che vedi adesso:</p>
          <input style={campo} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7}
            value={codice} onChange={e => setCodice(e.target.value)} placeholder="000000" aria-label="Codice di 6 cifre" />
          {avviso}
          <button style={{ ...bottone, opacity: invio ? 0.6 : 1 }} disabled={invio}>{invio ? 'Verifico…' : aggiunta ? 'Aggiungi' : 'Attiva e entra'}</button>
          <div style={{ borderTop: '1px solid #eee', marginTop: '18px', paddingTop: '14px' }}>
            <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5, margin: '0 0 8px' }}>Non l&apos;hai ancora aggiunta, o l&apos;app non ti dà il codice giusto? Fatti mostrare un codice QR nuovo. Se nell&apos;app c&apos;è già una voce MoovExpress, cancellala prima: con il codice nuovo non varrà più.</p>
            <button type="button" onClick={ricomincia} disabled={invio} style={{ width: '100%', padding: '10px', background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: invio ? 0.6 : 1 }}>Mostra un codice QR nuovo</button>
          </div>
          {indietro}
          {piuTardi}
          {esci}
        </form>}

        {fase === 'mail' && <form onSubmit={conferma}>
          {!attivata && (obbligatoria
            ? <p style={{ ...passo, fontWeight: 600 }}>Per entrare serve la verifica in due passaggi: oltre alla password, un codice che ti mandiamo via mail a ogni accesso.</p>
            : <p style={{ ...passo, fontWeight: 600 }}>Proteggi l&apos;account: oltre alla password, a ogni accesso ti manderemo un codice via mail.{dal ? ` Dal ${dataItaliana(dal)} sarà obbligatoria per tutti.` : ''}</p>)}
          {aggiunta && <p style={{ ...passo, fontWeight: 600 }}>Aggiungi il codice via mail ai tuoi metodi.</p>}
          <p style={passo}>{mailA ? <>Ti abbiamo mandato un codice di 6 cifre a <b>{mailA}</b>.</> : 'Ti stiamo mandando un codice di 6 cifre via mail…'} Scrivilo qui: vale 10 minuti.</p>
          <input style={campo} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7}
            value={codice} onChange={e => setCodice(e.target.value)} placeholder="000000" aria-label="Codice di 6 cifre" />
          {avviso}
          <button style={{ ...bottone, opacity: invio ? 0.6 : 1 }} disabled={invio}>{invio ? 'Verifico…' : aggiunta ? 'Aggiungi' : attivata ? 'Entra' : 'Attiva e entra'}</button>
          <p style={{ fontSize: '12px', color: '#777', marginTop: '14px', lineHeight: 1.5, textAlign: 'center' }}>
            Non è arrivato? Guarda anche nella posta indesiderata.{' '}
            <button type="button" onClick={mandaCodiceMail} disabled={invio || attesa > 0} style={{ ...linkBottone, fontSize: '12px', color: attesa > 0 ? '#999' : '#f97316', cursor: attesa > 0 ? 'default' : 'pointer' }}>
              {attesa > 0 ? `Mandane un altro tra ${attesa} s` : 'Mandane un altro'}
            </button>
          </p>
          {altri}
          {indietro}
          {piuTardi}
          {esci}
        </form>}

        {fase === 'riserva' && <form onSubmit={conferma}>
          <p style={passo}>Scrivi uno dei tuoi <b>codici di riserva</b> (8 caratteri, per esempio ABCD-EF23). Ognuno vale una volta sola.</p>
          <input style={{ ...campo, letterSpacing: '3px', textTransform: 'uppercase' }} autoComplete="off" autoFocus maxLength={12}
            value={codice} onChange={e => setCodice(e.target.value)} placeholder="ABCD-EF23" aria-label="Codice di riserva" />
          {avviso}
          <button style={{ ...bottone, opacity: invio ? 0.6 : 1 }} disabled={invio}>{invio ? 'Verifico…' : 'Entra'}</button>
          {altri}
          {esci}
        </form>}

        {fase === 'mostra-riserva' && <CodiciRiserva codici={codiciNuovi} onFatto={() => { window.location.href = destinazione() }} />}
      </div>
    </div>
  )
}
