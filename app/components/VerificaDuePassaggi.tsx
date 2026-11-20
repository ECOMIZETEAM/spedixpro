'use client'
import { useEffect, useState } from 'react'
import CodiciRiserva from '@/app/components/CodiciRiserva'
import { useDialog } from '@/app/components/DialogProvider'

// VERIFICA IN DUE PASSAGGI: l'avviso in cima alle aree master e cliente, e la gestione dei metodi nelle
// impostazioni. Lo stato arriva da /api/accesso/stato (quali metodi, da quando e' obbligatoria).

type Metodi = { app: boolean; mail: boolean; riserva: number }
type Stato = { attiva: boolean; metodi?: Metodi; obbligatoriaDal: string | null; obbligatoria: boolean }

function useStatoVerifica(): [Stato | null, () => void] {
  const [s, setS] = useState<Stato | null>(null)
  const [giro, setGiro] = useState(0)
  useEffect(() => {
    fetch('/api/accesso/stato').then(r => r.ok ? r.json() : null).then(d => d && setS(d)).catch(() => null)
  }, [giro])
  return [s, () => setGiro(g => g + 1)]
}

function dataItaliana(iso: string): string {
  try { return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) } catch { return '' }
}

const qui = () => encodeURIComponent(window.location.pathname + window.location.search)
const verso = (aggiungi?: 'app' | 'mail') => `/accesso/verifica?${aggiungi ? `aggiungi=${aggiungi}&` : ''}dopo=${qui()}`

// L'avviso compare SOLO quando una data di obbligo e' fissata e la persona non l'ha ancora attivata:
// prima che Lorenzo decida la data nessuno vede niente di nuovo. "Piu' tardi" lo nasconde fino alla
// chiusura del browser, non per sempre: la data si avvicina.
export function AvvisoVerifica() {
  const [s] = useStatoVerifica()
  const [nascosto, setNascosto] = useState(false)
  useEffect(() => { try { setNascosto(sessionStorage.getItem('avviso-verifica') === 'no') } catch { /* niente */ } }, [])
  if (!s || s.attiva || !s.obbligatoriaDal || s.obbligatoria || nascosto) return null
  return (
    // le classi servono solo alla grafica nuova (grafica.css, .gx .v2p-*): con quella di oggi non hanno regole
    <div className="v2p-fascia" style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px 14px', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '13px', color: '#9a3412' }}>
      <span style={{ flex: '1 1 260px' }}>
        <b>Dal {dataItaliana(s.obbligatoriaDal)}</b> per entrare servirà anche un codice dall&apos;app sul telefono o via mail (verifica in due passaggi). Attivala ora: ci vogliono due minuti.
      </span>
      <a href="#" className="v2p-attiva" onClick={e => { e.preventDefault(); window.location.href = verso() }} style={{ background: '#f97316', color: '#fff', borderRadius: '6px', padding: '6px 12px', fontWeight: 700, textDecoration: 'none' }}>Attiva ora</a>
      <button type="button" className="v2p-dopo" onClick={() => { try { sessionStorage.setItem('avviso-verifica', 'no') } catch { /* niente */ } setNascosto(true) }}
        style={{ background: 'none', border: 'none', color: '#9a3412', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>Più tardi</button>
    </div>
  )
}

const riga = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0', borderTop: '1px solid #f0f0f0', flexWrap: 'wrap' as const }
const nomeMetodo = { fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }
const nota = { fontSize: '12px', color: '#777', marginTop: '2px' }
const pulsante = { background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '6px', padding: '6px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }
const pulsantePieno = { ...pulsante, background: '#f97316', color: '#fff', border: 'none' }

// Nelle impostazioni (accanto al cambio password): i metodi a scelta (scelta di Lorenzo del 17/11/2026).
// Almeno uno attivo, volendo tutti; i codici di riserva si rigenerano da qui.
export function SezioneVerifica() {
  const [s, ricarica] = useStatoVerifica()
  const dialog = useDialog()
  const [lavoro, setLavoro] = useState('')
  const [errore, setErrore] = useState('')
  const [codici, setCodici] = useState<string[] | null>(null)
  const m: Metodi = s?.metodi || { app: false, mail: false, riserva: 0 }
  const uno = (m.app ? 1 : 0) + (m.mail ? 1 : 0) === 1

  async function togli(metodo: 'app' | 'mail') {
    if (!await dialog.confirm({ title: metodo === 'app' ? 'Togliere l\'app sul telefono?' : 'Togliere il codice via mail?', message: 'Resterà l\'altro metodo: lo userai a ogni accesso.', confirmText: 'Togli', danger: true })) return
    setLavoro(metodo); setErrore('')
    const r = await fetch('/api/auth/verifica/togli', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metodo }) }).catch(() => null)
    const d = r ? await r.json().catch(() => ({})) : {}
    setLavoro('')
    if (!r?.ok) { setErrore(d.error || 'Non riesco a togliere il metodo, riprova.'); return }
    ricarica()
  }

  async function generaCodici() {
    if (m.riserva > 0 && !await dialog.confirm({ title: 'Generare codici nuovi?', message: 'I codici di riserva che hai adesso smetteranno di valere.', confirmText: 'Genera' })) return
    setLavoro('riserva'); setErrore('')
    const r = await fetch('/api/auth/verifica/riserva/genera', { method: 'POST' }).catch(() => null)
    const d = r ? await r.json().catch(() => ({})) : {}
    setLavoro('')
    if (!r?.ok || !Array.isArray(d.codici)) { setErrore(d.error || 'Non riesco a preparare i codici, riprova.'); return }
    setCodici(d.codici)
  }

  return (
    <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '16px', marginTop: '16px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Verifica in due passaggi</div>
      {!s ? <div style={{ fontSize: '13px', color: '#999' }}>…</div>
        : !s.attiva ? <>
            <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.5, marginBottom: '10px' }}>
              Oltre alla password, all&apos;accesso ti chiediamo un codice dall&apos;app sul telefono o via mail: chi scopre la tua password non può entrare.
              {s.obbligatoriaDal ? ` Dal ${dataItaliana(s.obbligatoriaDal)} sarà obbligatoria.` : ''}
            </div>
            <a href="#" onClick={e => { e.preventDefault(); window.location.href = verso() }} style={{ ...pulsantePieno, display: 'inline-block', textDecoration: 'none' }}>Attivala</a>
          </>
        : codici ? <CodiciRiserva codici={codici} testoFatto="Fatto" onFatto={() => { setCodici(null); ricarica() }} />
        : <>
            <div style={{ fontSize: '12.5px', color: '#555', lineHeight: 1.5, marginBottom: '6px' }}>A ogni accesso, dopo la password, basta uno dei metodi attivi. Puoi averli tutti e due.</div>
            <div style={riga}>
              <div>
                <div style={nomeMetodo}>App sul telefono {m.app && <span style={{ color: '#16a34a' }}>✓ attiva</span>}</div>
                <div style={nota}>Google Authenticator o Microsoft Authenticator.</div>
              </div>
              {m.app
                ? <button type="button" style={{ ...pulsante, opacity: uno ? 0.5 : 1 }} disabled={uno || !!lavoro} title={uno ? 'È il tuo unico metodo: aggiungi prima la mail' : ''} onClick={() => togli('app')}>{lavoro === 'app' ? 'Tolgo…' : 'Togli'}</button>
                : <button type="button" style={pulsantePieno} onClick={() => { window.location.href = verso('app') }}>Aggiungi</button>}
            </div>
            <div style={riga}>
              <div>
                <div style={nomeMetodo}>Codice via mail {m.mail && <span style={{ color: '#16a34a' }}>✓ attivo</span>}</div>
                <div style={nota}>Un codice di 6 cifre alla tua mail di accesso.</div>
              </div>
              {m.mail
                ? <button type="button" style={{ ...pulsante, opacity: uno ? 0.5 : 1 }} disabled={uno || !!lavoro} title={uno ? 'È il tuo unico metodo: aggiungi prima l\'app' : ''} onClick={() => togli('mail')}>{lavoro === 'mail' ? 'Tolgo…' : 'Togli'}</button>
                : <button type="button" style={pulsantePieno} onClick={() => { window.location.href = verso('mail') }}>Aggiungi</button>}
            </div>
            <div style={riga}>
              <div>
                <div style={nomeMetodo}>Codici di riserva</div>
                <div style={nota}>{m.riserva > 0 ? `Te ne restano ${m.riserva}: ognuno vale una volta sola.` : 'Non ne hai: generali e mettili da parte.'}</div>
              </div>
              <button type="button" style={pulsante} disabled={!!lavoro} onClick={generaCodici}>{lavoro === 'riserva' ? 'Preparo…' : m.riserva > 0 ? 'Genera nuovi' : 'Genera'}</button>
            </div>
            {errore && <div style={{ fontSize: '12.5px', color: '#dc2626', marginTop: '6px' }}>{errore}</div>}
          </>}
    </div>
  )
}
