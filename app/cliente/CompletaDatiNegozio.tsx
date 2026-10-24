'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PROVINCE_IT } from '@/lib/province-it'
import type { DatiSchermataNegozio } from '@/lib/dati-negozio'

const ACCENT = '#f97316'

// LA SCHERMATA DEL PRIMO ACCESSO DEI NEGOZI SHOPIFY.
//
// Il conto nato dall'installazione dell'app entra nel portale senza indirizzo di ritiro, senza
// telefono e senza dati fiscali: l'import e gli ordini del negozio non spedivano, e il messaggio
// diceva di scrivere a un referente che il negoziante non conosce (fu il vicolo cieco della prima
// revisione Shopify). Qui li chiede tutti insieme, una volta sola (decisioni D2 e D8 del 21/10/2026).
// Non si chiude senza salvare, perche' senza questi dati il portale non serve a niente; "Esci" resta
// raggiungibile, e c'e' sempre a chi scrivere se un dato giusto non passa. Quando compare e quando si
// accetta il salvataggio lo decide lib/dati-negozio, sul server: il layout la monta, la rotta
// /api/cliente/dati-negozio salva.
// Sta sopra il tutorial (che intanto aspetta) e sotto l'avviso API, che si chiude con un clic.

// Una pagina che dice "manca l'indirizzo" chiede di riaprirla con questo evento: ClienteShell
// ricarica il layout, che rifa' il conto sul server. Dopo il salvataggio parte l'altro evento, con
// cui le pagine aperte rileggono il mittente invece di mostrare ancora il messaggio di prima.
export const EVENTO_APRI_DATI_NEGOZIO = 'moovx-completa-dati-negozio'
export const EVENTO_DATI_NEGOZIO_SALVATI = 'moovx-dati-negozio-salvati'
export function apriCompletaDatiNegozio() { window.dispatchEvent(new Event(EVENTO_APRI_DATI_NEGOZIO)) }

type Voce = { nome: string; sigla: string; cap: string }
// Una voce dell'elenco: una localita' col suo CAP, oppure una citta' con piu' CAP, che si sceglie senza.
type Suggerimento = Voce & { caps?: string[] }
type Campo = keyof DatiSchermataNegozio

// LE CITTA' CON PIU' CAP SONO UNA VOCE SOLA, SENZA CAP.
// L'elenco mostrava le prime 8 voci, e per Napoli la prima era 80100, il CAP generico che non e' di
// nessuna via, poi 80121-80127: il negoziante sceglieva la prima e il CAP del ritiro usciva sbagliato,
// con effetti sul prezzo (lib/dati-negozio, capGenericiDi). Roma ne ha 82, Venezia 57: scegliere il CAP
// da un elenco vuol dire tirare a indovinare. Cercando per nome, una citta' con piu' CAP diventa una
// voce che mette citta' e provincia e lascia il CAP da scrivere, col cursore gia' li'. Cercando per CAP
// (solo cifre) le voci restano una per CAP: chi lo scrive sa quale vuole. Il generico (xx100 dove c'e'
// anche xx121) non si propone mai, e se lo si scrive a mano lo rifiuta il server.
function suggerimenti(voci: Voce[], perCap: boolean): Suggerimento[] {
  const chiave = (v: Voce) => v.nome + '|' + v.sigla
  const gruppi = new Map<string, Voce[]>()
  for (const v of voci) {
    const g = gruppi.get(chiave(v))
    if (g) g.push(v); else gruppi.set(chiave(v), [v])
  }
  const generico = (v: Voce) => {
    const caps = new Set(gruppi.get(chiave(v))!.map(x => x.cap))
    return /^\d{2}100$/.test(v.cap) && caps.has(v.cap.slice(0, 3) + '21')
  }
  if (perCap) return voci.filter(v => !generico(v))
  const out: Suggerimento[] = []
  for (const g of gruppi.values()) {
    const buone = g.filter(v => !generico(v))
    const caps = [...new Set(buone.map(v => v.cap).filter(Boolean))].sort()
    if (caps.length > 1) out.push({ nome: g[0].nome, sigla: g[0].sigla, cap: '', caps })
    else out.push(buone[0] || g[0])
  }
  return out
}

// L'ordine dei campi a schermo: dopo un rifiuto si porta il cursore sul primo sbagliato. I due errori
// "manca l'uno e l'altro" stanno sul primo dei due campi.
const ORDINE: string[] = [
  'ragione_sociale', 'piva', 'piva_cf', 'cf', 'cod_sdi', 'sdi_pec', 'pec', 'email',
  'sl_indirizzo', 'sl_citta', 'sl_provincia', 'sl_cap',
  'so_indirizzo', 'so_citta', 'so_provincia', 'so_cap', 'telefono',
]
const ANCORA: Record<string, string> = { piva_cf: 'piva', sdi_pec: 'cod_sdi' }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
// Ritiro "uguale alla sede legale" se non e' mai stato scritto, o se coincide gia' con la sede.
function ritiroUguale(d: DatiSchermataNegozio): boolean {
  const so = [d.so_indirizzo, d.so_citta, d.so_cap, d.so_provincia]
  if (so.every(v => !v.trim())) return true
  const sl = [d.sl_indirizzo, d.sl_citta, d.sl_cap, d.sl_provincia]
  return so.every((v, i) => norm(v) === norm(sl[i]))
}

const inp = (errore?: string): React.CSSProperties => ({
  width: '100%', padding: '10px 12px', border: `1px solid ${errore ? '#ef4444' : '#d1d5db'}`, borderRadius: '8px',
  // 16px: sotto questa misura il telefono ingrandisce la pagina a ogni campo toccato.
  fontSize: '16px', color: '#1a1a1a', background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit',
})
const lbl: React.CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 600, color: '#1a1a1a', marginBottom: '5px' }
const aiuto: React.CSSProperties = { fontSize: '12.5px', color: '#6b7280', marginTop: '5px', lineHeight: 1.45 }
const sbagliato: React.CSSProperties = { fontSize: '12.5px', color: '#b91c1c', marginTop: '5px', lineHeight: 1.45 }
// Due colonne dove c'e' spazio, una sola sul telefono: senza media query, decide la larghezza.
const coppia: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }
const titoloSezione: React.CSSProperties = { fontSize: '15px', fontWeight: 800, color: '#1a1a1a', margin: 0 }

function Riquadro({ id, etichetta, errore, nota, children }: { id: string; etichetta: string; errore?: string; nota?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} style={lbl}>{etichetta}</label>
      {children}
      {errore ? <div id={id + '-errore'} style={sbagliato}>{errore}</div> : nota ? <div style={aiuto}>{nota}</div> : null}
    </div>
  )
}

// CITTA' CON I SUGGERIMENTI DELL'ARCHIVIO (/api/comuni, lo stesso della Nuova spedizione): scegliere
// una voce mette insieme citta', provincia e CAP, cosi' i tre valori sono coerenti fra loro.
// L'elenco sta nel flusso della pagina e non sopra: dentro una schermata che scorre, un pannello
// sovrapposto verrebbe tagliato dal bordo o resterebbe fermo mentre il campo si sposta. Ci sono tutte
// le voci, non le prime 8, in un riquadro che scorre: le frazioni di un nome comune sono decine.
function CampoCitta({ id, valore, errore, onScrivi, onScegli }: {
  id: string; valore: string; errore?: string; onScrivi: (v: string) => void; onScegli: (v: Suggerimento) => void
}) {
  const [voci, setVoci] = useState<Suggerimento[]>([])
  const [aperto, setAperto] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultima = useRef(0)

  function scrivi(v: string) {
    onScrivi(v)
    if (timer.current) clearTimeout(timer.current)
    if (v.trim().length < 2) { ultima.current++; setVoci([]); setAperto(false); return }
    timer.current = setTimeout(async () => {
      // Le risposte possono arrivare in disordine: vale solo l'ultima richiesta partita.
      const n = ++ultima.current
      try {
        const r = await fetch('/api/comuni?q=' + encodeURIComponent(v.trim()))
        const j = await r.json()
        if (n !== ultima.current) return
        setVoci(Array.isArray(j) ? suggerimenti(j as Voce[], /^\d+$/.test(v.trim())) : [])
        setAperto(true)
      } catch { if (n === ultima.current) setVoci([]) }
    }, 200)
  }

  return (
    <div onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAperto(false) }}>
      <input id={id} value={valore} onChange={e => scrivi(e.target.value)} onFocus={() => { if (voci.length) setAperto(true) }}
        placeholder="Scrivi la città o il CAP e sceglila" autoComplete="off" spellCheck={false}
        aria-invalid={!!errore} aria-describedby={errore ? id + '-errore' : undefined} style={inp(errore)} />
      {aperto && voci.length > 0 && (
        // tabIndex -1: un clic sulla barra di scorrimento sposta il fuoco sull'elenco, che sta dentro il
        // riquadro, e l'elenco resta aperto invece di chiudersi sotto il dito.
        <div role="listbox" tabIndex={-1}
          style={{ marginTop: '4px', border: '1px solid #d1d5db', borderRadius: '8px', background: '#fff', maxHeight: '264px', overflowY: 'auto', overscrollBehavior: 'contain', outline: 'none' }}>
          {voci.map((v, i) => (
            <button key={v.nome + v.sigla + v.cap + i} type="button" role="option" aria-selected={false}
              // Il campo non deve perdere il fuoco al tocco, altrimenti l'elenco si chiude prima del clic.
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                // Una ricerca ancora in volo riaprirebbe l'elenco sopra la scelta appena fatta.
                if (timer.current) clearTimeout(timer.current)
                ultima.current++
                onScegli(v); setAperto(false); setVoci([])
              }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderTop: i ? '1px solid #f0f0f0' : 'none', background: '#fff', fontSize: '15px', color: '#1a1a1a', cursor: 'pointer', fontFamily: 'inherit' }}>
              {v.nome} <span style={{ color: '#6b7280' }}>({v.sigla}) {v.caps ? '· più CAP, scrivi il tuo' : v.cap}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BloccoIndirizzo({ pre, f, errori, set }: {
  pre: 'sl' | 'so'; f: DatiSchermataNegozio; errori: Record<string, string>; set: (p: Partial<DatiSchermataNegozio>) => void
}) {
  const k = (c: 'indirizzo' | 'citta' | 'cap' | 'provincia') => `${pre}_${c}` as Campo
  const tipo = pre === 'sl' ? 'billing' : 'shipping'
  const descr = (c: Campo) => errori[c] ? 'dn-' + c + '-errore' : undefined
  // Scelta una citta' con piu' CAP, sotto il campo CAP si dice quali sono, finche' non si cambia citta'.
  const [notaCap, setNotaCap] = useState('')
  function scegli(v: Suggerimento) {
    if (!v.caps) {
      setNotaCap('')
      set({ [k('citta')]: v.nome, [k('provincia')]: v.sigla, [k('cap')]: v.cap })
      return
    }
    // Un CAP gia' scritto che e' di quella citta' resta: chi riscegliesse la citta' solo per correggerne
    // il nome non deve riscriverlo.
    const cap = f[k('cap')].trim()
    set({ [k('citta')]: v.nome, [k('provincia')]: v.sigla, [k('cap')]: v.caps.includes(cap) ? cap : '' })
    setNotaCap(`${v.nome} ha più CAP (da ${v.caps[0]} a ${v.caps[v.caps.length - 1]}): scrivi quello del tuo indirizzo.`)
    requestAnimationFrame(() => document.getElementById('dn-' + k('cap'))?.focus())
  }
  // Il limite di 35 caratteri si vede mentre si scrive, non solo dopo il rifiuto: il campo non tronca,
  // perche' un indirizzo incollato e tagliato in silenzio perderebbe proprio il numero civico.
  const lunghezza = f[k('indirizzo')].trim().replace(/\s+/g, ' ').length
  const erroreIndirizzo = errori[k('indirizzo')]
    || (lunghezza > 35 ? `Al massimo 35 caratteri (ora ${lunghezza}): è quanto entra nell'etichetta. Abbrevia, per esempio «V.» invece di «Via».` : undefined)
  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      <Riquadro id={'dn-' + k('indirizzo')} etichetta="Indirizzo" errore={erroreIndirizzo}>
        <input id={'dn-' + k('indirizzo')} value={f[k('indirizzo')]} onChange={e => set({ [k('indirizzo')]: e.target.value })}
          placeholder="Via e numero civico" autoComplete={tipo + ' address-line1'} maxLength={80}
          aria-invalid={!!erroreIndirizzo} aria-describedby={erroreIndirizzo ? 'dn-' + k('indirizzo') + '-errore' : undefined}
          style={inp(erroreIndirizzo)} />
      </Riquadro>
      <Riquadro id={'dn-' + k('citta')} etichetta="Città" errore={errori[k('citta')]}>
        <CampoCitta id={'dn-' + k('citta')} valore={f[k('citta')]} errore={errori[k('citta')]}
          onScrivi={v => { setNotaCap(''); set({ [k('citta')]: v }) }}
          onScegli={scegli} />
      </Riquadro>
      <div style={coppia}>
        <Riquadro id={'dn-' + k('provincia')} etichetta="Provincia" errore={errori[k('provincia')]}>
          <select id={'dn-' + k('provincia')} value={f[k('provincia')]} onChange={e => set({ [k('provincia')]: e.target.value })}
            aria-invalid={!!errori[k('provincia')]} aria-describedby={descr(k('provincia'))} style={inp(errori[k('provincia')])}>
            <option value="">Scegli…</option>
            {PROVINCE_IT.map(p => <option key={p.sigla} value={p.sigla}>{p.nome} ({p.sigla})</option>)}
          </select>
        </Riquadro>
        <Riquadro id={'dn-' + k('cap')} etichetta="CAP" errore={errori[k('cap')]} nota={notaCap || undefined}>
          <input id={'dn-' + k('cap')} value={f[k('cap')]} onChange={e => set({ [k('cap')]: e.target.value })}
            inputMode="numeric" maxLength={5} autoComplete={tipo + ' postal-code'}
            aria-invalid={!!errori[k('cap')]} aria-describedby={descr(k('cap'))} style={inp(errori[k('cap')])} />
        </Riquadro>
      </div>
    </div>
  )
}

// - versione: l'impronta dei dati che il layout ha usato per aprire la schermata; torna alla rotta col
//   salvataggio, che rifiuta se nel frattempo i dati sono cambiati. Si legge al momento dell'invio, non
//   all'apertura: dopo un rifiuto il layout ricaricato ne manda una nuova.
// - avviso: il perche' dell'ultimo rifiuto per dati cambiati. Lo tiene ClienteShell, perche' sopravviva
//   alla schermata che riparte da capo coi dati nuovi; si mostra in cima, dove si riparte a leggere.
// - contatto: a chi scrivere se un dato giusto non passa i controlli (lo decide il layout).
export default function CompletaDatiNegozio({ dati, versione, contatto, avviso, brandLogo, brandNome, onCambiati, onFatto }: {
  dati: DatiSchermataNegozio; versione: string | null; contatto: string | null; avviso: string
  brandLogo?: string | null; brandNome?: string | null; onCambiati: (avviso: string) => void; onFatto: () => void
}) {
  const router = useRouter()
  const [f, setF] = useState<DatiSchermataNegozio>(dati)
  const [uguale, setUguale] = useState(() => ritiroUguale(dati))
  const [errori, setErrori] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [invio, setInvio] = useState(false)
  const sfondo = useRef<HTMLDivElement>(null)

  // Scrivere in un campo toglie il suo errore: resta rosso solo cio' che e' ancora da sistemare.
  function set(p: Partial<DatiSchermataNegozio>) {
    setF(prev => ({ ...prev, ...p }))
    setErrori(prev => {
      const n = { ...prev }
      for (const c of Object.keys(p)) {
        delete n[c]
        if (c === 'piva' || c === 'cf') delete n.piva_cf
        if (c === 'cod_sdi' || c === 'pec') delete n.sdi_pec
      }
      return n
    })
  }

  // Togliendo la spunta il ritiro parte dalla sede legale: di solito cambia solo un pezzo (il magazzino
  // sta nella stessa citta'), e riscrivere tutto da capo sarebbe solo un'occasione di errore.
  function cambiaUguale(v: boolean) {
    setUguale(v)
    if (!v && [f.so_indirizzo, f.so_citta, f.so_cap, f.so_provincia].every(x => !x.trim())) {
      set({ so_indirizzo: f.sl_indirizzo, so_citta: f.sl_citta, so_cap: f.sl_cap, so_provincia: f.sl_provincia })
    }
  }

  async function salva(e: React.FormEvent) {
    e.preventDefault()
    if (invio) return
    setInvio(true); setMsg('')
    if (avviso) onCambiati('')
    const corpo = {
      ...(uguale
        ? { ...f, so_indirizzo: f.sl_indirizzo, so_citta: f.sl_citta, so_cap: f.sl_cap, so_provincia: f.sl_provincia }
        : f),
      versione,
    }
    try {
      const r = await fetch('/api/cliente/dati-negozio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d?.ok) {
        window.dispatchEvent(new Event(EVENTO_DATI_NEGOZIO_SALVATI))
        onFatto()
        return
      }
      if (r.status === 409) {
        // Qualcuno ha toccato la riga mentre si compilava (il master dalla scheda, un'altra finestra): si
        // rilegge il layout e si resta qui. Se i dati a schermo sono cambiati la schermata riparte da
        // quelli nuovi, altrimenti restano i valori scritti e basta salvare di nuovo. In tutti e due i
        // casi la spiegazione sta in cima e la schermata torna li': chi ha premuto Salva e' in fondo, e
        // non vedrebbe ne' l'avviso ne' i campi cambiati.
        if (d?.motivo === 'cambiati') {
          setErrori({})
          onCambiati(d.error || 'Mentre compilavi, i dati del tuo negozio sono stati modificati: controlla i campi e salva di nuovo.')
          setInvio(false)
          sfondo.current?.scrollTo({ top: 0 })
          router.refresh()
          return
        }
        // I dati non servono piu' (gia' completi): si chiude, e il layout ricaricato lo conferma.
        window.dispatchEvent(new Event(EVENTO_DATI_NEGOZIO_SALVATI))
        onFatto()
        return
      }
      const campi: Record<string, string> = { ...(d?.campi || {}) }
      // Con la spunta il ritiro e' la sede legale: un errore sul ritiro va mostrato sul campo della sede,
      // l'unico a schermo.
      if (uguale) for (const c of ['indirizzo', 'citta', 'cap', 'provincia']) {
        if (campi['so_' + c] && !campi['sl_' + c]) campi['sl_' + c] = campi['so_' + c]
        delete campi['so_' + c]
      }
      setErrori(campi)
      setMsg(r.status === 403
        ? 'La sessione non è più valida: esci e rientra.'
        : (d?.error || 'Salvataggio non riuscito, riprova.'))
      const primo = ORDINE.find(c => campi[c])
      if (primo) requestAnimationFrame(() => {
        const el = document.getElementById('dn-' + (ANCORA[primo] || primo))
        el?.focus()
        el?.scrollIntoView({ block: 'center' })
      })
    } catch {
      setMsg('Connessione non riuscita, riprova.')
    }
    setInvio(false)
  }

  const input = (c: Campo, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={'dn-' + c} value={f[c]} onChange={e => set({ [c]: e.target.value })}
      aria-invalid={!!errori[c]} aria-describedby={errori[c] ? 'dn-' + c + '-errore' : undefined}
      style={inp(errori[c])} {...extra} />
  )

  // LA VIA D'USCITA. La schermata non si chiude senza salvare e il pulsante Supporto della testata le sta
  // sotto: chi ha un dato vero che i controlli non accettano (un CAP nuovo che l'archivio non conosce,
  // una sede all'estero) poteva solo uscire. Qui c'e' a chi scrivere, sempre a vista: un indirizzo e
  // non il modulo di supporto, che risponderebbe all'email del conto, nostra e senza casella.
  const scriviA = contatto
    ? `mailto:${contatto}?subject=${encodeURIComponent('Dati del negozio' + (f.ragione_sociale.trim() ? ': ' + f.ragione_sociale.trim() : ''))}`
    : null

  return (
    <div ref={sfondo} role="dialog" aria-modal="true" aria-labelledby="dn-titolo"
      style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(15,15,15,.72)', overflowY: 'auto', overscrollBehavior: 'contain', padding: '16px', fontFamily: 'var(--font-geist-sans),system-ui,sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: '14px', maxWidth: '640px', margin: '0 auto', boxShadow: '0 20px 60px rgba(0,0,0,.4)', overflow: 'hidden' }}>
        <div style={{ background: '#1a1a1a', padding: '14px clamp(16px, 4vw, 28px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px' }}>
          {brandLogo ? (
            <img src={brandLogo} alt={brandNome || 'Logo'} style={{ maxHeight: '30px', maxWidth: '180px', objectFit: 'contain', display: 'block' }} />
          ) : brandNome ? (
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>{brandNome}</div>
          ) : (
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>Moov<span style={{ color: ACCENT }}>Express</span></div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {scriviA && <a href={scriviA} style={{ color: '#d4d4d4', fontSize: '14px', textDecoration: 'none', whiteSpace: 'nowrap', padding: '6px 2px' }}>Serve aiuto?</a>}
            <a href="/api/auth/logout" style={{ color: '#d4d4d4', fontSize: '14px', textDecoration: 'none', whiteSpace: 'nowrap', padding: '6px 2px' }}>Esci →</a>
          </div>
        </div>

        <form onSubmit={salva} noValidate style={{ padding: 'clamp(16px, 4vw, 28px)', display: 'grid', gap: '22px' }}>
          <div>
            <h2 id="dn-titolo" style={{ fontSize: '19px', fontWeight: 800, color: '#1a1a1a', margin: '0 0 8px' }}>Completa i dati del tuo negozio</h2>
            <p style={{ fontSize: '14.5px', color: '#444', lineHeight: 1.6, margin: 0 }}>
              Ci servono una volta sola, prima della prima spedizione: l&apos;indirizzo da cui il corriere ritira i pacchi,
              un telefono per il ritiro e i dati per intestarti le fatture.
            </p>
            {avviso && <div role="status" style={{ marginTop: '12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px 12px', fontSize: '14px', color: '#9a3412', lineHeight: 1.5 }}>{avviso}</div>}
          </div>

          <section style={{ display: 'grid', gap: '12px' }}>
            <h3 style={titoloSezione}>Dati per la fattura</h3>
            <Riquadro id="dn-ragione_sociale" etichetta="Ragione sociale" errore={errori.ragione_sociale}>
              {input('ragione_sociale', { placeholder: "Nome dell'azienda, o nome e cognome", autoComplete: 'organization', maxLength: 160 })}
            </Riquadro>
            <div>
              <div style={coppia}>
                <Riquadro id="dn-piva" etichetta="Partita IVA" errore={errori.piva}>
                  {input('piva', { placeholder: '11 cifre', inputMode: 'numeric', autoComplete: 'off', maxLength: 16 })}
                </Riquadro>
                <Riquadro id="dn-cf" etichetta="Codice fiscale" errore={errori.cf}>
                  {input('cf', { autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false, maxLength: 16 })}
                </Riquadro>
              </div>
              {errori.piva_cf
                ? <div style={sbagliato}>{errori.piva_cf}</div>
                : <div style={aiuto}>Basta uno dei due: la partita IVA se hai un&apos;attività, il codice fiscale se sei un privato.</div>}
            </div>
            <div>
              <div style={coppia}>
                <Riquadro id="dn-cod_sdi" etichetta="Codice destinatario (SDI)" errore={errori.cod_sdi}>
                  {input('cod_sdi', { placeholder: '7 caratteri', autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false, maxLength: 7 })}
                </Riquadro>
                <Riquadro id="dn-pec" etichetta="PEC" errore={errori.pec}>
                  {input('pec', { type: 'email', inputMode: 'email', autoComplete: 'off', spellCheck: false, maxLength: 160 })}
                </Riquadro>
              </div>
              {errori.sdi_pec
                ? <div style={sbagliato}>{errori.sdi_pec}</div>
                : <div style={aiuto}>Basta uno dei due: è dove ti arrivano le fatture elettroniche.</div>}
            </div>
            <Riquadro id="dn-email" etichetta="Email" errore={errori.email}
              nota="Un indirizzo che leggi davvero: sarà l'email del mittente sulle tue spedizioni.">
              {/* Si promette solo quello che il codice fa: l'unico che la legge e' il mittente
                  (lib/dati-negozio, emailMittenteCliente). "Per scriverti" era una promessa a vuoto:
                  supporto e avvisi scrivono ancora all'indirizzo del conto, che non riceve posta. */}
              {input('email', { type: 'email', inputMode: 'email', autoComplete: 'email', spellCheck: false, maxLength: 160, placeholder: 'nome@tuodominio.it' })}
            </Riquadro>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1a1a1a', marginTop: '6px' }}>Sede legale</div>
            <BloccoIndirizzo pre="sl" f={f} errori={errori} set={set} />
          </section>

          <section style={{ display: 'grid', gap: '12px' }}>
            <h3 style={titoloSezione}>Ritiro dei pacchi</h3>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '14.5px', color: '#1a1a1a', cursor: 'pointer', lineHeight: 1.45 }}>
              <input type="checkbox" checked={uguale} onChange={e => cambiaUguale(e.target.checked)} style={{ width: '20px', height: '20px', marginTop: '1px', flexShrink: 0, accentColor: ACCENT }} />
              Il corriere ritira all&apos;indirizzo della sede legale
            </label>
            {!uguale && (
              <>
                <div style={aiuto}>Da qui partono i pacchi: è il mittente di ogni spedizione.</div>
                <BloccoIndirizzo pre="so" f={f} errori={errori} set={set} />
              </>
            )}
            <Riquadro id="dn-telefono" etichetta="Telefono per il ritiro" errore={errori.telefono}
              nota="Il corriere lo usa se deve contattarti al ritiro.">
              {input('telefono', { type: 'tel', inputMode: 'tel', autoComplete: 'tel', maxLength: 25, placeholder: 'Es. 333 1234567' })}
            </Riquadro>
          </section>

          <div style={{ display: 'grid', gap: '10px' }}>
            {msg && <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px', fontSize: '14px', color: '#b91c1c', lineHeight: 1.5 }}>{msg}</div>}
            <button type="submit" disabled={invio}
              style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '10px', padding: '13px 20px', fontSize: '16px', fontWeight: 700, cursor: invio ? 'default' : 'pointer', opacity: invio ? 0.7 : 1, width: '100%' }}>
              {invio ? 'Salvataggio…' : 'Salva e inizia a spedire'}
            </button>
            {scriviA && (
              <div style={{ ...aiuto, textAlign: 'center', marginTop: 0 }}>
                Serve aiuto? Se un dato giusto non viene accettato, o per cambiarli più avanti, scrivi a{' '}
                <a href={scriviA} style={{ color: '#c2410c', fontWeight: 600, overflowWrap: 'anywhere' }}>{contatto}</a>.
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
