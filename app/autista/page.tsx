'use client'
import { useState, useEffect, useRef } from 'react'

// LA SCHERMATA DELL'AUTISTA.
//
// Una cosa sola: i pacchi da consegnare oggi. Si tocca il pacco, si dice com'e' andata, si passa
// al prossimo. Niente prezzi, niente clienti, niente conti — a chi guida non servono, e la
// schermata si usa con una mano sola mentre si tiene un pacco con l'altra.
//
// La lettura col codice a barre c'e' dove il telefono la sa fare (Android): dove non c'e', si
// tocca il pacco dall'elenco, che e' comunque il modo piu' veloce quando il pacco ce l'hai in
// mano e sai a chi va.

const ARANCIO = '#f97316'
const NERO = '#1a1a1a'

type Sped = {
  id: string; numero: string; stato: string
  dest_nome: string; dest_indirizzo: string; dest_cap: string; dest_citta: string
  dest_provincia?: string; dest_telefono?: string
  colli: number; contrassegno: number; note?: string
}

export default function AutistaPage() {
  const [dati, setDati] = useState<any>(null)
  const [aperta, setAperta] = useState<Sped | null>(null)
  const [inCorso, setInCorso] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [scanner, setScanner] = useState(false)

  async function carica() {
    const d = await fetch('/api/autista').then(r => r.json()).catch(() => null)
    setDati(d || { consegne: [], fatte: [] })
  }
  useEffect(() => { carica() }, [])

  async function esito(s: Sped, tipo: 'consegna' | 'tentata') {
    setInCorso(true); setMsg(null)
    try {
      const r = await fetch('/api/autista', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ldv: s.numero, tipo }),
      })
      const d = await r.json()
      if (d?.error) setMsg({ t: 'err', x: d.error })
      else if (d?.ripetuta) setMsg({ t: 'ok', x: `${s.numero} era già segnata` })
      else setMsg({ t: 'ok', x: tipo === 'consegna' ? `${s.numero} consegnata` : `${s.numero}: destinatario assente` })
      setAperta(null)
      carica()
    } catch { setMsg({ t: 'err', x: 'Nessuna linea: riprova quando torna il segnale' }) }
    setInCorso(false)
  }

  if (!dati) return <Centro testo="Carico le consegne…" />

  if (dati.error) return (
    <Centro testo={dati.error}>
      <a href="/api/auth/logout" style={{ color: ARANCIO, fontSize: '14px', fontWeight: 700, textDecoration: 'none' }}>Esci</a>
    </Centro>
  )

  const consegne: Sped[] = dati.consegne || []
  const fatte = dati.fatte || []
  const consegnate = fatte.filter((f: any) => f.tipo === 'consegna').length

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', paddingBottom: '30px' }}>
      {/* testata */}
      <div style={{ background: NERO, color: '#fff', padding: '16px 18px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 800 }}>{dati.autista || 'Consegne'}</div>
            <div style={{ fontSize: '12.5px', color: '#a1a1aa' }}>
              {dati.zona ? `Zona ${dati.zona}` : 'Tutte le zone'} · {consegne.length} da fare · {consegnate} fatte oggi
            </div>
          </div>
          <button onClick={() => setScanner(s => !s)}
            style={{ background: scanner ? '#fff' : ARANCIO, color: scanner ? NERO : '#fff', border: 'none', borderRadius: '10px', padding: '11px 15px', fontSize: '14px', fontWeight: 700 }}>
            {scanner ? 'Chiudi' : 'Scansiona'}
          </button>
        </div>
      </div>

      {msg && (
        <div style={{
          margin: '12px 14px 0', padding: '13px 15px', borderRadius: '10px', fontSize: '14px', fontWeight: 600,
          background: msg.t === 'ok' ? '#dcfce7' : '#fee2e2', color: msg.t === 'ok' ? '#166534' : '#991b1b',
        }}>{msg.x}</div>
      )}

      {scanner && <Lettore onLetto={(codice) => {
        const s = consegne.find(c => c.numero.toUpperCase() === codice.toUpperCase())
        if (s) { setAperta(s); setScanner(false) }
        else setMsg({ t: 'err', x: `${codice} non è fra le tue consegne` })
      }} />}

      {dati.senzaAnagrafica && (
        <div style={{ margin: '12px 14px 0', padding: '13px 15px', borderRadius: '10px', background: '#fef3c7', color: '#92400e', fontSize: '13.5px' }}>
          Il tuo profilo autista non è ancora collegato: le consegne che segni non finiranno nel
          conteggio della giornata. Fallo sistemare in sede.
        </div>
      )}

      {/* elenco */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {!consegne.length ? (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '40px 20px', textAlign: 'center', color: '#71717a', fontSize: '14px' }}>
            {consegnate > 0 ? 'Finito. Buona giornata.' : 'Nessun pacco da consegnare.'}
          </div>
        ) : consegne.map(s => (
          <button key={s.id} onClick={() => setAperta(s)}
            style={{
              background: '#fff', border: 'none', borderRadius: '12px', padding: '14px 15px', textAlign: 'left',
              boxShadow: '0 1px 3px rgba(0,0,0,.08)', display: 'block', width: '100%',
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: NERO }}>{s.dest_nome}</div>
                <div style={{ fontSize: '14px', color: '#3f3f46', marginTop: '3px' }}>{s.dest_indirizzo}</div>
                <div style={{ fontSize: '13.5px', color: '#71717a' }}>{s.dest_cap} {s.dest_citta}</div>
              </div>
              {Number(s.contrassegno) > 0 && (
                <div style={{ background: NERO, color: '#fff', borderRadius: '8px', padding: '5px 9px', fontSize: '13px', fontWeight: 800, whiteSpace: 'nowrap' }}>
                  € {Number(s.contrassegno).toFixed(2)}
                </div>
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#a1a1aa', marginTop: '6px' }}>
              {s.numero}{s.colli > 1 ? ` · ${s.colli} colli` : ''}
            </div>
          </button>
        ))}
      </div>

      {/* la scheda del pacco: quello che serve mentre si suona al citofono */}
      {aperta && (
        <div onClick={() => !inCorso && setAperta(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', width: '100%', borderRadius: '18px 18px 0 0', padding: '20px 18px 26px', maxHeight: '86dvh', overflowY: 'auto' }}>
            <div style={{ width: '40px', height: '4px', background: '#d4d4d8', borderRadius: '2px', margin: '0 auto 16px' }} />
            <div style={{ fontSize: '19px', fontWeight: 800, color: NERO }}>{aperta.dest_nome}</div>
            <div style={{ fontSize: '15px', color: '#3f3f46', marginTop: '4px' }}>{aperta.dest_indirizzo}</div>
            <div style={{ fontSize: '15px', color: '#3f3f46' }}>{aperta.dest_cap} {aperta.dest_citta} {aperta.dest_provincia ? `(${aperta.dest_provincia})` : ''}</div>
            <div style={{ fontSize: '12.5px', color: '#a1a1aa', marginTop: '8px' }}>{aperta.numero} · {aperta.colli} {aperta.colli === 1 ? 'collo' : 'colli'}</div>

            {Number(aperta.contrassegno) > 0 && (
              <div style={{ background: NERO, color: '#fff', borderRadius: '12px', padding: '14px 16px', marginTop: '14px' }}>
                <div style={{ fontSize: '12px', color: '#a1a1aa', fontWeight: 700, textTransform: 'uppercase' }}>Da incassare</div>
                <div style={{ fontSize: '26px', fontWeight: 800 }}>€ {Number(aperta.contrassegno).toFixed(2)}</div>
              </div>
            )}
            {aperta.note && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: '10px', padding: '11px 13px', marginTop: '12px', fontSize: '13.5px' }}>
                {aperta.note}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
              {aperta.dest_telefono && (
                <a href={`tel:${aperta.dest_telefono}`}
                  style={{ flex: 1, textAlign: 'center', background: '#fff', border: `1px solid #d4d4d8`, color: NERO, borderRadius: '10px', padding: '13px', fontSize: '14.5px', fontWeight: 700, textDecoration: 'none' }}>
                  Chiama
                </a>
              )}
              <a href={`https://maps.google.com/?q=${encodeURIComponent(`${aperta.dest_indirizzo} ${aperta.dest_cap} ${aperta.dest_citta}`)}`}
                target="_blank" rel="noreferrer"
                style={{ flex: 1, textAlign: 'center', background: '#fff', border: '1px solid #d4d4d8', color: NERO, borderRadius: '10px', padding: '13px', fontSize: '14.5px', fontWeight: 700, textDecoration: 'none' }}>
                Naviga
              </a>
            </div>

            <button disabled={inCorso} onClick={() => esito(aperta, 'consegna')}
              style={{ width: '100%', marginTop: '16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '12px', padding: '17px', fontSize: '16.5px', fontWeight: 800 }}>
              {inCorso ? '…' : 'Consegnato'}
            </button>
            <button disabled={inCorso} onClick={() => esito(aperta, 'tentata')}
              style={{ width: '100%', marginTop: '9px', background: '#fff', color: '#b45309', border: '1px solid #fed7aa', borderRadius: '12px', padding: '15px', fontSize: '15px', fontWeight: 700 }}>
              Destinatario assente
            </button>
            <button disabled={inCorso} onClick={() => setAperta(null)}
              style={{ width: '100%', marginTop: '9px', background: 'none', color: '#71717a', border: 'none', padding: '12px', fontSize: '14px', fontWeight: 600 }}>
              Chiudi
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// LETTURA DEL CODICE A BARRE.
// Dove il telefono la sa fare da solo si usa quella: nessuna libreria da scaricare, nessun
// permesso in piu' di quello della fotocamera. Dove non c'e' (oggi iPhone) si scrive il numero,
// che con l'elenco davanti resta comunque piu' veloce che cercare.
function Lettore({ onLetto }: { onLetto: (codice: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [errore, setErrore] = useState('')
  const [manuale, setManuale] = useState('')
  const [supportato, setSupportato] = useState(true)

  useEffect(() => {
    const D = (window as any).BarcodeDetector
    if (!D) { setSupportato(false); return }
    let stream: MediaStream | null = null
    let fermo = false
    const detector = new D({ formats: ['code_128', 'code_39', 'ean_13', 'qr_code'] })
      ; (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          if (video.current) { video.current.srcObject = stream; await video.current.play() }
          const cerca = async () => {
            if (fermo || !video.current) return
            try {
              const trovati = await detector.detect(video.current)
              if (trovati?.length) {
                const v = String(trovati[0].rawValue || '').trim()
                if (v) { fermo = true; onLetto(v); return }
              }
            } catch { /* fotogramma non leggibile: si riprova col prossimo */ }
            requestAnimationFrame(cerca)
          }
          requestAnimationFrame(cerca)
        } catch {
          setErrore('Non riesco ad accedere alla fotocamera. Controlla il permesso nel telefono.')
        }
      })()
    return () => { fermo = true; stream?.getTracks().forEach(t => t.stop()) }
  }, [onLetto])

  return (
    <div style={{ margin: '12px 14px 0', background: '#000', borderRadius: '14px', overflow: 'hidden' }}>
      {supportato && !errore && (
        <video ref={video} playsInline muted style={{ width: '100%', display: 'block', maxHeight: '46dvh', objectFit: 'cover' }} />
      )}
      <div style={{ padding: '13px 15px', background: '#18181b' }}>
        {errore && <div style={{ color: '#fca5a5', fontSize: '13.5px', marginBottom: '10px' }}>{errore}</div>}
        {!supportato && <div style={{ color: '#a1a1aa', fontSize: '13.5px', marginBottom: '10px' }}>
          Questo telefono non legge i codici dalla fotocamera: scrivi il numero.
        </div>}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input value={manuale} onChange={e => setManuale(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && manuale.trim()) onLetto(manuale.trim()) }}
            placeholder="Numero della lettera di vettura"
            style={{ flex: 1, padding: '12px 13px', fontSize: '15px', borderRadius: '9px', border: 'none', outline: 'none' }} />
          <button onClick={() => manuale.trim() && onLetto(manuale.trim())}
            style={{ background: ARANCIO, color: '#fff', border: 'none', borderRadius: '9px', padding: '12px 16px', fontSize: '14.5px', fontWeight: 700 }}>
            Cerca
          </button>
        </div>
      </div>
    </div>
  )
}

function Centro({ testo, children }: { testo: string; children?: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '30px', textAlign: 'center' }}>
      <div style={{ fontSize: '15px', color: '#52525b' }}>{testo}</div>
      {children}
    </div>
  )
}
