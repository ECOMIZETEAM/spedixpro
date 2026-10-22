'use client'

import { useEffect, useState } from 'react'
import { isAppNativa } from '@/lib/app-nativa'
import { LINK_COLLEGA_SHOPIFY } from '@/lib/shopify-scheda-app'

const ACCENT = '#f97316'

type Integrazione = {
  id: string
  piattaforma: string
  nome_negozio: string | null
  identificativo: string | null
  stato: string
  ultimo_sync: string | null
  ordini_totali: number
  errore: string | null
  created_at: string
  stati_ordini?: string   // solo WooCommerce: stati ordine da importare (custom compresi)
}

// Piattaforme del popup: quelle con attivo:false si vedono con "Prossimamente" e non si aprono
const PLATFORMS: { id: string; nome: string; attivo: boolean; colore: string; dominio: string }[] = [
  { id: 'shopify',     nome: 'Shopify',      attivo: true,  colore: '#95BF47', dominio: 'shopify.com' },
  { id: 'woocommerce', nome: 'WooCommerce',  attivo: true,  colore: '#96588a', dominio: 'woocommerce.com' },
  { id: 'prestashop',  nome: 'PrestaShop',   attivo: true,  colore: '#df0067', dominio: 'prestashop.com' },
  // Amazon spento finche' Amazon non approva l'app (SP-API): il collegamento c'e', ma senza
  // l'approvazione nessun venditore potrebbe autorizzarlo. Intanto gli ordini Amazon entrano da file.
  { id: 'amazon',      nome: 'Amazon',       attivo: false, colore: '#ff9900', dominio: 'amazon.com' },
  { id: 'ebay',        nome: 'eBay',         attivo: true,  colore: '#e53238', dominio: 'ebay.com' },
  { id: 'magento',     nome: 'Magento',      attivo: false, colore: '#f46f25', dominio: 'magento.com' },
  { id: 'wix',         nome: 'Wix',          attivo: false, colore: '#000000', dominio: 'wix.com' },
  { id: 'bigcommerce', nome: 'BigCommerce',  attivo: false, colore: '#121118', dominio: 'bigcommerce.com' },
  { id: 'squarespace', nome: 'Squarespace',  attivo: false, colore: '#000000', dominio: 'squarespace.com' },
  // Temu/TikTok disattivati (non collegabili) finché il cron sync-cron non li sincronizza davvero:
  // oggi il loro OAuth funziona ma il cron NON importa gli ordini (cade nel default dello switch),
  // così il merchant crederebbe che sincronizzi mentre non lo fa. Riattivare insieme al ramo cron.
  { id: 'tiktok',      nome: 'TikTok Shop',  attivo: false, colore: '#000000', dominio: 'tiktokshop.com' },
  { id: 'temu',        nome: 'Temu',         attivo: false, colore: '#fb7701', dominio: 'temu.com' },
  { id: 'storeden',    nome: 'Storeden',     attivo: false, colore: '#e2001a', dominio: 'storeden.com' },
  { id: 'manomano',    nome: 'ManoMano',     attivo: false, colore: '#00817d', dominio: 'manomano.com' },
]

const STATO: Record<string, { t: string; c: string; bg: string }> = {
  attivo:       { t: 'Attivo',       c: '#15803d', bg: '#dcfce7' },
  in_pausa:     { t: 'In pausa',     c: '#b45309', bg: '#fef3c7' },
  errore:       { t: 'Errore',       c: '#b91c1c', bg: '#fee2e2' },
  disconnesso:  { t: 'Disconnesso',  c: '#6b7280', bg: '#f3f4f6' },
}

const card: React.CSSProperties = {
  background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '20px',
}

import { useDialog } from '@/app/components/DialogProvider'
export default function IntegrazioniPage() {
  const dialog = useDialog()
  const [items, setItems] = useState<Integrazione[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [modal, setModal] = useState(false)
  const [step, setStep] = useState<'platforms' | 'shopify' | 'prestashop' | 'woocommerce'>('platforms')
  const [psForm, setPsForm] = useState({ nome_negozio: '', url: '', webservice_key: '' })
  const [wooForm, setWooForm] = useState({ nome_negozio: '', url: '', consumer_key: '', consumer_secret: '' })
  const [connecting, setConnecting] = useState(false)
  const [statiEdit, setStatiEdit] = useState<Record<string, string>>({})
  const [salvandoStati, setSalvandoStati] = useState('')

  async function salvaStati(it: Integrazione) {
    setSalvandoStati(it.id)
    try {
      const val = statiEdit[it.id] ?? (it.stati_ordini || '')
      const res = await fetch('/api/integrazioni/woocommerce/stati', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrazione_id: it.id, stati: val }),
      })
      const d = await res.json()
      if (res.ok) { setMsg({ type: 'ok', text: 'Stati ordine salvati. Al prossimo sync verranno importati.' }); await load() }
      else setMsg({ type: 'err', text: d.error || 'Errore salvataggio stati' })
    } catch {
      setMsg({ type: 'err', text: 'Errore di rete' })
    } finally { setSalvandoStati('') }
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/integrazioni/lista')
      const data = await res.json()
      if (res.ok) setItems(data.integrazioni || [])
      else setMsg({ type: 'err', text: data.error || 'Errore caricamento' })
    } catch {
      setMsg({ type: 'err', text: 'Errore di rete' })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // ESITO DEL COLLEGAMENTO AMAZON. Le rotte Amazon tornano qui con un CODICE (?amazon=…), e la frase
  // la scrive questa pagina: un testo preso dall'indirizzo farebbe scrivere a chiunque cosa vuole
  // nel riquadro dei messaggi. Poi il codice si toglie dall'indirizzo, cosi' un ricarica non lo ripete.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const esito = sp.get('amazon')
    if (!esito) return
    const FRASI: Record<string, { type: 'ok' | 'err'; text: string }> = {
      collegato: { type: 'ok', text: 'Account Amazon collegato. Gli ordini da spedire arrivano nei prossimi minuti.' },
      rinnovato: { type: 'ok', text: 'Collegamento Amazon rinnovato.' },
      non_valido: { type: 'err', text: 'Collegamento Amazon non riuscito: la richiesta non è valida. Riprova da qui con «Collega negozio» → Amazon.' },
      scaduto: { type: 'err', text: 'Il collegamento con Amazon è scaduto prima di essere completato. Riprova da qui con «Collega negozio» → Amazon.' },
      scambio: { type: 'err', text: 'Amazon non ha confermato il collegamento. Riprova tra qualche minuto; se si ripete, contatta l\'assistenza.' },
      salvataggio: { type: 'err', text: 'Collegamento Amazon non salvato. Riprova; se si ripete, contatta l\'assistenza.' },
      non_avviato: { type: 'err', text: 'Collegamento Amazon non avviato. Riprova tra qualche minuto.' },
    }
    setMsg(FRASI[esito] || FRASI.non_valido)
    sp.delete('amazon')
    const resto = sp.toString()
    window.history.replaceState(null, '', window.location.pathname + (resto ? '?' + resto : ''))
  }, [])

  function openModal() { setStep('platforms'); setModal(true) }
  function closeModal() { setModal(false) }

  function pickPlatform(id: string, attivo: boolean) {
    if (!attivo) return
    if (id === 'shopify') setStep('shopify')
    if (id === 'prestashop') setStep('prestashop')
    if (id === 'woocommerce') setStep('woocommerce')
    if (id === 'ebay') { setConnecting(true); window.location.href = '/api/integrazioni/ebay/install' }
    if (id === 'amazon') { collegaAmazon(); return }
    if (id === 'tiktok') { setConnecting(true); window.location.href = '/api/integrazioni/tiktok/install' }
    if (id === 'temu') { setConnecting(true); window.location.href = '/api/integrazioni/temu/install' }
  }

  // AMAZON: il collegamento parte con un POST da questa pagina (la rotta rifiuta un link aperto da
  // un altro sito) e torna l'indirizzo di Seller Central a cui andare.
  // Nell'app iOS/Android no: Seller Central si apre nel browser del telefono, che non ha la sessione
  // dell'app, e al ritorno il collegamento verrebbe rifiutato (chi chiude il giro dev'essere chi
  // l'ha aperto). Meglio dirlo prima che sprecare un consenso su Amazon.
  // I messaggi si danno dopo aver chiuso la finestra delle piattaforme: sotto resterebbero coperti.
  async function collegaAmazon() {
    if (isAppNativa()) {
      closeModal()
      await dialog.alert({ title: 'Amazon si collega dal browser', message: 'Apri moovexpress.com dal computer o da Safari/Chrome, accedi e vai in Integrazioni → Amazon.' })
      return
    }
    setConnecting(true)
    try {
      const res = await fetch('/api/integrazioni/amazon/install', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.url) { window.location.href = d.url; return }
      closeModal()
      setMsg({ type: 'err', text: d.error || 'Collegamento Amazon non avviato' })
    } catch {
      closeModal()
      setMsg({ type: 'err', text: 'Errore di rete' })
    }
    setConnecting(false)
  }

  async function connettiWoo() {
    if (!wooForm.url || !wooForm.consumer_key || !wooForm.consumer_secret) { setMsg({ type: 'err', text: 'URL, Consumer Key e Secret obbligatori' }); return }
    setConnecting(true)
    try {
      const res = await fetch('/api/integrazioni/woocommerce/connetti', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wooForm),
      })
      const d = await res.json()
      setConnecting(false)
      if (d.error) { setMsg({ type: 'err', text: d.error }); return }
      setMsg({ type: 'ok', text: 'WooCommerce collegato con successo' })
      setWooForm({ nome_negozio: '', url: '', consumer_key: '', consumer_secret: '' })
      setModal(false); load()
    } catch {
      setConnecting(false); setMsg({ type: 'err', text: 'Errore di connessione' })
    }
  }

  // SHOPIFY NELL'APP iOS/ANDROID: come per Amazon, niente scheda dell'App Store dentro l'app. Il giro
  // passa dall'App Store e dal login di Shopify dentro la WebView e deve tornare sul portale: non e' mai
  // stato provato, e se si interrompe a meta' il negozio resta con l'app installata ma non collegato.
  async function shopifyDalBrowser() {
    closeModal()
    await dialog.alert({ title: 'Shopify si collega dal browser', message: 'Apri moovexpress.com dal computer o da Safari/Chrome, accedi e da Importa Ordini → Negozi collegati scegli «+ Collega negozio» → Shopify.' })
  }

  async function connettiPrestashop() {
    if (!psForm.url || !psForm.webservice_key) { setMsg({ type: 'err', text: 'URL e Webservice Key obbligatori' }); return }
    setConnecting(true)
    try {
      const res = await fetch('/api/integrazioni/prestashop/connetti', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(psForm),
      })
      const d = await res.json()
      setConnecting(false)
      if (d.error) { setMsg({ type: 'err', text: d.error }); return }
      setMsg({ type: 'ok', text: 'PrestaShop collegato con successo' + (d.avviso ? '. Attenzione: ' + d.avviso : '') })
      setPsForm({ nome_negozio: '', url: '', webservice_key: '' })
      setModal(false); load()
    } catch {
      setConnecting(false); setMsg({ type: 'err', text: 'Errore di connessione' })
    }
  }

  async function rimuovi(id: string, nome: string, piattaforma?: string, stato?: string) {
    // Amazon: le sue regole sui dati vogliono cancellati gli ordini di un account scollegato.
    // Shopify: da qui si cancella solo la riga, l'app resta installata sul negozio e chi la riapre
    // dall'admin lo ricollega. Non sempre allo stesso conto: quello nato da Shopify si ritrova da solo
    // (per indirizzo), uno che esisteva gia' ripassa dalla scelta «Hai già un account MoovExpress?», dove
    // senza la sua sessione si puo' anche aprire un conto nuovo (lib/shopifyProvision.ts,
    // trovaContoDelNegozio). Per questo la frase dice «può ricollegarlo» e non «torna a collegarsi». Va
    // detto prima, non dopo: chi scollega per smettere se lo ritroverebbe collegato. Non sul negozio
    // disconnesso, dove l'app e' gia' disinstallata.
    const message = piattaforma === 'amazon'
      ? 'Gli ordini Amazon non ancora spediti spariscono dal portale; quelli spediti restano, senza i dati del compratore. Ricollegando l\'account tornano gli ordini ancora da spedire.'
      : piattaforma === 'shopify' && stato !== 'disconnesso'
        ? 'MoovExpress resta installata sul negozio Shopify: chi la riapre dall\'admin del negozio può ricollegarlo. Per scollegarlo del tutto disinstalla MoovExpress dall\'admin del negozio Shopify.'
        : undefined
    if (!await dialog.confirm({ title: `Scollegare "${nome || 'questo negozio'}"?`, message, danger: true, confirmText: 'Scollega' })) return
    try {
      const res = await fetch('/api/integrazioni/elimina', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (res.ok) load()
      else setMsg({ type: 'err', text: data.error || 'Errore' })
    } catch { setMsg({ type: 'err', text: 'Errore di rete' }) }
  }

  async function sincronizza(it: Integrazione) {
    setMsg(null)
    try {
      const res = await fetch(`/api/integrazioni/${it.piattaforma}/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id }),
      })
      const data = await res.json()
      if (res.ok) {
        // L'avviso del negozio (lettura parziale di Amazon, permessi PrestaShop) va detto anche qui:
        // senza, una lettura interrotta sembra completa.
        setMsg({ type: 'ok', text: `${data.importati ?? 0} ordini importati da ${it.nome_negozio || it.piattaforma}` + (data.avviso ? ' — ⚠ ' + data.avviso : '') })
        load()
      } else {
        setMsg({ type: 'err', text: data.error || 'Sincronizzazione non disponibile' })
      }
    } catch {
      setMsg({ type: 'err', text: 'Errore di rete durante la sincronizzazione' })
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Negozi collegati</h1>
          <p style={{ color: '#999', fontSize: '13px', marginTop: '4px' }}>
            Collega i tuoi canali di vendita per importare gli ordini in automatico
          </p>
        </div>
        <button
          onClick={openModal}
          style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
        >
          + Collega negozio
        </button>
      </div>

      {msg && (
        <div style={{
          marginBottom: '16px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px',
          border: `1px solid ${msg.type === 'ok' ? '#bbf7d0' : '#fecaca'}`,
          background: msg.type === 'ok' ? '#f0fdf4' : '#fef2f2',
          color: msg.type === 'ok' ? '#15803d' : '#b91c1c',
        }}>
          {msg.text}
        </div>
      )}

      {/* Lista negozi */}
      <div style={card}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Caricamento…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '50px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🛒</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#999', marginBottom: '14px' }}>Nessun negozio collegato</div>
            <button
              onClick={openModal}
              style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
            >
              + Collega il primo negozio
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {items.map(it => {
              const p = PLATFORMS.find(x => x.id === it.piattaforma)
              const s = STATO[it.stato] || STATO.disconnesso
              // Un negozio Shopify diventa 'disconnesso' solo quando il negoziante disinstalla l'app: il
              // webhook app/uninstalled svuota le credenziali e la riga resta per lo storico. Da li' si
              // riparte solo reinstallando l'app sul negozio, non da questa pagina.
              const shopify = it.piattaforma === 'shopify'
              const shopifyDisinstallato = shopify && it.stato === 'disconnesso'
              return (
                <div key={it.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px', border: '1px solid #eee', borderRadius: '8px' }}>
                 {/* Sul telefono stato e pulsanti vanno a capo: senza, la colonna del negozio si
                     stringeva a poche decine di pixel e gli avvisi uscivano una parola per riga, sopra
                     il badge dello stato. Sul computer la riga resta com'era. */}
                 <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: (p?.colore || '#999') + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, color: p?.colore || '#666', flexShrink: 0 }}>
                    {(p?.nome || it.piattaforma).slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#1a1a1a' }}>
                      {it.nome_negozio || it.identificativo || (p?.nome || it.piattaforma)}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#999' }}>
                      {p?.nome || it.piattaforma}
                      {it.ultimo_sync ? ` · ultimo sync ${new Date(it.ultimo_sync).toLocaleString('it-IT')}` : ' · mai sincronizzato'}
                      {` · ${it.ordini_totali} ordini`}
                    </div>
                    {it.stato === 'errore' && it.errore && (
                      <div style={{ fontSize: '11.5px', color: '#b91c1c', marginTop: '2px' }}>{it.errore}</div>
                    )}
                    {/* Negozio collegato e funzionante, ma con qualcosa da sistemare (permessi della
                        chiave, ultima sincronizzazione non riuscita): prima restava scritto
                        sull'integrazione e nessuno lo vedeva, perche' si mostrava solo a negozio in errore. */}
                    {it.stato === 'attivo' && it.piattaforma === 'prestashop' && it.errore && (
                      <div style={{ fontSize: '11.5px', color: '#b45309', marginTop: '2px', lineHeight: 1.45 }}>⚠ {it.errore}</div>
                    )}
                    {/* Il motivo si mostrava solo con stato 'errore': il negozio disinstallato compariva
                        grigio e muto, con un «Sincronizza» che rispondeva solo «Credenziali Shopify
                        mancanti». La frase e' fissa, non il testo salvato: per Shopify 'disconnesso' lo
                        scrive solo app/uninstalled, ma `errore` lo riscrive il cron senza guardare lo stato,
                        e una sincronizzazione partita prima della disinstallazione puo' lasciarci «Riapri
                        MoovExpress dall'admin», che con l'app disinstallata non si puo' fare. */}
                    {shopifyDisinstallato && (
                      <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px', lineHeight: 1.45 }}>
                        App disinstallata dal negozio Shopify. Per ricollegarlo installa di nuovo MoovExpress dal tuo negozio Shopify.
                      </div>
                    )}
                    {/* Una sincronizzazione Shopify fallita lascia il negozio «Attivo»: l'errore finisce
                        in `errore` e l'ultimo sync si aggiorna lo stesso (sync-cron), quindi si vedeva un
                        negozio verde che non portava ordini. La frase e' fissa e non il testo tecnico
                        salvato: quello lo legge il controllo «Log & Errori» (lib/controllo-log-errori.ts).
                        Niente «riapri MoovExpress dall'admin»: su una riga 'attivo' /enter fa solo entrare e
                        non rifa' l'autorizzazione, quindi riaprire l'app non cambiava niente. Il token morto,
                        che l'autorizzazione ripara, porta la riga in 'errore' (lib/shopify.ts) e li' lo dice
                        gia' il testo rosso qui sopra; sull'attivo restano guasti che si riprovano da soli
                        (Shopify lento o fuori servizio, un rinnovo andato in 5xx) o che sistemiamo noi (il
                        403 sui dati protetti). «Ordini importati, ma:» (lib/shopifySync.ts) e' una
                        sincronizzazione riuscita a meta': gli ordini sono arrivati, «non riuscita» era falso. */}
                    {it.stato === 'attivo' && shopify && it.errore && (
                      <div style={{ fontSize: '11.5px', color: '#b45309', marginTop: '2px', lineHeight: 1.45 }}>
                        ⚠ {it.errore.startsWith('Ordini importati, ma:')
                          ? 'Ordini importati, ma annullamenti ed evasioni fatti sul negozio non sono ancora aggiornati qui: si riprova al prossimo giro automatico. Se dura, contatta l\'assistenza.'
                          : 'Ultima sincronizzazione non riuscita: si riprova da sola al prossimo giro automatico. Se dura, contatta l\'assistenza.'}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: '11.5px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px', color: s.c, background: s.bg }}>
                    {s.t}
                  </span>
                  {!shopifyDisinstallato && (
                    <button
                      onClick={() => sincronizza(it)}
                      style={{ background: '#fff', border: '1px solid #ddd', borderRadius: '7px', padding: '7px 12px', fontSize: '12.5px', cursor: 'pointer', color: '#333' }}
                    >
                      Sincronizza
                    </button>
                  )}
                  <button
                    onClick={() => rimuovi(it.id, it.nome_negozio || '', it.piattaforma, it.stato)}
                    style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: '7px', padding: '7px 12px', fontSize: '12.5px', cursor: 'pointer', color: '#b91c1c' }}
                  >
                    Scollega
                  </button>
                 </div>
                 {/* «Scollega» cancella la riga ma non tocca l'app installata sul negozio: chi la riapre
                     dall'admin di Shopify puo' ricollegarlo (vedi rimuovi). Lo scollegamento che dura e'
                     la disinstallazione, che arriva dal webhook app/uninstalled. */}
                 {shopify && !shopifyDisinstallato && (
                   <div style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'right', lineHeight: 1.4 }}>
                     Per scollegarlo del tutto disinstalla MoovExpress dall&apos;admin del negozio Shopify.
                   </div>
                 )}
                 {it.piattaforma === 'woocommerce' && (
                   <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid #f3f4f6', paddingTop: '10px' }}>
                     <label style={{ fontSize: '11.5px', color: '#6b7280', fontWeight: 600 }}>Stati ordine da importare</label>
                     <input
                       value={statiEdit[it.id] ?? (it.stati_ordini || '')}
                       onChange={e => setStatiEdit(prev => ({ ...prev, [it.id]: e.target.value }))}
                       placeholder="processing,on-hold"
                       style={{ flex: 1, minWidth: '220px', padding: '6px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12.5px', color: '#1a1a1a' }}
                     />
                     <button
                       onClick={() => salvaStati(it)}
                       disabled={salvandoStati === it.id}
                       style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: salvandoStati === it.id ? 0.6 : 1 }}
                     >
                       {salvandoStati === it.id ? 'Salvo…' : 'Salva'}
                     </button>
                     <span style={{ fontSize: '11px', color: '#9ca3af', width: '100%' }}>
                       Default: processing, on-hold. Aggiungi lo slug del tuo stato personalizzato (es. <b>in-preparazione</b>), separati da virgola. Scrivi <b>any</b> per importare TUTTI gli stati (esclusi annullati/rimborsati/completati). Vuoto = default.
                     </span>
                   </div>
                 )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal Collega negozio */}
      {modal && (
        <div
          onClick={closeModal}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '10px', width: '100%', maxWidth: '620px', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a' }}>
                {step === 'platforms' ? 'Seleziona piattaforma' : step === 'prestashop' ? 'Collega PrestaShop' : step === 'woocommerce' ? 'Collega WooCommerce' : 'Collega Shopify'}
              </div>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {step === 'platforms' ? (
              <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {PLATFORMS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => pickPlatform(p.id, p.attivo)}
                    disabled={!p.attivo}
                    style={{
                      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      padding: '18px 10px', borderRadius: '10px',
                      border: `1px solid ${p.attivo ? '#e5e5e5' : '#f0f0f0'}`,
                      background: p.attivo ? '#fff' : '#fafafa',
                      cursor: p.attivo ? 'pointer' : 'not-allowed',
                      opacity: p.attivo ? 1 : 0.55,
                    }}
                  >
                    <div style={{ width: '48px', height: '48px', borderRadius: '9px', background: '#fff', border: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${p.dominio}&sz=128`}
                        alt={p.nome}
                        style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }}
                        onError={(e) => { const t = e.currentTarget; t.style.display = 'none'; const s = t.nextElementSibling as HTMLElement; if (s) s.style.display = 'flex' }}
                      />
                      <span style={{ display: 'none', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, color: p.colore }}>{p.nome.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#1a1a1a' }}>{p.nome}</div>
                    {!p.attivo && (
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#9ca3af', background: '#f3f4f6', padding: '2px 7px', borderRadius: '999px' }}>Prossimamente</span>
                    )}
                  </button>
                ))}
              </div>
            ) : step === 'shopify' ? (
              // SHOPIFY SI COLLEGA DA QUI, PASSANDO DA SHOPIFY. Qui non si chiede il dominio del negozio: Shopify
              // lo vieta anche ad app gia' installata (requisito 2.3.1), e il campo che c'era fino al 21/10/2026
              // non ha mai collegato un negozio vero (520 tentativi da luglio). Il pulsante apre il link
              // d'installazione di Shopify (lib/shopify-scheda-app.ts): il cliente entra col suo account
              // Shopify, sceglie il negozio, e torna qui a confermare. Decisione di Lorenzo del 22/10/2026.
              <div style={{ padding: '20px' }}>
                <>
                    <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.6, margin: 0 }}>
                      Entra su Shopify con il tuo account, scegli il negozio da collegare e installa MoovExpress: al termine confermi il collegamento a questo account. Non serve scrivere il dominio.
                    </p>
                    {/* I nomi fra «» sono quelli della pagina della scelta (lib/shopify-pagina-scelta.ts),
                        che sta fuori dal portale: se cambiano la', vanno cambiati qui. «Crea il mio account»
                        darebbe al negozio un conto nuovo sotto il master dei negozi Shopify, non questo
                        (decisione D1). */}
                    <p style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.5, margin: '10px 0 0' }}>
                      Al ritorno da Shopify premi «Collega il negozio». Se invece ti chiediamo «Hai già un account MoovExpress?», usa «Accedi e collega» con email e password di questo account: «Crea il mio account» ne aprirebbe uno nuovo.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '18px' }}>
                      <button
                        onClick={() => setStep('platforms')}
                        style={{ background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
                      >
                        ← Indietro
                      </button>
                      {/* Un link a una pagina di Shopify (link d'installazione, poi la scheda dell'App
                          Store), nella stessa scheda del browser: niente finestre nuove per i passaggi
                          essenziali come l'OAuth (best practices). */}
                      <a
                        href={LINK_COLLEGA_SHOPIFY}
                        onClick={e => { if (isAppNativa()) { e.preventDefault(); shopifyDalBrowser() } }}
                        style={{ display: 'inline-flex', alignItems: 'center', background: ACCENT, color: '#fff', borderRadius: '8px', padding: '9px 20px', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}
                      >
                        Collega da Shopify
                      </a>
                    </div>
                </>
              </div>
            ) : step === 'woocommerce' ? (
              <div style={{ padding: '20px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '6px' }}>Nome sito (opzionale)</label>
                <input value={wooForm.nome_negozio} onChange={e => setWooForm(v => ({ ...v, nome_negozio: e.target.value }))} placeholder="Il mio negozio" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', color: '#1a1a1a', outline: 'none', marginBottom: '12px' }} />
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '6px' }}>URL sito *</label>
                <input value={wooForm.url} onChange={e => setWooForm(v => ({ ...v, url: e.target.value }))} placeholder="https://ilmionegozio.com" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', color: '#1a1a1a', outline: 'none', marginBottom: '12px' }} />
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '6px' }}>Consumer Key *</label>
                <input value={wooForm.consumer_key} onChange={e => setWooForm(v => ({ ...v, consumer_key: e.target.value }))} placeholder="ck_..." style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', color: '#1a1a1a', outline: 'none', marginBottom: '12px' }} />
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '6px' }}>Consumer Secret *</label>
                <input value={wooForm.consumer_secret} onChange={e => setWooForm(v => ({ ...v, consumer_secret: e.target.value }))} placeholder="cs_..." style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', color: '#1a1a1a', outline: 'none' }} />
                <p style={{ fontSize: '12px', color: '#999', marginTop: '8px', lineHeight: 1.5 }}>Le chiavi API si generano in WooCommerce: Impostazioni &rarr; Avanzate &rarr; API REST &rarr; Aggiungi chiave (permessi Lettura/Scrittura).</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '18px' }}>
                  <button onClick={() => setStep('platforms')} style={{ background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}>&larr; Indietro</button>
                  <button onClick={connettiWoo} disabled={connecting} style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '13px', fontWeight: 600, cursor: connecting ? 'default' : 'pointer', opacity: connecting ? .6 : 1 }}>{connecting ? 'Verifica…' : 'Collega'}</button>
                </div>
              </div>
            ) : (
              <div style={{ padding: '20px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '6px' }}>Nome sito (opzionale)</label>
                <input value={psForm.nome_negozio} onChange={e => setPsForm(v => ({ ...v, nome_negozio: e.target.value }))} placeholder="Il mio negozio" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', color: '#1a1a1a', outline: 'none', marginBottom: '12px' }} />
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '6px' }}>URL sito *</label>
                <input value={psForm.url} onChange={e => setPsForm(v => ({ ...v, url: e.target.value }))} placeholder="https://ilmionegozio.com" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', color: '#1a1a1a', outline: 'none', marginBottom: '12px' }} />
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '6px' }}>Webservice Key *</label>
                <input value={psForm.webservice_key} onChange={e => setPsForm(v => ({ ...v, webservice_key: e.target.value }))} placeholder="Chiave API PrestaShop" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', color: '#1a1a1a', outline: 'none' }} />
                <p style={{ fontSize: '12px', color: '#999', marginTop: '8px', lineHeight: 1.5 }}>La Webservice Key si genera in PrestaShop: Parametri Avanzati &rarr; Webservice &rarr; Aggiungi nuova chiave. Permessi da spuntare: <b>Visualizza (GET)</b> su orders, addresses, customers, states, countries, order_states, order_carriers; <b>Modifica (PUT)</b> su order_carriers; <b>Aggiungi (POST)</b> su order_histories.</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '18px' }}>
                  <button onClick={() => setStep('platforms')} style={{ background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}>&larr; Indietro</button>
                  <button onClick={connettiPrestashop} disabled={connecting} style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '13px', fontWeight: 600, cursor: connecting ? 'default' : 'pointer', opacity: connecting ? .6 : 1 }}>{connecting ? 'Verifica…' : 'Collega'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
