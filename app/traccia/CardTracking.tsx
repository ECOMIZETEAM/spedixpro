'use client'
import React, { useEffect, useState } from 'react'

// Pagina di tracking pubblica, condivisa fra la pagina per-token (/traccia/[token], aperta da SMS, email e
// dal link che il negozio Shopify manda al compratore) e il portale di ricerca (/traccia, dove si digita il
// numero). Mostra solo stato, città ed eventi (nessun dato personale), col marchio del master (white-label)
// o MoovExpress di ripiego.
//
// Rifatta il 22/10/2026 («quella brutta schermata», Lorenzo): era la pagina che il revisore Shopify apre dal
// link di tracciamento, e a pacco appena creato mostrava solo «In lavorazione» e cinque pallini. Ora dice a
// parole cosa sta succedendo, si tinge del colore del master, e parla inglese a chi non ha il browser in
// italiano (gli eventi restano nella lingua del corriere).

export const ARANCIO = '#FD5304'
const INDICE_FASE: Record<string, number> = {
  in_lavorazione: 0, spedita: 1, in_transito: 2, in_consegna: 3, consegnata: 4,
  in_giacenza: 2, non_consegnato: 3, reso_mittente: 2, annullamento_pending: 0,
}
const STATI_PROBLEMA = new Set(['in_giacenza', 'non_consegnato', 'reso_mittente'])
const STATI_ANNULLO = new Set(['annullata', 'annullamento_manuale', 'storno_richiesto'])

export interface DatiTracking {
  brand: { nome: string; logo: string | null; colore?: string | null }
  stato: string
  stato_label: string
  riferimento: string | null
  citta: string | null
  provincia: string | null
  aggiornato_il: string | null
  creata_il?: string | null
  eventi: { descrizione: string; luogo: string; data: string }[]
}

export type Lingua = 'it' | 'en'

const TESTI = {
  it: {
    titolo: 'Tracciamento spedizione',
    fasi: ['In lavorazione', 'Presa in carico', 'In transito', 'In consegna', 'Consegnata'],
    stati: { in_lavorazione: 'In lavorazione', spedita: 'Presa in carico', in_transito: 'In transito', in_consegna: 'In consegna', consegnata: 'Consegnata', in_giacenza: 'In giacenza', non_consegnato: 'Consegna non riuscita', reso_mittente: 'In rientro al mittente', annullata: 'Annullata', annullamento_manuale: 'Annullata', storno_richiesto: 'Annullata', annullamento_pending: 'In lavorazione' } as Record<string, string>,
    frase: (stato: string, dove: string | null) => ({
      in_lavorazione: "Il mittente ha preparato la spedizione. Il corriere non l'ha ancora ritirata.",
      annullamento_pending: "Il mittente ha preparato la spedizione. Il corriere non l'ha ancora ritirata.",
      spedita: 'Il corriere ha preso in carico il pacco.',
      in_transito: dove ? `Il pacco è in viaggio verso ${dove}.` : 'Il pacco è in viaggio.',
      in_consegna: dove ? `Il corriere sta portando il pacco a ${dove}.` : 'Il corriere sta portando il pacco a destinazione.',
      consegnata: dove ? `Il pacco è stato consegnato a ${dove}.` : 'Il pacco è stato consegnato.',
      in_giacenza: 'Il pacco è fermo presso il corriere, in attesa di istruzioni o di un nuovo tentativo di consegna.',
      non_consegnato: 'Il corriere ha tentato la consegna senza riuscirci. Verrà fatto un nuovo tentativo.',
      reso_mittente: 'Il pacco sta tornando al mittente.',
    } as Record<string, string>)[stato] || (STATI_ANNULLO.has(stato) ? 'Questa spedizione è stata annullata.' : 'La spedizione è in lavorazione.'),
    contatta: 'Per qualsiasi necessità contatta il negozio o la persona che ti ha spedito il pacco.',
    statoAttuale: 'Stato attuale',
    numero: 'Numero di tracciamento', copia: 'Copia', copiato: 'Copiato',
    destinazione: 'Destinazione', creata: 'Spedizione creata', ultimo: 'Ultimo movimento',
    storico: 'Storico movimenti', dalCorriere: 'Aggiornamenti forniti dal corriere',
    oggi: 'Oggi', ieri: 'Ieri',
    mostraTutti: (n: number) => `Mostra tutti i ${n} movimenti`, mostraMeno: 'Mostra meno',
    vuotoTitolo: 'Ancora nessun movimento',
    vuotoTesto: 'Il corriere registra il primo passaggio quando ritira il pacco. Torna su questa pagina più tardi: ogni movimento comparirà qui.',
    annullataTesto: 'Il pacco non partirà con questo numero di tracciamento.',
    fornito: (nome: string) => `Tracciamento fornito da ${nome}`,
    caricamento: 'Carico la spedizione…',
    nonTrovataTitolo: 'Spedizione non trovata',
    nonTrovataTesto: 'Controlla il link ricevuto: il codice potrebbe non essere corretto o la spedizione non è più disponibile.',
    erroreTitolo: 'Tracciamento non disponibile al momento',
    erroreTesto: "La spedizione c'è: è il servizio che non risponde in questo istante. Riprova fra qualche secondo.",
    riprova: 'Riprova',
    cercaTitolo: "Dov'è il tuo pacco?",
    cercaTesto: "Inserisci il numero di spedizione: lo trovi nell'email o nell'SMS che hai ricevuto.",
    cercaEsempio: 'Es. 282343J020884', cerca: 'Cerca', cerco: 'Cerco…',
    cercaNonTrovataTesto: "Controlla il numero e riprova. Se l'hai appena ricevuto, potrebbe non essere ancora registrato.",
  },
  en: {
    titolo: 'Shipment tracking',
    fasi: ['Processing', 'Picked up', 'In transit', 'Out for delivery', 'Delivered'],
    stati: { in_lavorazione: 'Processing', spedita: 'Picked up', in_transito: 'In transit', in_consegna: 'Out for delivery', consegnata: 'Delivered', in_giacenza: 'Held by the carrier', non_consegnato: 'Delivery attempt failed', reso_mittente: 'Returning to sender', annullata: 'Cancelled', annullamento_manuale: 'Cancelled', storno_richiesto: 'Cancelled', annullamento_pending: 'Processing' } as Record<string, string>,
    frase: (stato: string, dove: string | null) => ({
      in_lavorazione: 'The sender has prepared the shipment. The carrier has not collected it yet.',
      annullamento_pending: 'The sender has prepared the shipment. The carrier has not collected it yet.',
      spedita: 'The carrier has picked up the parcel.',
      in_transito: dove ? `The parcel is on its way to ${dove}.` : 'The parcel is on its way.',
      in_consegna: dove ? `The courier is delivering the parcel to ${dove}.` : 'The courier is delivering the parcel.',
      consegnata: dove ? `The parcel has been delivered to ${dove}.` : 'The parcel has been delivered.',
      in_giacenza: 'The parcel is being held by the carrier, waiting for instructions or a new delivery attempt.',
      non_consegnato: 'The courier tried to deliver the parcel without success. A new attempt will be made.',
      reso_mittente: 'The parcel is on its way back to the sender.',
    } as Record<string, string>)[stato] || (STATI_ANNULLO.has(stato) ? 'This shipment has been cancelled.' : 'The shipment is being processed.'),
    contatta: 'If you need anything, contact the shop or the person who sent you the parcel.',
    statoAttuale: 'Current status',
    numero: 'Tracking number', copia: 'Copy', copiato: 'Copied',
    destinazione: 'Destination', creata: 'Shipment created', ultimo: 'Latest update',
    storico: 'Tracking history', dalCorriere: 'Updates as reported by the carrier',
    oggi: 'Today', ieri: 'Yesterday',
    mostraTutti: (n: number) => `Show all ${n} updates`, mostraMeno: 'Show less',
    vuotoTitolo: 'No updates yet',
    vuotoTesto: 'The carrier records the first scan when it collects the parcel. Check back later: every update will appear here.',
    annullataTesto: 'The parcel will not ship with this tracking number.',
    fornito: (nome: string) => `Tracking provided by ${nome}`,
    caricamento: 'Loading the shipment…',
    nonTrovataTitolo: 'Shipment not found',
    nonTrovataTesto: 'Check the link you received: the code may be wrong or the shipment is no longer available.',
    erroreTitolo: 'Tracking unavailable right now',
    erroreTesto: 'The shipment exists: it is our service that is not answering at this moment. Try again in a few seconds.',
    riprova: 'Try again',
    cercaTitolo: 'Where is your parcel?',
    cercaTesto: 'Enter the tracking number: you will find it in the email or text message you received.',
    cercaEsempio: 'E.g. 282343J020884', cerca: 'Search', cerco: 'Searching…',
    cercaNonTrovataTesto: 'Check the number and try again. If you have just received it, it may not be registered yet.',
  },
}
export const testiTracking = (l: Lingua) => TESTI[l]

// Italiano a chi ha l'italiano fra le lingue del browser, inglese a tutti gli altri. Si decide dopo il
// montaggio: sul server la lingua del visitatore non si conosce.
export function useLinguaTracking(): Lingua {
  const [lingua, setLingua] = useState<Lingua>('it')
  useEffect(() => {
    try {
      const lingue = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]).map((x) => String(x || '').toLowerCase())
      setLingua(lingue.some((x) => x.startsWith('it')) ? 'it' : 'en')
    } catch { /* resta l'italiano */ }
  }, [])
  return lingua
}

// --- colori -------------------------------------------------------------------------------------------
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mescola(hex: string, verso: string, t: number): string {
  const a = rgb(hex), b = rgb(verso)
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
function luminanza(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// Il colore del master fa da accento; se è troppo chiaro per stare sul bianco come testo, lo si scurisce.
function variabiliColore(colore: string): React.CSSProperties {
  const testo = luminanza(colore) > 0.3 ? mescola(colore, '#000000', 0.32) : colore
  return {
    ['--tk-accento' as any]: colore,
    ['--tk-accento-testo' as any]: testo,
    ['--tk-accento-tenue' as any]: mescola(colore, '#ffffff', 0.9),
    ['--tk-accento-velo' as any]: mescola(colore, '#ffffff', 0.82),
    ['--tk-accento-alone' as any]: `rgba(${rgb(colore).join(',')},.34)`,
  }
}

// --- date ----------------------------------------------------------------------------------------------
const localeDi = (l: Lingua) => (l === 'it' ? 'it-IT' : 'en-GB')
function data(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
export function dataIt(s: string | null, lingua: Lingua = 'it'): string {
  const d = data(s)
  if (!d) return s || ''
  return d.toLocaleString(localeDi(lingua), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const ora = (d: Date, l: Lingua) => d.toLocaleTimeString(localeDi(l), { hour: '2-digit', minute: '2-digit' })
function giorno(d: Date, l: Lingua): string {
  const t = TESTI[l]
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0)
  const quel = new Date(d); quel.setHours(0, 0, 0, 0)
  const diff = Math.round((oggi.getTime() - quel.getTime()) / 86400000)
  if (diff === 0) return t.oggi
  if (diff === 1) return t.ieri
  const s = d.toLocaleDateString(localeDi(l), { weekday: 'long', day: 'numeric', month: 'long', ...(quel.getFullYear() !== oggi.getFullYear() ? { year: 'numeric' } : {}) })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function quando(s: string | null | undefined, l: Lingua): string {
  const d = data(s)
  if (!d) return ''
  const g = giorno(d, l)
  const t = TESTI[l]
  return (g === t.oggi || g === t.ieri ? g : d.toLocaleDateString(localeDi(l), { day: 'numeric', month: 'short' })) + ', ' + ora(d, l)
}

// --- icone ---------------------------------------------------------------------------------------------
const PERCORSI: Record<string, React.ReactNode> = {
  pacco: <><path d="M21 8.5 12 3.5l-9 5 9 5 9-5Z" /><path d="M3 8.5v7.5l9 5 9-5V8.5" /><path d="M12 13.5v7.5" /><path d="m7.5 6 9 5" /></>,
  presa: <><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V2.8h6V4" /><path d="m9 13 2.2 2.2L15.5 11" /></>,
  camion: <><path d="M2 6.5h11.5v9.5H2z" /><path d="M13.5 9.5h4.2l3.3 3.4V16h-7.5" /><circle cx="6" cy="17.6" r="1.9" /><circle cx="17" cy="17.6" r="1.9" /></>,
  consegna: <><path d="M12 21.2s-7-6.1-7-11.2a7 7 0 0 1 14 0c0 5.1-7 11.2-7 11.2Z" /><circle cx="12" cy="10" r="2.6" /></>,
  casa: <><path d="m3 11 9-7.5 9 7.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="m9.3 14.6 2 2 3.6-3.7" /></>,
  attenzione: <><path d="M12 3.5 2.5 20h19L12 3.5Z" /><path d="M12 10v4.5" /><path d="M12 17.3v.2" /></>,
  annullata: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  copia: <><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" /><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" /></>,
  spunta: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cerca: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  attesa: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
}
const ICONE_FASI = ['pacco', 'presa', 'camion', 'consegna', 'casa']
export function Icona({ nome, size = 20 }: { nome: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PERCORSI[nome]}
    </svg>
  )
}

// --- stile ---------------------------------------------------------------------------------------------
const CSS = `
.tk{--tk-accento:${ARANCIO};--tk-accento-testo:#c2410c;--tk-accento-tenue:#fff4ed;--tk-accento-velo:#ffe6d6;min-height:100vh;display:flex;flex-direction:column;align-items:center;background:#f3f4f6;color:#111827;font-family:var(--font-geist-sans),Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden}
.tk *{box-sizing:border-box}
.tk-alone{position:absolute;inset:0 0 auto 0;height:236px;background:radial-gradient(760px 300px at 18% -40px,var(--tk-accento-alone) 0%,rgba(0,0,0,0) 70%),radial-gradient(620px 260px at 92% 0,rgba(255,255,255,.06) 0%,rgba(0,0,0,0) 70%),#141414;pointer-events:none}
.tk-alone:after{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1px);background-size:18px 18px;-webkit-mask-image:linear-gradient(180deg,#000 0%,transparent 95%);mask-image:linear-gradient(180deg,#000 0%,transparent 95%)}
.tk-testata{position:relative;width:100%;border-bottom:1px solid rgba(255,255,255,.08)}
.tk-testata-in{max-width:1040px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:12px}
.tk-logo{height:34px;max-width:170px;object-fit:contain}
.tk-marchio{font-weight:800;font-size:19px;letter-spacing:-.3px;color:#fff}
.tk-etichetta{margin-left:auto;font-size:12.5px;font-weight:600;color:#a3a3a3;display:flex;align-items:center;gap:7px}
.tk-etichetta i{width:7px;height:7px;border-radius:50%;background:var(--tk-accento);display:inline-block}
.tk-corpo{position:relative;width:100%;max-width:1040px;padding:26px 20px 20px;flex:1}
.tk-griglia{display:grid;gap:18px;grid-template-columns:minmax(0,1fr);align-items:stretch}
.tk-colonna{display:grid;gap:18px;align-content:start}
.tk-storia-vuota{display:flex;align-items:center;justify-content:center}
@media (min-width:900px){.tk-griglia{grid-template-columns:minmax(0,1.05fr) minmax(0,1fr)}.tk-corpo{padding-top:38px}}
.tk-card{background:#fff;border:1px solid #e9eaee;border-radius:18px;box-shadow:0 1px 2px rgba(17,24,39,.04),0 10px 30px -12px rgba(17,24,39,.12)}
.tk-eroe{padding:24px 22px 22px;position:relative;overflow:hidden}
.tk-eroe:before{content:"";position:absolute;inset:0 0 auto 0;height:5px;background:var(--tk-accento)}
.tk-pill{display:inline-flex;align-items:center;gap:7px;padding:5px 11px 5px 9px;border-radius:999px;background:var(--tk-accento-tenue);color:var(--tk-accento-testo);font-size:12px;font-weight:700;letter-spacing:.2px}
.tk-pill .tk-punto{width:8px;height:8px;border-radius:50%;background:var(--tk-accento);position:relative}
.tk-vivo .tk-punto:after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--tk-accento);opacity:.5;animation:tk-pulsa 1.8s ease-out infinite}
@keyframes tk-pulsa{0%{transform:scale(.6);opacity:.7}100%{transform:scale(1.7);opacity:0}}
.tk-stato{margin:14px 0 6px;font-size:32px;line-height:1.1;font-weight:800;letter-spacing:-.8px;color:var(--tk-accento-testo)}
.tk-frase{font-size:15.5px;line-height:1.5;color:#374151;margin:0}
.tk-nota{margin-top:14px;display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;background:var(--tk-accento-tenue);color:#374151;font-size:13.5px;line-height:1.45}
.tk-nota svg{flex-shrink:0;color:var(--tk-accento-testo);margin-top:1px}
.tk-percorso{position:relative;display:flex;margin:26px -4px 2px}
.tk-binario{position:absolute;top:21px;left:10%;right:10%;height:4px;border-radius:4px;background:#eceef1}
.tk-binario span{position:absolute;inset:0 auto 0 0;border-radius:4px;background:var(--tk-accento);transition:width .6s ease}
.tk-tappa{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0}
.tk-cerchio{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#fff;border:2px solid #e3e5e9;color:#b4b8c0;position:relative;z-index:1;transition:all .3s}
.tk-fatta .tk-cerchio{background:var(--tk-accento-tenue);border-color:var(--tk-accento);color:var(--tk-accento-testo)}
.tk-ora .tk-cerchio{background:var(--tk-accento);border-color:var(--tk-accento);color:#fff;box-shadow:0 0 0 6px var(--tk-accento-velo)}
.tk-nome{margin-top:9px;font-size:11.5px;line-height:1.25;font-weight:600;color:#9ca3af;padding:0 2px}
.tk-fatta .tk-nome{color:#4b5563}
.tk-ora .tk-nome{color:#111827;font-weight:800}
.tk-dati{padding:6px 22px}
.tk-riga{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid #f1f2f4;font-size:14px}
.tk-riga:last-child{border-bottom:0}
.tk-riga dt{color:#6b7280;font-weight:500}
.tk-riga dd{margin:0;font-weight:700;color:#111827;text-align:right;display:flex;align-items:center;gap:8px;min-width:0}
.tk-riga-numero{display:block;padding:16px 0 14px}
.tk-riga-numero dd{justify-content:space-between;margin-top:6px;text-align:left}
.tk-numero{font-family:var(--font-geist-mono),ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tk-copia{display:inline-flex;align-items:center;gap:5px;border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:5px 9px;font:inherit;font-size:12px;font-weight:600;color:#374151;cursor:pointer;flex-shrink:0;transition:all .15s}
.tk-copia:hover{border-color:var(--tk-accento);color:var(--tk-accento-testo)}
.tk-storia{padding:22px 22px 10px}
.tk-storia-testa{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:4px}
.tk-storia h2{margin:0;font-size:17px;font-weight:800;letter-spacing:-.2px}
.tk-conta{font-size:12px;font-weight:700;color:#6b7280;background:#f3f4f6;border-radius:999px;padding:3px 9px}
.tk-fonte{font-size:12px;color:#9ca3af;margin:0 0 6px}
.tk-giorno{font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin:18px 0 6px}
.tk-evento{display:grid;grid-template-columns:46px 18px minmax(0,1fr);gap:0 10px;position:relative}
.tk-evento-ora{font-size:12.5px;font-weight:600;color:#6b7280;padding-top:1px;font-variant-numeric:tabular-nums}
.tk-evento-asse{position:relative;display:flex;justify-content:center}
.tk-evento-asse:before{content:"";position:absolute;top:0;bottom:0;width:2px;background:#eceef1}
.tk-evento:last-child .tk-evento-asse:before{bottom:auto;height:10px}
.tk-evento-punto{position:relative;margin-top:4px;width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #cfd3da}
.tk-primo .tk-evento-punto{background:var(--tk-accento);border-color:var(--tk-accento);box-shadow:0 0 0 4px var(--tk-accento-velo)}
.tk-evento-testo{padding-bottom:16px}
.tk-evento-titolo{font-size:14px;line-height:1.4;color:#1f2937;font-weight:600}
.tk-primo .tk-evento-titolo{color:#111827;font-weight:700}
.tk-evento-luogo{font-size:12.5px;color:#9ca3af;margin-top:2px}
.tk-altri{display:block;width:100%;margin:2px 0 12px;padding:11px;border:1px dashed #d8dbe0;border-radius:11px;background:#fafafb;font:inherit;font-size:13px;font-weight:700;color:#374151;cursor:pointer}
.tk-altri:hover{border-color:var(--tk-accento);color:var(--tk-accento-testo)}
.tk-vuoto{padding:30px 22px 32px;text-align:center}
.tk-vuoto-icona{width:60px;height:60px;margin:0 auto 14px;border-radius:18px;display:flex;align-items:center;justify-content:center;background:var(--tk-accento-tenue);color:var(--tk-accento-testo)}
.tk-vuoto h3{margin:0 0 6px;font-size:16px;font-weight:800}
.tk-vuoto p{margin:0 auto;max-width:360px;font-size:13.5px;line-height:1.5;color:#6b7280}
.tk-unica{max-width:560px;margin:0 auto}
.tk-bottone{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 20px;border:0;border-radius:12px;background:var(--tk-accento);color:#fff;font:inherit;font-size:14.5px;font-weight:700;cursor:pointer}
.tk-bottone:disabled{background:#d1d5db;cursor:default}
.tk-scheletro{border-radius:9px;background:linear-gradient(90deg,#f0f1f3 0%,#f7f8f9 50%,#f0f1f3 100%);background-size:200% 100%;animation:tk-luce 1.3s linear infinite}
@keyframes tk-luce{0%{background-position:200% 0}100%{background-position:-200% 0}}
.tk-piede{position:relative;padding:8px 20px 30px;font-size:12px;color:#9ca3af;text-align:center}
.tk-cerca{padding:24px 22px}
.tk-cerca h1{margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-.5px}
.tk-cerca p{margin:0 0 16px;font-size:14px;line-height:1.5;color:#6b7280}
.tk-cerca form{display:flex;gap:8px;flex-wrap:wrap}
.tk-cerca input{flex:1;min-width:180px;height:48px;padding:0 14px;border:1.5px solid #e5e7eb;border-radius:12px;font:inherit;font-size:15.5px;color:#111827;outline:none;background:#fff;font-family:var(--font-geist-mono),ui-monospace,Menlo,monospace;letter-spacing:.3px}
.tk-cerca input:focus{border-color:var(--tk-accento);box-shadow:0 0 0 3px var(--tk-accento-velo)}
.tk-cerca .tk-bottone{height:48px}
@media (max-width:420px){.tk-stato{font-size:28px}.tk-cerchio{width:38px;height:38px}.tk-binario{top:18px}.tk-nome{font-size:10.5px}.tk-corpo{padding:18px 14px 16px}.tk-eroe,.tk-storia,.tk-cerca{padding-left:18px;padding-right:18px}.tk-dati{padding:4px 18px}.tk-testata-in{padding:12px 16px}}
@media (prefers-reduced-motion:reduce){.tk *{animation:none!important;transition:none!important}}
`

// Il guscio: sfondo, testata col marchio, piede. Il colore arriva con i dati della spedizione.
export function GuscioTracking({ brand, lingua, children }: { brand: { nome: string; logo: string | null; colore?: string | null } | null; lingua: Lingua; children: React.ReactNode }) {
  const nome = brand?.nome || 'MoovExpress'
  const colore = brand?.colore || ARANCIO
  return (
    <div className="tk" style={variabiliColore(colore)}>
      <style>{CSS}</style>
      <div className="tk-alone" />
      <header className="tk-testata">
        <div className="tk-testata-in">
          {brand?.logo ? <img className="tk-logo" src={brand.logo} alt={nome} /> : <span className="tk-marchio">{nome}</span>}
          <span className="tk-etichetta"><i />{TESTI[lingua].titolo}</span>
        </div>
      </header>
      <main className="tk-corpo">{children}</main>
      <footer className="tk-piede">{TESTI[lingua].fornito(nome)}</footer>
    </div>
  )
}

// Carta di servizio: caricamento, non trovata, errore.
export function CartaMessaggio({ icona, titolo, testo, azione }: { icona: string; titolo: string; testo: string; azione?: React.ReactNode }) {
  return (
    <div className="tk-card tk-unica">
      <div className="tk-vuoto">
        <div className="tk-vuoto-icona"><Icona nome={icona} size={28} /></div>
        <h3>{titolo}</h3>
        <p>{testo}</p>
        {azione && <div style={{ marginTop: 18 }}>{azione}</div>}
      </div>
    </div>
  )
}

export function CartaCaricamento() {
  return (
    <div className="tk-griglia" aria-busy="true">
      <div className="tk-card tk-eroe">
        <div className="tk-scheletro" style={{ width: 120, height: 24, borderRadius: 999 }} />
        <div className="tk-scheletro" style={{ width: '62%', height: 34, margin: '16px 0 10px' }} />
        <div className="tk-scheletro" style={{ width: '88%', height: 16 }} />
        <div className="tk-scheletro" style={{ width: '100%', height: 44, marginTop: 28, borderRadius: 22 }} />
      </div>
      <div className="tk-card tk-storia">
        {[0, 1, 2, 3].map((i) => <div key={i} className="tk-scheletro" style={{ width: `${90 - i * 12}%`, height: 16, margin: '14px 0' }} />)}
      </div>
    </div>
  )
}

const VISIBILI = 8

export function CardTracking({ dati, lingua = 'it' }: { dati: DatiTracking; lingua?: Lingua }) {
  const t = TESTI[lingua]
  const [tutti, setTutti] = useState(false)
  const [copiato, setCopiato] = useState(false)
  const problema = STATI_PROBLEMA.has(dati.stato)
  const annullata = STATI_ANNULLO.has(dati.stato)
  const consegnata = dati.stato === 'consegnata'
  const fase = INDICE_FASE[dati.stato] ?? 0
  // Verde a pacco consegnato, ambra se c'è un intoppo, grigio se annullata: per il resto il colore del master.
  const stileStato: React.CSSProperties | undefined = annullata ? variabiliColore('#6b7280') : problema ? variabiliColore('#d97706') : consegnata ? variabiliColore('#16a34a') : undefined
  const dove = dati.citta ? dati.citta + (dati.provincia ? ` (${dati.provincia})` : '') : null
  const ultimoEvento = dati.eventi[0]?.data || null
  const eventi = tutti ? dati.eventi : dati.eventi.slice(0, VISIBILI)

  async function copia() {
    if (!dati.riferimento) return
    try { await navigator.clipboard.writeText(dati.riferimento); setCopiato(true); setTimeout(() => setCopiato(false), 1800) } catch { /* il numero resta selezionabile */ }
  }

  // Eventi raggruppati per giorno, il più recente in cima (l'API li manda già in quest'ordine).
  const gruppi: { giorno: string; eventi: { e: DatiTracking['eventi'][number]; i: number }[] }[] = []
  eventi.forEach((e, i) => {
    const d = data(e.data)
    const g = d ? giorno(d, lingua) : ''
    if (!gruppi.length || gruppi[gruppi.length - 1].giorno !== g) gruppi.push({ giorno: g, eventi: [] })
    gruppi[gruppi.length - 1].eventi.push({ e, i })
  })

  return (
    <div className="tk-griglia">
      <div className="tk-colonna">
        <section className="tk-card tk-eroe" style={stileStato}>
          <span className={'tk-pill' + (!annullata && !consegnata ? ' tk-vivo' : '')}><span className="tk-punto" />{t.statoAttuale}</span>
          <h1 className="tk-stato">{t.stati[dati.stato] || dati.stato_label}</h1>
          <p className="tk-frase">{t.frase(dati.stato, dove)}</p>
          {(problema || annullata) && (
            <div className="tk-nota"><Icona nome={annullata ? 'annullata' : 'attenzione'} size={18} /><span>{annullata ? t.annullataTesto : t.contatta}</span></div>
          )}
          {!annullata && (
            <div className="tk-percorso" role="list">
              <div className="tk-binario"><span style={{ width: `${(fase / (t.fasi.length - 1)) * 100}%` }} /></div>
              {t.fasi.map((f, i) => (
                <div key={f} role="listitem" aria-current={i === fase ? 'step' : undefined} className={'tk-tappa' + (i < fase ? ' tk-fatta' : '') + (i === fase ? ' tk-ora' : '')}>
                  <div className="tk-cerchio"><Icona nome={i === fase && problema ? 'attenzione' : ICONE_FASI[i]} size={19} /></div>
                  <div className="tk-nome">{i === fase && problema ? t.stati[dati.stato] : f}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="tk-card tk-dati">
          <dl style={{ margin: 0 }}>
            {dati.riferimento && (
              <div className="tk-riga tk-riga-numero">
                <dt>{t.numero}</dt>
                <dd>
                  <span className="tk-numero">{dati.riferimento}</span>
                  <button type="button" className="tk-copia" onClick={copia}><Icona nome={copiato ? 'spunta' : 'copia'} size={14} />{copiato ? t.copiato : t.copia}</button>
                </dd>
              </div>
            )}
            {dove && <div className="tk-riga"><dt>{t.destinazione}</dt><dd>{dove}</dd></div>}
            {dati.creata_il && <div className="tk-riga"><dt>{t.creata}</dt><dd>{quando(dati.creata_il, lingua)}</dd></div>}
            {ultimoEvento && <div className="tk-riga"><dt>{t.ultimo}</dt><dd>{quando(ultimoEvento, lingua)}</dd></div>}
          </dl>
        </section>
      </div>

      <section className={'tk-card' + (dati.eventi.length === 0 ? ' tk-storia-vuota' : '')} style={stileStato}>
        {dati.eventi.length === 0 ? (
          <div className="tk-vuoto">
            <div className="tk-vuoto-icona"><Icona nome={annullata ? 'annullata' : 'pacco'} size={28} /></div>
            <h3>{t.vuotoTitolo}</h3>
            <p>{annullata ? t.annullataTesto : t.vuotoTesto}</p>
          </div>
        ) : (
          <div className="tk-storia">
            <div className="tk-storia-testa"><h2>{t.storico}</h2><span className="tk-conta">{dati.eventi.length}</span></div>
            <p className="tk-fonte">{t.dalCorriere}</p>
            {gruppi.map((g, gi) => (
              <div key={gi}>
                {g.giorno && <div className="tk-giorno">{g.giorno}</div>}
                {g.eventi.map(({ e, i }) => {
                  const d = data(e.data)
                  return (
                    <div key={i} className={'tk-evento' + (i === 0 ? ' tk-primo' : '')}>
                      <div className="tk-evento-ora">{d ? ora(d, lingua) : ''}</div>
                      <div className="tk-evento-asse"><span className="tk-evento-punto" /></div>
                      <div className="tk-evento-testo">
                        <div className="tk-evento-titolo">{e.descrizione}</div>
                        {e.luogo && <div className="tk-evento-luogo">{e.luogo}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            {dati.eventi.length > VISIBILI && (
              <button type="button" className="tk-altri" onClick={() => setTutti((v) => !v)}>{tutti ? t.mostraMeno : t.mostraTutti(dati.eventi.length)}</button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
