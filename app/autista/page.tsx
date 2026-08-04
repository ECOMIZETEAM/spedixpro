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

// I motivi per cui una consegna non riesce, con quello che comportano davvero. Dirlo all'autista
// mentre sceglie serve: "assente" e "indirizzo sbagliato" non sono la stessa cosa, e il pacco fa
// due strade diverse.
const MOTIVI: [string, string, string][] = [
  ['assente', 'Non c’era nessuno', 'Si riprova il giorno lavorativo dopo'],
  ['indirizzo', 'Indirizzo sbagliato', 'Si aspettano istruzioni dal mittente'],
  ['rifiutata', 'L’hanno rifiutata', 'Il pacco non lo vogliono'],
  ['sconosciuto', 'Destinatario sconosciuto', 'Si aspettano istruzioni dal mittente'],
  ['non_riuscita', 'Altro motivo', 'Si riprova il giorno lavorativo dopo'],
]

export default function AutistaPage() {
  const [dati, setDati] = useState<any>(null)
  const [aperta, setAperta] = useState<Sped | null>(null)
  const [passo, setPasso] = useState<'scheda' | 'consegna' | 'motivo'>('scheda')
  const [inCorso, setInCorso] = useState(false)
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [scanner, setScanner] = useState(false)

  async function carica() {
    const d = await fetch('/api/autista').then(r => r.json()).catch(() => null)
    setDati(d || { consegne: [], fatte: [] })
  }
  useEffect(() => { carica() }, [])

  // Dove sei quando segni la consegna. Non si chiede il permesso a freddo: si prova, e se il
  // telefono dice di no si va avanti lo stesso — una firma senza coordinate vale comunque.
  function posizione(): Promise<{ lat?: number; lng?: number }> {
    return new Promise(risolvi => {
      if (!navigator.geolocation) return risolvi({})
      const stop = setTimeout(() => risolvi({}), 4000)
      navigator.geolocation.getCurrentPosition(
        p => { clearTimeout(stop); risolvi({ lat: p.coords.latitude, lng: p.coords.longitude }) },
        () => { clearTimeout(stop); risolvi({}) },
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
      )
    })
  }

  async function esito(s: Sped, tipo: 'consegna' | 'tentata', extra: any = {}) {
    setInCorso(true); setMsg(null)
    try {
      const dove = await posizione()
      const r = await fetch('/api/autista', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ldv: s.numero, tipo, ...dove, ...extra }),
      })
      const d = await r.json()
      if (d?.error) setMsg({ t: 'err', x: d.error })
      else if (d?.ripetuta) setMsg({ t: 'ok', x: `${s.numero} era già segnata` })
      else setMsg({ t: 'ok', x: `${s.numero}: ${d.descrizione || 'registrata'}` })
      setAperta(null); setPasso('scheda')
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
        if (s) { setAperta(s); setPasso('scheda'); setScanner(false) }
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
          <button key={s.id} onClick={() => { setAperta(s); setPasso('scheda') }}
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

            {passo === 'scheda' && (<>
              <button disabled={inCorso} onClick={() => setPasso('consegna')}
                style={{ width: '100%', marginTop: '16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '12px', padding: '17px', fontSize: '16.5px', fontWeight: 800 }}>
                Consegnato
              </button>
              <button disabled={inCorso} onClick={() => setPasso('motivo')}
                style={{ width: '100%', marginTop: '9px', background: '#fff', color: '#b45309', border: '1px solid #fed7aa', borderRadius: '12px', padding: '15px', fontSize: '15px', fontWeight: 700 }}>
                Non sono riuscito a consegnare
              </button>
              <button disabled={inCorso} onClick={() => setAperta(null)}
                style={{ width: '100%', marginTop: '9px', background: 'none', color: '#71717a', border: 'none', padding: '12px', fontSize: '14px', fontWeight: 600 }}>
                Chiudi
              </button>
            </>)}

            {passo === 'consegna' && (
              <Consegna sped={aperta} inCorso={inCorso}
                onIndietro={() => setPasso('scheda')}
                onConferma={(dati) => esito(aperta, 'consegna', dati)} />
            )}

            {passo === 'motivo' && (<>
              <div style={{ fontSize: '13px', fontWeight: 700, color: NERO, margin: '18px 0 8px' }}>Cos’è successo?</div>
              {MOTIVI.map(([k, l, d]) => (
                <button key={k} disabled={inCorso} onClick={() => esito(aperta, 'tentata', { motivo: k })}
                  style={{ width: '100%', marginBottom: '8px', background: '#fff', border: '1px solid #e4e4e7', borderRadius: '12px', padding: '13px 15px', textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: '15px', fontWeight: 700, color: NERO }}>{l}</span>
                  <span style={{ display: 'block', fontSize: '12.5px', color: '#71717a', marginTop: '2px' }}>{d}</span>
                </button>
              ))}
              <button disabled={inCorso} onClick={() => setPasso('scheda')}
                style={{ width: '100%', marginTop: '4px', background: 'none', color: '#71717a', border: 'none', padding: '12px', fontSize: '14px', fontWeight: 600 }}>
                Indietro
              </button>
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}

// LA PROVA DI CONSEGNA.
//
// Senza, una consegna e' una parola contro un'altra: quando il destinatario dice che non ha
// ricevuto niente non c'e' niente da mostrargli, e su un contrassegno vuol dire discutere di soldi
// senza carte. Due modi, quelli che si usano davvero: la FIRMA sullo schermo quando qualcuno c'e',
// la FOTO quando il pacco si lascia in un posto concordato.
//
// Non e' obbligatoria: se il telefono fa i capricci si consegna lo stesso. Bloccare l'autista
// sulla porta di casa sarebbe peggio del non avere la firma.
function Consegna({ sped, inCorso, onIndietro, onConferma }: {
  sped: Sped; inCorso: boolean; onIndietro: () => void; onConferma: (dati: any) => void
}) {
  const [modo, setModo] = useState<'firma' | 'foto' | null>(null)
  const [ricevente, setRicevente] = useState('')
  const [immagine, setImmagine] = useState<string | null>(null)
  const tela = useRef<HTMLCanvasElement>(null)
  const disegna = useRef(false)
  const scritto = useRef(false)

  // Il foglio su cui si firma. Si dimensiona sul telefono vero, altrimenti su schermi piccoli la
  // firma esce spostata rispetto al dito.
  useEffect(() => {
    if (modo !== 'firma') return
    const c = tela.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = r.width * dpr; c.height = r.height * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'
    scritto.current = false
  }, [modo])

  function punto(e: any) {
    const c = tela.current!, r = c.getBoundingClientRect()
    const t = e.touches?.[0] || e
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }
  function giu(e: any) { e.preventDefault(); disegna.current = true; const ctx = tela.current!.getContext('2d')!; const p = punto(e); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
  function muovi(e: any) { if (!disegna.current) return; e.preventDefault(); const ctx = tela.current!.getContext('2d')!; const p = punto(e); ctx.lineTo(p.x, p.y); ctx.stroke(); scritto.current = true }
  function su() { disegna.current = false }
  function pulisci() { const c = tela.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); scritto.current = false }

  // La foto si rimpicciolisce PRIMA di partire: dal telefono esce da 4 mega, e su una linea che in
  // strada e' quella che e' non arriverebbe mai.
  async function prendiFoto(file: File) {
    const bitmap = await createImageBitmap(file)
    const lato = 1000
    const scala = Math.min(1, lato / Math.max(bitmap.width, bitmap.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bitmap.width * scala); c.height = Math.round(bitmap.height * scala)
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height)
    setImmagine(c.toDataURL('image/jpeg', 0.72))
  }

  function conferma() {
    let pod: string | null = immagine
    if (modo === 'firma' && tela.current && scritto.current) pod = tela.current.toDataURL('image/png')
    onConferma({ ricevente: ricevente.trim() || null, podTipo: pod ? modo : null, pod })
  }

  const eti = { display: 'block', fontSize: '12px', color: '#71717a', fontWeight: 600, marginBottom: '5px' }

  return (
    <div style={{ marginTop: '16px' }}>
      <label style={eti as any}>Chi ha ritirato</label>
      <input value={ricevente} onChange={e => setRicevente(e.target.value)}
        placeholder="nome di chi firma o ritira"
        style={{ width: '100%', padding: '13px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d4d4d8', outline: 'none' }} />

      <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}>
        {([['firma', 'Firma'], ['foto', 'Foto']] as const).map(([k, l]) => (
          <button key={k} onClick={() => { setModo(k); setImmagine(null) }}
            style={{
              flex: 1, padding: '13px', borderRadius: '10px', fontSize: '15px', fontWeight: 700,
              border: modo === k ? `2px solid ${ARANCIO}` : '1px solid #d4d4d8',
              background: modo === k ? '#fff7ed' : '#fff', color: NERO,
            }}>{l}</button>
        ))}
      </div>

      {modo === 'firma' && (
        <div>
          <canvas ref={tela}
            onMouseDown={giu} onMouseMove={muovi} onMouseUp={su} onMouseLeave={su}
            onTouchStart={giu} onTouchMove={muovi} onTouchEnd={su}
            style={{ width: '100%', height: '170px', background: '#fff', border: '1px dashed #a1a1aa', borderRadius: '10px', touchAction: 'none', display: 'block' }} />
          <button onClick={pulisci} style={{ background: 'none', border: 'none', color: '#71717a', fontSize: '13px', fontWeight: 600, padding: '8px 0' }}>
            Cancella e rifai
          </button>
        </div>
      )}

      {modo === 'foto' && (
        <div>
          {immagine
            ? <img src={immagine} alt="" style={{ width: '100%', borderRadius: '10px', display: 'block' }} />
            : <label style={{ display: 'block', textAlign: 'center', padding: '30px', border: '1px dashed #a1a1aa', borderRadius: '10px', color: '#52525b', fontSize: '14.5px', fontWeight: 600 }}>
              Scatta la foto del pacco
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) prendiFoto(f) }} />
            </label>}
          {immagine && <button onClick={() => setImmagine(null)} style={{ background: 'none', border: 'none', color: '#71717a', fontSize: '13px', fontWeight: 600, padding: '8px 0' }}>Rifai la foto</button>}
        </div>
      )}

      <button disabled={inCorso} onClick={conferma}
        style={{ width: '100%', marginTop: '14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '12px', padding: '17px', fontSize: '16.5px', fontWeight: 800 }}>
        {inCorso ? '…' : 'Conferma consegna'}
      </button>
      <button disabled={inCorso} onClick={onIndietro}
        style={{ width: '100%', marginTop: '8px', background: 'none', color: '#71717a', border: 'none', padding: '12px', fontSize: '14px', fontWeight: 600 }}>
        Indietro
      </button>
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

  // LEGGERE I CODICI DEVE FUNZIONARE ANCHE SU IPHONE.
  //
  // Prima si usava solo BarcodeDetector, che e' una funzione del browser: su Android c'e', su
  // Safari iOS NO. Quando mancava, la schermata si arrendeva e diceva "questo telefono non legge i
  // codici: scrivi il numero" — cioe' TUTTI gli autisti con iPhone hanno sempre digitato a mano,
  // consegna per consegna. Non era un telefono difettoso: era una scelta mia che non copriva i
  // telefoni che usano davvero.
  //
  // Ora: dove BarcodeDetector c'e' si usa quello, che e' nativo e piu' rapido; dove non c'e' si
  // decodifica l'immagine da soli. La fotocamera si apre allo stesso modo, cambia solo chi legge.
  useEffect(() => {
    let stream: MediaStream | null = null
    let fermo = false
    let controlli: { stop: () => void } | null = null

    const avvia = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (video.current) { video.current.srcObject = stream; await video.current.play() }
      } catch {
        setErrore('Non riesco ad accedere alla fotocamera. Controlla il permesso nel telefono.')
        return
      }

      const D = (window as any).BarcodeDetector
      if (D) {
        const detector = new D({ formats: ['code_128', 'code_39', 'ean_13', 'qr_code'] })
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
        return
      }

      // Il ripiego che fa funzionare gli iPhone. Si carica solo qui, quando serve davvero: e' un
      // pezzo pesante e non ha senso farlo scaricare a chi ha gia' il lettore nativo.
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const lettore = new BrowserMultiFormatReader()
        controlli = await lettore.decodeFromVideoElement(video.current!, (risultato) => {
          if (fermo || !risultato) return
          const v = String(risultato.getText() || '').trim()
          if (v) { fermo = true; controlli?.stop(); onLetto(v) }
        })
      } catch {
        // Nemmeno il ripiego parte: resta la scrittura a mano, che ora almeno si vede.
        setSupportato(false)
      }
    }
    avvia()

    return () => { fermo = true; controlli?.stop(); stream?.getTracks().forEach(t => t.stop()) }
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
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            // NERO SU NERO. Il campo non aveva ne' sfondo ne' colore del testo: su un contenitore
            // scuro il telefono in modalita' scura lo disegnava scuro con testo scuro, e l'autista
            // non vedeva quello che stava scrivendo. In cabina, con il pacco in mano, e' un
            // problema serio. I colori adesso sono dichiarati e non dipendono dal telefono:
            // colorScheme lo tiene chiaro anche su iOS, e WebkitTextFillColor serve perche' Safari
            // ignora `color` sugli input in modalita' scura.
            style={{
              flex: 1, padding: '12px 13px', fontSize: '16px', borderRadius: '9px',
              border: 'none', outline: 'none',
              background: '#fff', color: '#18181b', WebkitTextFillColor: '#18181b',
              colorScheme: 'light',
            }} />
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
