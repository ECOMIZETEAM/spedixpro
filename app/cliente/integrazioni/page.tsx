'use client'

import { useEffect, useState } from 'react'

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
}

// Piattaforme del popup — solo Shopify attivo, resto "Prossimamente"
const PLATFORMS: { id: string; nome: string; attivo: boolean; colore: string; dominio: string }[] = [
  { id: 'shopify',     nome: 'Shopify',      attivo: true,  colore: '#95BF47', dominio: 'shopify.com' },
  { id: 'woocommerce', nome: 'WooCommerce',  attivo: true,  colore: '#96588a', dominio: 'woocommerce.com' },
  { id: 'prestashop',  nome: 'PrestaShop',   attivo: true,  colore: '#df0067', dominio: 'prestashop.com' },
  { id: 'amazon',      nome: 'Amazon',       attivo: false, colore: '#ff9900', dominio: 'amazon.com' },
  { id: 'ebay',        nome: 'eBay',         attivo: false, colore: '#e53238', dominio: 'ebay.com' },
  { id: 'magento',     nome: 'Magento',      attivo: false, colore: '#f46f25', dominio: 'magento.com' },
  { id: 'wix',         nome: 'Wix',          attivo: false, colore: '#000000', dominio: 'wix.com' },
  { id: 'bigcommerce', nome: 'BigCommerce',  attivo: false, colore: '#121118', dominio: 'bigcommerce.com' },
  { id: 'squarespace', nome: 'Squarespace',  attivo: false, colore: '#000000', dominio: 'squarespace.com' },
  { id: 'tiktok',      nome: 'TikTok Shop',  attivo: false, colore: '#000000', dominio: 'tiktok.com' },
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

export default function IntegrazioniPage() {
  const [items, setItems] = useState<Integrazione[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [modal, setModal] = useState(false)
  const [step, setStep] = useState<'platforms' | 'shopify' | 'prestashop' | 'woocommerce'>('platforms')
  const [psForm, setPsForm] = useState({ nome_negozio: '', url: '', webservice_key: '' })
  const [wooForm, setWooForm] = useState({ nome_negozio: '', url: '', consumer_key: '', consumer_secret: '' })
  const [shop, setShop] = useState('')
  const [connecting, setConnecting] = useState(false)

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

  function openModal() { setStep('platforms'); setShop(''); setModal(true) }
  function closeModal() { setModal(false) }

  function pickPlatform(id: string, attivo: boolean) {
    if (!attivo) return
    if (id === 'shopify') setStep('shopify')
    if (id === 'prestashop') setStep('prestashop')
    if (id === 'woocommerce') setStep('woocommerce')
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

  function connectShopify() {
    // Normalizza il dominio: accetta "nome", "nome.myshopify.com", "https://nome.myshopify.com/"
    let d = shop.trim().toLowerCase()
    d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!d) { setMsg({ type: 'err', text: 'Inserisci il dominio del tuo negozio Shopify' }); return }
    if (!d.includes('.myshopify.com')) d = `${d.replace(/\..*$/, '')}.myshopify.com`
    setConnecting(true)
    // Avvia l'OAuth Shopify (la route install arriva nel blocco successivo)
    window.location.href = `/api/integrazioni/shopify/install?shop=${encodeURIComponent(d)}`
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
      setMsg({ type: 'ok', text: 'PrestaShop collegato con successo' })
      setPsForm({ nome_negozio: '', url: '', webservice_key: '' })
      setModal(false); load()
    } catch {
      setConnecting(false); setMsg({ type: 'err', text: 'Errore di connessione' })
    }
  }

  async function rimuovi(id: string, nome: string) {
    if (!confirm(`Scollegare "${nome || 'questo negozio'}"?`)) return
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
        setMsg({ type: 'ok', text: `${data.importati ?? 0} ordini importati da ${it.nome_negozio || it.piattaforma}` })
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
              return (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px', border: '1px solid #eee', borderRadius: '8px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: (p?.colore || '#999') + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, color: p?.colore || '#666', flexShrink: 0 }}>
                    {(p?.nome || it.piattaforma).slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                  </div>
                  <span style={{ fontSize: '11.5px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px', color: s.c, background: s.bg }}>
                    {s.t}
                  </span>
                  <button
                    onClick={() => sincronizza(it)}
                    style={{ background: '#fff', border: '1px solid #ddd', borderRadius: '7px', padding: '7px 12px', fontSize: '12.5px', cursor: 'pointer', color: '#333' }}
                  >
                    Sincronizza
                  </button>
                  <button
                    onClick={() => rimuovi(it.id, it.nome_negozio || '')}
                    style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: '7px', padding: '7px 12px', fontSize: '12.5px', cursor: 'pointer', color: '#b91c1c' }}
                  >
                    Scollega
                  </button>
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
              <div style={{ padding: '20px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '6px' }}>
                  Dominio del tuo negozio Shopify
                </label>
                <input
                  value={shop}
                  onChange={e => setShop(e.target.value)}
                  placeholder="nome-negozio.myshopify.com"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') connectShopify() }}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', color: '#1a1a1a', outline: 'none' }}
                />
                <p style={{ fontSize: '12px', color: '#999', marginTop: '8px', lineHeight: 1.5 }}>
                  Lo trovi nell'URL del tuo admin Shopify. Ti reindirizzeremo a Shopify per autorizzare MoovExpress,
                  poi tornerai qui col negozio collegato.
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '18px' }}>
                  <button
                    onClick={() => setStep('platforms')}
                    style={{ background: '#fff', color: '#555', border: '1px solid #ddd', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', cursor: 'pointer' }}
                  >
                    ← Indietro
                  </button>
                  <button
                    onClick={connectShopify}
                    disabled={connecting}
                    style={{ background: ACCENT, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '13px', fontWeight: 600, cursor: connecting ? 'default' : 'pointer', opacity: connecting ? .6 : 1 }}
                  >
                    {connecting ? 'Reindirizzamento…' : 'Collega'}
                  </button>
                </div>
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
                <p style={{ fontSize: '12px', color: '#999', marginTop: '8px', lineHeight: 1.5 }}>La Webservice Key si genera in PrestaShop: Parametri Avanzati &rarr; Webservice &rarr; Aggiungi nuova chiave.</p>
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
