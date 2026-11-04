'use client'
import { useEffect, useState } from 'react'

// VERIFICA IN DUE PASSAGGI: l'avviso in cima alle aree master e cliente, e la voce nelle impostazioni.
// Lo stato arriva da /api/accesso/stato (attiva? da quando e' obbligatoria?).

type Stato = { attiva: boolean; obbligatoriaDal: string | null; obbligatoria: boolean }

function useStatoVerifica(): Stato | null {
  const [s, setS] = useState<Stato | null>(null)
  useEffect(() => {
    fetch('/api/accesso/stato').then(r => r.ok ? r.json() : null).then(d => d && setS(d)).catch(() => null)
  }, [])
  return s
}

function dataItaliana(iso: string): string {
  try { return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) } catch { return '' }
}

const verso = () => `/accesso/verifica?dopo=${encodeURIComponent(window.location.pathname + window.location.search)}`

// L'avviso compare SOLO quando una data di obbligo e' fissata e la persona non l'ha ancora attivata:
// prima che Lorenzo decida la data nessuno vede niente di nuovo. "Piu' tardi" lo nasconde fino alla
// chiusura del browser, non per sempre: la data si avvicina.
export function AvvisoVerifica() {
  const s = useStatoVerifica()
  const [nascosto, setNascosto] = useState(false)
  useEffect(() => { try { setNascosto(sessionStorage.getItem('avviso-verifica') === 'no') } catch { /* niente */ } }, [])
  if (!s || s.attiva || !s.obbligatoriaDal || s.obbligatoria || nascosto) return null
  return (
    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px 14px', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '13px', color: '#9a3412' }}>
      <span style={{ flex: '1 1 260px' }}>
        <b>Dal {dataItaliana(s.obbligatoriaDal)}</b> per entrare servirà anche un codice dall&apos;app sul telefono (verifica in due passaggi). Attivala ora: ci vogliono due minuti.
      </span>
      <a href="#" onClick={e => { e.preventDefault(); window.location.href = verso() }} style={{ background: '#f97316', color: '#fff', borderRadius: '6px', padding: '6px 12px', fontWeight: 700, textDecoration: 'none' }}>Attiva ora</a>
      <button type="button" onClick={() => { try { sessionStorage.setItem('avviso-verifica', 'no') } catch { /* niente */ } setNascosto(true) }}
        style={{ background: 'none', border: 'none', color: '#9a3412', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>Più tardi</button>
    </div>
  )
}

// Nelle impostazioni (accanto al cambio password): chiunque la puo' attivare quando vuole.
export function SezioneVerifica() {
  const s = useStatoVerifica()
  return (
    <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '16px', marginTop: '16px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Verifica in due passaggi</div>
      {!s ? <div style={{ fontSize: '13px', color: '#999' }}>…</div>
        : s.attiva ? <div style={{ fontSize: '13px', color: '#16a34a' }}>✓ Attiva: a ogni accesso, dopo la password, ti chiediamo il codice dell&apos;app sul telefono.</div>
        : <>
            <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.5, marginBottom: '10px' }}>
              Oltre alla password, all&apos;accesso ti chiediamo un codice dall&apos;app sul telefono: chi scopre la tua password non può entrare.
              {s.obbligatoriaDal ? ` Dal ${dataItaliana(s.obbligatoriaDal)} sarà obbligatoria.` : ''}
            </div>
            <a href="#" onClick={e => { e.preventDefault(); window.location.href = verso() }}
              style={{ display: 'inline-block', background: '#f97316', color: '#fff', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>Attivala</a>
          </>}
    </div>
  )
}
