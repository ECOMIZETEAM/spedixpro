'use client'
import { useEffect, useRef, useState } from 'react'

// IL LETTORE DI CODICI A BARRE DEL PORTALE: uno solo, per l'autista e per i resi.
//
// LEGGERE I CODICI DEVE FUNZIONARE ANCHE SU IPHONE.
// BarcodeDetector e' una funzione del browser: su Android c'e', su Safari iOS NO. Quando mancava, la
// schermata dell'autista si arrendeva e diceva "questo telefono non legge i codici: scrivi il numero" —
// cioe' TUTTI gli autisti con iPhone hanno sempre digitato a mano, consegna per consegna.
// Ora: dove BarcodeDetector c'e' si usa quello, che e' nativo e piu' rapido; dove non c'e' si decodifica
// l'immagine da soli (zxing). La fotocamera si apre allo stesso modo, cambia solo chi legge.
// Nell'app (Capacitor) e' la stessa pagina: i permessi della fotocamera sono gia' dichiarati nel guscio
// iOS (NSCameraUsageDescription) e Android (CAMERA), niente da ripubblicare sugli store.
//
// Un'etichetta ha spesso piu' codici (SDA: LDV, CAP e due DataMatrix): BarcodeDetector li restituisce
// tutti, e chi usa il lettore riceve l'elenco intero per scegliere quello che riconosce.

// Code128 (Poste, SDA, BRT, UPS), ITF e Code39 (alcune etichette GLS e BRT), DataMatrix e QR (i 2D di
// Poste e SDA), EAN per gli imballi.
const FORMATI = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'pdf417', 'aztec']

// Lo stesso codice letto di nuovo entro questo tempo non si ripete: la fotocamera lo vede in ogni fotogramma.
const PAUSA_STESSO_CODICE_MS = 3000

// Le zone del fotogramma che il ripiego (zxing) prova a turno, dritte e girate di 90 gradi: l'intero, poi
// le meta' (un po' sovrapposte, per non tagliare un codice a cavallo). Vedi sotto, "UNA ZONA PER VOLTA".
const ZONE: [number, number, number, number][] = [[0, 0, 1, 1], [0, 0, 0.55, 1], [0.45, 0, 0.55, 1], [0, 0, 1, 0.55], [0, 0.45, 1, 0.55]]

type Props = {
  onCodici: (codici: string[]) => void
  // true = dopo una lettura continua a cercare (i resi, un pacco dopo l'altro);
  // false = si ferma alla prima (l'autista, che apre una consegna).
  continuo?: boolean
  // I codici che chi usa il lettore non vuole (per i resi: il CAP dell'etichetta, le letture troppo
  // corte per essere una LDV). Non arrivano a onCodici e il lettore continua a cercare.
  scarta?: (codice: string) => boolean
  // Cosa dire quando la fotocamera vede solo codici scartati (es. il CAP): di solito il codice giusto e'
  // troppo lontano per distinguerne le barre sottili.
  avvisoScartati?: string
  altezzaMax?: string
}

export default function LettoreCodici({ onCodici, continuo = false, scarta, avvisoScartati, altezzaMax = '46dvh' }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const traccia = useRef<MediaStreamTrack | null>(null)
  const [errore, setErrore] = useState('')
  const [senzaLettore, setSenzaLettore] = useState(false)
  const [torcia, setTorcia] = useState<null | boolean>(null)   // null = il telefono non ce l'ha
  const [soloScartati, setSoloScartati] = useState(false)
  // L'ultima callback in un ref: chi la passa la ricrea a ogni render, e riaprire la fotocamera a ogni
  // render la farebbe lampeggiare.
  const cb = useRef(onCodici)
  useEffect(() => { cb.current = onCodici }, [onCodici])
  const scartaRef = useRef(scarta)
  useEffect(() => { scartaRef.current = scarta }, [scarta])

  useEffect(() => {
    let stream: MediaStream | null = null
    let fermo = false
    let timer: any = null
    const ultimi = new Map<string, number>()
    let ultimoScartato = 0, ultimoBuono = 0, timerAvviso: any = null

    // true se il lettore deve fermarsi (modalita' a lettura singola)
    const consegna = (letti: string[]): boolean => {
      const ora = Date.now()
      const puliti = [...new Set(letti.map(c => String(c || '').trim()).filter(Boolean))]
      const validi = puliti.filter(c => !scartaRef.current?.(c))
      // Avviso "avvicinati": solo se da un paio di secondi arrivano soltanto codici scartati.
      if (validi.length) { ultimoBuono = ora; setSoloScartati(false) }
      else if (puliti.length) {
        if (!ultimoScartato || ora - ultimoScartato > 4000) ultimoScartato = ora
        if (ora - ultimoScartato > 1500 && ora - ultimoBuono > 1500) setSoloScartati(true)
        clearTimeout(timerAvviso); timerAvviso = setTimeout(() => setSoloScartati(false), 3000)
      }
      const nuovi = validi.filter(c => ora - (ultimi.get(c) || 0) > PAUSA_STESSO_CODICE_MS)
      if (!nuovi.length) return false
      for (const c of nuovi) ultimi.set(c, ora)
      cb.current(nuovi)
      return !continuo
    }

    const avvia = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrore('Fotocamera non disponibile su questo dispositivo: scrivi il numero.')
        return
      }
      try {
        // Risoluzione alta: le barre di un Code128 su un'etichetta da 10 cm sono sottili.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (fermo) { stream.getTracks().forEach(t => t.stop()); return }
        traccia.current = stream.getVideoTracks()[0] || null
        try {
          const cap: any = (traccia.current as any)?.getCapabilities?.()
          if (cap?.torch) setTorcia(false)
          if (Array.isArray(cap?.focusMode) && cap.focusMode.includes('continuous')) {
            await (traccia.current as any).applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
          }
        } catch { /* messa a fuoco e torcia sono un di piu' */ }
        if (video.current) { video.current.srcObject = stream; await video.current.play() }
      } catch (e: any) {
        setErrore(e?.name === 'NotAllowedError'
          ? 'Permesso fotocamera negato. Attivalo nelle impostazioni del telefono, oppure scrivi il numero.'
          : 'Non riesco ad accedere alla fotocamera. Controlla il permesso nel telefono.')
        return
      }

      const D = (window as any).BarcodeDetector
      if (D) {
        let formati = FORMATI
        try {
          const ok: string[] = await D.getSupportedFormats()
          if (Array.isArray(ok) && ok.length) formati = FORMATI.filter(f => ok.includes(f))
        } catch { /* si prova con l'elenco intero */ }
        const detector = new D({ formats: formati })
        const cerca = async () => {
          if (fermo || !video.current) return
          try {
            if (video.current.readyState >= 2) {
              const trovati = await detector.detect(video.current)
              if (trovati?.length && consegna(trovati.map((t: any) => t.rawValue))) { fermo = true; return }
            }
          } catch { /* fotogramma non leggibile: si riprova col prossimo */ }
          timer = setTimeout(cerca, 120)
        }
        cerca()
        return
      }

      // Il ripiego che fa funzionare gli iPhone. Si carica solo qui, quando serve davvero: e' un
      // pezzo pesante e non ha senso farlo scaricare a chi ha gia' il lettore nativo.
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const { DecodeHintType } = await import('@zxing/library')
        // TRY_HARDER: cerca il codice su TUTTA l'immagine, non solo nella fascia centrale (senza, un codice
        // inquadrato un po' in alto o in basso non si leggeva).
        const lettore = new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]]))
        // UN FOTOGRAMMA DRITTO E UNO GIRATO DI 90 GRADI, A TURNO. Sull'etichetta SDA EXPRESS L i barcode
        // sono stampati in verticale: zxing legge solo le righe orizzontali, e la sua rotazione interna
        // sull'etichetta vera non leggeva niente (provato il 15/10). Senza questo, con l'iPhone bisognava
        // girare il telefono per ogni pacco. Il fotogramma si riduce a 1280 punti sul lato lungo: basta per
        // le barre di un'etichetta da 10 cm e tiene leggero il lavoro del telefono.
        //
        // UNA ZONA PER VOLTA. zxing restituisce UN codice per immagine, sempre il primo che trova. Sull'etichetta
        // SDA il primo e' il codice del CAP (barre piu' grosse): il 15/10 l'iPhone di Wave leggeva solo
        // "810140000" (CAP 81014) e mai la LDV, e la spedizione risultava "non trovata". Il lettore nativo di
        // Android invece da' tutti i codici del fotogramma. Qui si provano a turno l'intero e le meta' del
        // fotogramma: LDV e CAP stanno ai lati opposti, e in una meta' c'e' solo la LDV (il CAP lo scarta
        // chi usa il lettore, vedi `scarta`).
        const tela = document.createElement('canvas')
        const ctx = tela.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null
        let giro = 0
        const prova = () => {
          if (fermo || !video.current || !ctx) return
          const v = video.current
          if (v.readyState >= 2 && v.videoWidth) {
            const passo = giro++ % (ZONE.length * 2)
            const [zx, zy, zw, zh] = ZONE[Math.floor(passo / 2)], girato = passo % 2 === 1
            const sx = v.videoWidth * zx, sy = v.videoHeight * zy, sw = v.videoWidth * zw, sh = v.videoHeight * zh
            const scala = Math.min(1, 1280 / Math.max(sw, sh))
            const w = Math.round(sw * scala), h = Math.round(sh * scala)
            tela.width = girato ? h : w; tela.height = girato ? w : h
            ctx.save()
            if (girato) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2) }
            ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h)
            ctx.restore()
            try {
              const r = lettore.decodeFromCanvas(tela)
              if (r && consegna([r.getText()])) { fermo = true; return }
            } catch { /* nessun codice in questa zona */ }
          }
          timer = setTimeout(prova, 120)
        }
        prova()
      } catch {
        // Nemmeno il ripiego parte: resta la scrittura a mano, che ora almeno si vede.
        setSenzaLettore(true)
      }
    }
    avvia()

    return () => {
      fermo = true
      if (timer) clearTimeout(timer)
      if (timerAvviso) clearTimeout(timerAvviso)
      stream?.getTracks().forEach(t => t.stop())
      traccia.current = null
    }
  }, [continuo])

  async function cambiaTorcia() {
    const t: any = traccia.current
    if (!t || torcia === null) return
    try { await t.applyConstraints({ advanced: [{ torch: !torcia }] }); setTorcia(!torcia) } catch { setTorcia(null) }
  }

  return (
    <div style={{ position: 'relative', background: '#000' }}>
      {!errore && !senzaLettore && (
        <>
          <video ref={video} playsInline muted autoPlay
            style={{ width: '100%', display: 'block', maxHeight: altezzaMax, objectFit: 'cover' }} />
          {/* Mirino: dice dove mettere il codice, la lettura vale su tutta l'immagine. */}
          <div aria-hidden style={{ position: 'absolute', left: '12%', right: '12%', top: '30%', bottom: '30%', border: '2px solid rgba(255,255,255,0.85)', borderRadius: '10px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.25)', pointerEvents: 'none' }} />
          {soloScartati && avvisoScartati && (
            <div style={{ position: 'absolute', left: '10px', right: '10px', bottom: '10px', background: 'rgba(250,204,21,0.95)', color: '#1a1a1a', borderRadius: '8px', padding: '9px 11px', fontSize: '13.5px', fontWeight: 700, textAlign: 'center' }}>
              {avvisoScartati}
            </div>
          )}
          {torcia !== null && (
            <button type="button" onClick={cambiaTorcia}
              style={{ position: 'absolute', right: '10px', top: '10px', background: torcia ? '#fde047' : 'rgba(0,0,0,0.55)', color: torcia ? '#1a1a1a' : '#fff', border: '1px solid rgba(255,255,255,0.5)', borderRadius: '8px', padding: '7px 11px', fontSize: '13px', fontWeight: 700 }}>
              {torcia ? 'Torcia accesa' : 'Torcia'}
            </button>
          )}
        </>
      )}
      {(errore || senzaLettore) && (
        <div style={{ padding: '18px 15px', color: '#fca5a5', fontSize: '13.5px' }}>
          {errore || 'Questo telefono non legge i codici dalla fotocamera: scrivi il numero.'}
        </div>
      )}
    </div>
  )
}
