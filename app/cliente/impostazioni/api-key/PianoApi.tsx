'use client'
import { useState, useEffect } from 'react'

const ACCENT = '#f97316'

// IL PACCHETTO API, DAL LATO DI CHI LO PAGA.
//
// Una domanda sola: quante spedizioni ho fatto questo mese, e il pacchetto che ho basta?
// Tutto il resto — i prezzi, il confronto, il tasto per pagare — sta sotto quella risposta.

export default function PianoApi() {
  const [d, setD] = useState<any>(null)
  const [inCorso, setInCorso] = useState('')
  // Rinnovo automatico o un mese alla volta. Non e' un vezzo: molte carte aziendali e prepagate
  // rifiutano il mandato ricorrente pur avendo i soldi sopra, e con il pagamento singolo passano.
  const [modo, setModo] = useState<'abbonamento' | 'singolo'>('abbonamento')
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)

  async function carica() {
    const x = await fetch('/api/cliente/api-piano').then(r => r.json()).catch(() => null)
    setD(x)
  }
  useEffect(() => {
    carica()
    const q = new URLSearchParams(window.location.search)
    if (q.get('pagato')) setMsg({ t: 'ok', x: 'Pagamento registrato. Il pacchetto è attivo.' })
    // Tornato indietro dalla cassa senza aver pagato: quasi sempre e' la banca che ha rifiutato il
    // mandato ricorrente. Si passa da soli al mese singolo, che quelle carte accettano.
    if (q.get('rifiutato')) {
      setModo('singolo')
      setMsg({ t: 'err', x: 'La banca non ha accettato il rinnovo automatico. Puoi pagare questo mese con la stessa carta.' })
    }
  }, [])

  async function scegli(codice: string) {
    setInCorso(codice); setMsg(null)
    try {
      const r = await fetch('/api/cliente/api-piano', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ piano: codice, modo }),
      })
      const x = await r.json()
      if (x?.url) { window.location.href = x.url; return }
      if (x?.cambiato) { setMsg({ t: 'ok', x: 'Pacchetto cambiato.' }); carica() }
      else setMsg({ t: 'err', x: x?.error || 'Non riesco ad aprire il pagamento' })
    } catch { setMsg({ t: 'err', x: 'Errore di rete' }) }
    setInCorso('')
  }

  if (!d) return <div style={{ padding: '30px', color: '#8a8a8a', fontSize: '13px' }}>Caricamento…</div>
  if (d.error) return <div style={{ padding: '30px', color: '#dc2626', fontSize: '13px' }}>{d.error}</div>
  if (!d.haChiavi) return null   // non usa le API: questa sezione non lo riguarda

  const s = d.stato || {}
  const usate = Number(s.usate || 0), limite = Number(s.limite || 0)

  // I MESI PRECEDENTI SI RICONOSCONO DAL MESE, NON DALLA POSIZIONE.
  // Prima si scartava semplicemente la prima riga, dando per scontato che fosse il mese in corso.
  // Ma quella riga nasce con la prima chiamata API del mese: chi non ne ha ancora fatte non ce
  // l'ha, e allora la riga scartata era l'ultimo mese vero — che spariva dall'elenco.
  const meseCorrente = new Date().toISOString().slice(0, 7)
  const mesiPrecedenti = (d.storico || []).filter((x: any) => x.mese !== meseCorrente).slice(0, 3)

  // CHI NON PAGA NON DEVE VEDERE UN NEGOZIO.
  //
  // Le API le paga solo chi rivende le spedizioni fuori dal portale; per tutti gli altri sono
  // comprese, e per loro questa sezione era una vetrina di pacchetti con un allarme rosso sopra —
  // "pacchetto esaurito, le API sono ferme" — mentre le API funzionavano benissimo. Un avviso che
  // annuncia un blocco che non arrivera' mai fa telefonare in assistenza chi non aveva problemi.
  if (s.esente) {
    return (
      <div style={{ marginTop: '26px' }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Uso delle API</div>
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '16px' }}>
          <div>
            <span style={{ fontSize: '26px', fontWeight: 800, color: '#1a1a1a' }}>{usate.toLocaleString('it-IT')}</span>
            <span style={{ fontSize: '14px', color: '#666' }}> spedizioni create via API questo mese</span>
          </div>
          <div style={{ fontSize: '13px', color: '#15803d', marginTop: '8px', fontWeight: 600 }}>
            Comprese nel tuo servizio: nessun limite e nessun costo aggiuntivo.
          </div>
        </div>
        {mesiPrecedenti.length > 0 && (
          <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#8a8a8a' }}>
            Mesi precedenti: {mesiPrecedenti.map((x: any) => `${x.mese} → ${x.n}`).join(' · ')}
          </div>
        )}
      </div>
    )
  }

  const pieno = limite > 0 ? Math.min(100, Math.round((usate / limite) * 100)) : 0
  const oltre = !!s.oltre_limite
  const bloccato = !!s.bloccato
  const siFerma = s.si_ferma_il
    ? new Date(s.si_ferma_il).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })
    : ''
  const colore = bloccato ? '#dc2626' : oltre ? '#d97706' : pieno >= 80 ? '#d97706' : '#16a34a'

  return (
    <div style={{ marginTop: '26px' }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Pacchetto API</div>
      <div style={{ fontSize: '13px', color: '#666', marginBottom: '14px', maxWidth: '640px', lineHeight: 1.6 }}>
        Fino a 50 spedizioni al mese le API sono gratuite. Sopra, serve un pacchetto.
      </div>

      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px',
          background: msg.t === 'ok' ? '#f0fdf4' : '#fef2f2', color: msg.t === 'ok' ? '#166534' : '#991b1b',
          border: `1px solid ${msg.t === 'ok' ? '#bbf7d0' : '#fecaca'}`,
        }}>{msg.x}</div>
      )}

      {/* Il consumo: la prima cosa da vedere */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '16px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <span style={{ fontSize: '26px', fontWeight: 800, color: colore }}>{usate}</span>
            <span style={{ fontSize: '14px', color: '#666' }}> di {limite.toLocaleString('it-IT')} spedizioni questo mese</span>
          </div>
          <div style={{ fontSize: '13px', color: '#666' }}>
            pacchetto <strong style={{ color: '#1a1a1a' }}>{s.nome || 'Free'}</strong>
            {Number(s.prezzo) > 0 ? ` · € ${Number(s.prezzo).toFixed(0)}/mese` : ' · gratis'}
          </div>
        </div>
        <div style={{ height: '8px', background: '#f0f0f0', borderRadius: '4px', marginTop: '10px', overflow: 'hidden' }}>
          <div style={{ width: `${pieno}%`, height: '100%', background: colore }} />
        </div>
        {/* FERMO E "QUASI FERMO" NON SONO LA STESSA COSA.
            Questo avviso guardava `oltre_limite` (usate > limite) e annunciava "le API sono ferme".
            Ma il blocco vero, quello che alza il 429, guarda `bloccato` — che arriva solo DOPO i
            tre giorni di preavviso. Nel mezzo il cliente leggeva di essere fermo mentre stava
            spedendo: o telefona in assistenza, o peggio ci crede e stacca la sua integrazione da
            solo. Ora l'avviso dice in che stato e' davvero, e da quando. */}
        {bloccato ? (
          <div style={{ marginTop: '10px', fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>
            Le API sono ferme: il pacchetto è esaurito e il tempo per passare a uno più grande è
            scaduto. Il portale resta aperto e le spedizioni già create continuano il loro giro.
          </div>
        ) : oltre ? (
          <div style={{ marginTop: '10px', fontSize: '13px', color: '#b45309', fontWeight: 600 }}>
            Hai superato il pacchetto. Le API continuano a funzionare{siFerma ? ` fino al ${siFerma}` : ' ancora per poco'}:
            passa a uno più grande per non fermarti.
          </div>
        ) : s.scaduto_dal ? (
          <div style={{ marginTop: '10px', fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>
            L’ultimo pagamento non è andato a buon fine. Hai 3 giorni per sistemarlo, poi le API si fermano.
          </div>
        ) : null}
      </div>

      {/* PRIMA SI PROVA IL RINNOVO AUTOMATICO. La scelta non si mostra in partenza: chiedere subito
          "abbonamento o mese singolo?" a chi non ha nessun problema e' una domanda in piu' e una
          probabilita' in piu' che scelga il singolo, che poi ogni mese va rincorso.
          Il ripiego compare SOLO a chi la banca ha gia' detto di no — e a quel punto e' la strada
          giusta, non un'alternativa. */}
      {modo === 'singolo' && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '10px', padding: '13px 15px', marginBottom: '12px' }}>
          <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#9a3412' }}>Paghi un mese alla volta</div>
          <div style={{ fontSize: '12.5px', color: '#9a3412', marginTop: '4px', lineHeight: 1.55 }}>
            Il rinnovo automatico non è passato: succede con le carte aziendali e le prepagate, che
            spesso non accettano gli addebiti ricorrenti. Così paghi solo questo mese — il prossimo
            dovrai rifarlo a mano.
            <button onClick={() => setModo('abbonamento')}
              style={{ background: 'none', border: 'none', color: '#9a3412', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', padding: '0 0 0 4px', fontSize: '12.5px' }}>
              Riprova col rinnovo automatico
            </button>
          </div>
        </div>
      )}

      {/* I pacchetti */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '10px' }}>
        {(d.piani || []).map((p: any) => {
          const attuale = p.codice === s.piano
          const basta = usate <= p.limite
          return (
            <div key={p.codice} style={{
              background: '#fff', border: attuale ? `2px solid ${ACCENT}` : '1px solid #e8e8e8',
              borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '4px',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#8a8a8a', textTransform: 'uppercase' }}>{p.nome}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#1a1a1a' }}>
                {Number(p.prezzo) > 0 ? <>€ {Number(p.prezzo).toFixed(0)}<span style={{ fontSize: '13px', fontWeight: 500, color: '#8a8a8a' }}> /mese</span></> : 'Gratis'}
              </div>
              <div style={{ fontSize: '13px', color: '#444' }}>{p.limite.toLocaleString('it-IT')} spedizioni al mese</div>
              <div style={{ fontSize: '12px', color: '#8a8a8a', lineHeight: 1.5, marginTop: '4px' }}>
                Tutti i canali di vendita · salvataggio settimanale · aggiornamenti gratuiti
                {Number(p.prezzo) > 0 ? ' · assistenza chat ed email' : ''}
              </div>
              <div style={{ marginTop: 'auto', paddingTop: '12px' }}>
                {attuale ? (
                  <div style={{ fontSize: '13px', fontWeight: 700, color: ACCENT }}>Il tuo pacchetto</div>
                ) : Number(p.prezzo) === 0 ? (
                  <div style={{ fontSize: '12.5px', color: '#8a8a8a' }}>Si torna qui disdicendo</div>
                ) : (
                  <button disabled={!!inCorso || !d.pagamentoAttivo} onClick={() => scegli(p.codice)}
                    style={{
                      width: '100%', background: basta && !oltre ? '#fff' : ACCENT,
                      color: basta && !oltre ? '#1a1a1a' : '#fff',
                      border: basta && !oltre ? '1px solid #d5d5d5' : 'none',
                      borderRadius: '8px', padding: '10px', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer',
                    }}>
                    {inCorso === p.codice ? '…' : s.ha_carta ? 'Passa a questo' : 'Attiva'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {mesiPrecedenti.length > 0 && (
        <div style={{ marginTop: '14px', fontSize: '12.5px', color: '#8a8a8a' }}>
          Mesi precedenti: {mesiPrecedenti.map((x: any) => `${x.mese} → ${x.n}`).join(' · ')}
        </div>
      )}
    </div>
  )
}
