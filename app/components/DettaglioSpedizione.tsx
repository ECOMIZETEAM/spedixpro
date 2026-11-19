'use client'
import React from 'react'
import { ldvProvvisoria, LDV_IN_ELABORAZIONE, numeroMostrato } from '@/lib/numero-spedizione'
import { GraficaNuova } from '@/app/components/grafica/contesto'
import { Icona } from '@/app/components/grafica/icone'

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', overflow: 'hidden' }
const cardH: React.CSSProperties = { padding: '11px 15px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a', background: '#fafafa' }
const cardB: React.CSSProperties = { padding: '14px 15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 18px' }
const lblS: React.CSSProperties = { fontSize: '10.5px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '2px' }
const valS: React.CSSProperties = { fontSize: '13px', color: '#1a1a1a', fontWeight: 500, wordBreak: 'break-word' }

function F({ label, value, full }: { label: string; value: any; full?: boolean }) {
  return (
    <div className="ds-campo" style={full ? { gridColumn: '1 / -1' } : undefined}>
      <div className="ds-etichetta" style={lblS}>{label}</div>
      <div className="ds-valore" style={valS}>{value != null && value !== '' ? value : '—'}</div>
    </div>
  )
}

export default function DettaglioSpedizione({ s: sRiga, onClose, etichettaHref, onModificata, apriCorrezione }: { s: any; onClose: () => void; etichettaHref?: string; onModificata?: () => void; apriCorrezione?: boolean }) {
  // con la grafica nuova (18/11) il dettaglio è una tendina da destra, come il tracking; con quella di oggi resta com'è
  const nuova = React.useContext(GraficaNuova).attiva
  // Correzione peso/misure (solo master creatore, spedizione con cliente). L'etichetta NON cambia: si
  // ricalcola solo il costo e la differenza va in rettifica su tutta la catena (addebito o rimborso).
  // MULTICOLLO: si corregge ogni collo. colli_dettaglio non e' in SPED_COLS -> lo prendo da /[id].
  const [mod, setMod] = React.useState(false)
  const [dett, setDett] = React.useState<any>(null)
  const [colliForm, setColliForm] = React.useState<{ peso: string; lunghezza: string; larghezza: string; altezza: string }[]>([])
  // Appunti del master: valore in modifica + valore salvato (per sapere se c'e' qualcosa da salvare).
  const [interne, setInterne] = React.useState<{ contenuto: string; note: string }>({ contenuto: '', note: '' })
  const [interneIniz, setInterneIniz] = React.useState<{ contenuto: string; note: string }>({ contenuto: '', note: '' })
  const [salvando, setSalvando] = React.useState(false)
  const [salvaMsg, setSalvaMsg] = React.useState('')
  const [ant, setAnt] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState('')
  // RIGA + DETTAGLIO FUSI. L'elenco master ora manda la riga LEGGERA (30 campi): mittente,
  // destinatario, contenuto, note, accessori e ritiro non ci sono piu'. Li porta la chiamata per-id
  // che questa finestra fa gia' all'apertura, e qui i due oggetti si sovrappongono — cosi' ogni
  // punto che legge `s.` continua a funzionare senza modifiche, sia dal portale master sia da quello
  // cliente (che manda ancora la riga intera: in quel caso il dettaglio conferma gli stessi valori).
  const s = React.useMemo(() => ({ ...(sRiga || {}), ...(dett || {}) }), [sRiga, dett])
  React.useEffect(() => {
    setMod(!!apriCorrezione); setAnt(null); setMsg(''); setDett(null); setColliForm([])
    setInterne({ contenuto: '', note: '' }); setInterneIniz({ contenuto: '', note: '' }); setSalvaMsg('')
    if (!s?.id) return
    let vivo = true
    // Gli appunti stanno in una tabella a parte (il cliente non li vede): lettura a parte. Solo dal
    // portale master — nel portale cliente onModificata non c'e' e la rotta risponderebbe 403.
    if (onModificata) {
      fetch('/api/spedizioni/nota-interna?spedizione_id=' + s.id).then(r => r.ok ? r.json() : null).then(d => {
        if (!vivo || !d) return
        const v = { contenuto: String(d.contenuto || ''), note: String(d.note || '') }
        setInterne(v); setInterneIniz(v)
      }).catch(() => {})
    }
    fetch(`/api/spedizioni/${s.id}`).then(r => r.ok ? r.json() : null).then(d => {
      if (!vivo || !d) return
      setDett(d)
      const cd = Array.isArray(d.colli_dettaglio) ? d.colli_dettaglio : []
      const n = Math.max(Number(d.colli) || 0, cd.length, 1)
      // pre-riempio i colli: dal dettaglio se c'e', altrimenti (mono) dai campi della spedizione
      setColliForm(Array.from({ length: n }, (_, i) => {
        const c = cd[i] || {}
        const g = (k: string, mono: any) => { const v = c[k] != null ? c[k] : (n === 1 ? mono : ''); return String(v ?? '') }
        return { peso: g('peso', d.peso_reale), lunghezza: g('lunghezza', d.lunghezza), larghezza: g('larghezza', d.larghezza), altezza: g('altezza', d.altezza) }
      }))
    }).catch(() => {})
    return () => { vivo = false }
  }, [s?.id, apriCorrezione])
  // Quando si apre in correzione (es. dal tasto ✏️ della riga), porta la card di correzione in vista:
  // altrimenti resterebbe in fondo al modale, sotto tutte le altre card.
  const modRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { if (mod) { const t = setTimeout(() => modRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); return () => clearTimeout(t) } }, [mod, dett])
  function setCollo(i: number, k: string, v: string) { setColliForm(prev => prev.map((c, idx) => idx === i ? { ...c, [k]: v } : c)); setAnt(null) }
  async function invia(dry: boolean) {
    setBusy(true); setMsg('')
    try {
      const colli = colliForm.map(c => ({ peso: Number(c.peso), lunghezza: Number(c.lunghezza), larghezza: Number(c.larghezza), altezza: Number(c.altezza) }))
      const r = await fetch('/api/spedizioni/modifica', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spedizioneId: s.id, dryRun: dry, colli }),
      })
      const d = await r.json()
      if (!r.ok) { setMsg(d.error || 'Errore'); setAnt(null); return }
      if (dry) setAnt(d)
      else { onModificata?.(); onClose() }
    } catch (e: any) { setMsg(String(e?.message || e)) }
    finally { setBusy(false) }
  }
  // SALVATAGGIO SEPARATO dal ricalcolo: due righe di appunti non devono far ripartire il calcolo del
  // costo — con un listino cambiato nel frattempo riscriverebbe il prezzo di una spedizione gia' fatta.
  async function salvaInterne() {
    setSalvando(true); setSalvaMsg('')
    try {
      const r = await fetch('/api/spedizioni/nota-interna', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spedizioneId: s.id, contenuto: interne.contenuto, note: interne.note }),
      })
      const d = await r.json()
      if (!r.ok) { setSalvaMsg(d.error || 'Errore'); return }
      setInterneIniz({ contenuto: interne.contenuto, note: interne.note })
      setSalvaMsg('Salvato')
    } catch (e: any) { setSalvaMsg(String(e?.message || e)) }
    finally { setSalvando(false) }
  }
  if (!sRiga) return null
  const eur = (x: any) => '€ ' + Number(x || 0).toFixed(2)
  const dims = [s.lunghezza, s.larghezza, s.altezza].every((x: any) => Number(x) > 0) ? `${s.lunghezza} × ${s.larghezza} × ${s.altezza} cm` : '—'
  const accessori = (s.servizi_accessori || []).map((e: any) => `${e.nome}${e.importo ? ' (€' + Number(e.importo).toFixed(2) + ')' : ''}`).join(', ')
  const colliDett = Array.isArray(dett?.colli_dettaglio) ? dett.colli_dettaglio : []
  const multicollo = Number(s.colli) > 1
  // IL PESO SU CUI SI PAGA, non solo il reale (regola di Lorenzo: la schermata deve spiegare il prezzo). Sulle multicollo
  // ogni collo conta il maggiore fra il suo peso e il suo volume, poi si somma (lib/pricing, calcolaPesoFatturato): il
  // totale reale da solo inganna. 3UW1WLJ114071 (CONTORNO, 18/11/2026): 30 kg reali, 10 kg in 50x30x35 (10,5 di volume)
  // + 20 kg in 40x2x37, si paga su 30,5 kg e la spedizione e' nella fascia 30-50; il dettaglio diceva solo «30 kg».
  const kg = (n: number) => (Math.round(n * 100) / 100).toLocaleString('it-IT')
  const pesoSuCuiSiPaga = Number(s.peso_fatturato) || 0
  // Il divisore col quale e' stato fatto quel conto non e' sulla riga: si ricava dal volume salvato, e si usa solo se
  // torna tondo (4000, 5000, 6000…). Se non torna, i colli si mostrano senza i chili di volume, mai con un divisore inventato.
  const volumeColli = colliDett.reduce((t: number, c: any) => t + ((Number(c.lunghezza) * Number(c.larghezza) * Number(c.altezza)) || 0), 0)
  const divisore = (() => {
    const pv = Number(s.peso_volume) || 0
    if (!pv || !volumeColli) return null
    const f = volumeColli / pv, tondo = Math.round(f / 1000) * 1000
    return tondo > 0 && Math.abs(f - tondo) / tondo < 0.02 ? tondo : null
  })()
  const puoCorreggere = !!onModificata && !!s.cliente_id && s.stato !== 'annullata'

  return (
    <div onClick={onClose} className={nuova ? 'ds-velo' : undefined} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} className="ds" style={{ background: '#f6f7f8', borderRadius: '12px', width: '100%', maxWidth: '760px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div className="ds-testa" style={{ padding: '15px 20px', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', borderRadius: '12px 12px 0 0' }}>
          <div>
            <div className="ds-titolo" style={{ fontSize: '16px', fontWeight: 800, color: '#1a1a1a' }}>Dettaglio spedizione</div>
            <div className="ds-numero" style={{ fontSize: '12px', color: '#f97316', fontWeight: 700, marginTop: '2px' }}>{ldvProvvisoria(s.numero) ? `⏳ ${LDV_IN_ELABORAZIONE}` : numeroMostrato(s.numero, s.tracking_number)}{s.tracking_number && numeroMostrato(s.numero, s.tracking_number) !== s.tracking_number ? ` · ${s.tracking_number}` : ''}</div>
          </div>
          <button onClick={onClose} className="ds-x" aria-label="Chiudi" style={{ background: 'none', border: 'none', fontSize: '22px', color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div className="ds-corpo" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div className="ds-scheda" style={card}>
              <div className="ds-sezione" style={cardH}>Mittente</div>
              <div style={cardB}>
                <F label="Nome" value={s.mitt_nome} full />
                <F label="Indirizzo" value={s.mitt_indirizzo} full />
                <F label="Città" value={s.mitt_citta} />
                <F label="Prov / CAP" value={`${s.mitt_provincia || ''} ${s.mitt_cap || ''}`.trim()} />
                <F label="Paese" value={s.mitt_paese} />
                <F label="Telefono" value={s.mitt_telefono} />
                <F label="Email" value={s.mitt_email} full />
              </div>
            </div>
            <div className="ds-scheda" style={card}>
              <div className="ds-sezione" style={cardH}>Destinatario</div>
              <div style={cardB}>
                <F label="Nome" value={s.dest_nome} full />
                <F label="Indirizzo" value={s.dest_indirizzo} full />
                <F label="Città" value={s.dest_citta} />
                <F label="Prov / CAP" value={`${s.dest_provincia || ''} ${s.dest_cap || ''}`.trim()} />
                <F label="Paese" value={s.dest_paese} />
                <F label="Telefono" value={s.dest_telefono} />
                <F label="Email" value={s.dest_email} full />
              </div>
            </div>
          </div>

          <div className="ds-scheda" style={card}>
            <div className="ds-sezione" style={cardH}>Spedizione</div>
            <div style={{ ...cardB, gridTemplateColumns: '1fr 1fr 1fr' }}>
              <F label="Corriere" value={s.corrieri?.nome_contratto} />
              <F label="Stato" value={String(s.stato || '').replace(/_/g, ' ')} />
              <F label="Data" value={s.created_at ? new Date(s.created_at).toLocaleString('it-IT') : '—'} />
              <F label="Colli" value={s.colli} />
              <F label="Peso reale" value={s.peso_reale != null ? `${s.peso_reale} kg` : '—'} />
              <F label="Peso su cui si paga" value={pesoSuCuiSiPaga > 0
                ? <span style={{ fontWeight: 700 }}>{kg(pesoSuCuiSiPaga)} kg{pesoSuCuiSiPaga > (Number(s.peso_reale) || 0) + 0.005 && <span style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#666' }}>{multicollo ? 'ogni collo conta il maggiore fra peso e volume' : 'conta il volume, più del peso'}</span>}</span>
                : '—'} />
              <F label="Dimensioni" value={multicollo && colliDett.length ? 'collo per collo, qui sotto' : dims} />
              <F label="Contrassegno" value={Number(s.contrassegno) > 0 ? eur(s.contrassegno) : '—'} />
              <F label="Assicurazione" value={Number(s.assicurazione) > 0 ? eur(s.assicurazione) : '—'} />
              <F label="Valore merce" value={Number(s.valore_merce) > 0 ? eur(s.valore_merce) : '—'} />
              <F label="Contenuto" value={s.contenuto} full />
              <F label="Servizi accessori" value={accessori || '—'} full />
              <F label="Note" value={s.note} full />
            </div>
          </div>

          {multicollo && colliDett.length > 0 && (
            <div className="ds-scheda" style={card}>
              <div className="ds-sezione" style={cardH}>Colli ({colliDett.length})</div>
              <div style={{ padding: '8px 15px 12px' }}>
                {colliDett.map((c: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < colliDett.length - 1 ? '1px solid #f0f0f0' : 'none', fontSize: '13px' }}>
                    <span style={{ color: '#666' }}>Collo {c.numero || i + 1}</span>
                    <span style={{ fontWeight: 600, color: '#1a1a1a', textAlign: 'right' }}>
                      {c.peso != null && c.peso !== '' ? `${c.peso} kg` : '—'} · {[c.lunghezza, c.larghezza, c.altezza].every((x: any) => Number(x) > 0) ? `${c.lunghezza}×${c.larghezza}×${c.altezza} cm` : '— cm'}
                      {(() => {
                        const vol = divisore && [c.lunghezza, c.larghezza, c.altezza].every((x: any) => Number(x) > 0) ? Number(c.lunghezza) * Number(c.larghezza) * Number(c.altezza) / divisore : null
                        if (vol == null) return null
                        const peso = Number(c.peso) || 0
                        return <span style={{ display: 'block', fontSize: '11.5px', fontWeight: 500, color: vol > peso ? '#9a3412' : '#666' }}>
                          volume {kg(vol)} kg · si paga su <b>{kg(Math.max(peso, vol))} kg</b>
                        </span>
                      })()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="ds-scheda" style={card}>
            <div className="ds-sezione" style={cardH}>Costo</div>
            <div style={cardB}>
              <F label="Prezzo" value={<span style={{ fontWeight: 800, color: '#16a34a', fontSize: '15px' }}>{eur(s.costo_totale)}</span>} />
              {s.richiedi_ritiro ? <F label="Ritiro richiesto" value={`${s.data_ritiro || ''} ${s.intervallo_ritiro || ''}`.trim() || 'Sì'} /> : <div />}
            </div>
          </div>

          {puoCorreggere && (
            <div className="ds-scheda" style={card}>
              <div className="ds-sezione" style={cardH}>Appunti del master</div>
              <div style={{ padding: '14px 15px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>Solo per te: non vanno al corriere, non finiscono sull'etichetta e il cliente non li vede. Contenuto e note dichiarati dal cliente restano quelli qui sopra.</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <div className="ds-etichetta" style={lblS}>Contenuto</div>
                    <input value={interne.contenuto} maxLength={2000} onChange={e => setInterne(v => ({ ...v, contenuto: e.target.value }))}
                      placeholder="cosa c'era davvero nel pacco" style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }} />
                  </div>
                  <div>
                    <div className="ds-etichetta" style={lblS}>Note</div>
                    <textarea value={interne.note} maxLength={2000} rows={2} onChange={e => setInterne(v => ({ ...v, note: e.target.value }))}
                      placeholder="promemoria, accordi col cliente, cos'è successo…" style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                  <button className="ds-btn ds-btn-primario" onClick={salvaInterne} disabled={salvando || (interne.contenuto === interneIniz.contenuto && interne.note === interneIniz.note)}
                    style={{ padding: '8px 14px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: salvando ? 'default' : 'pointer', opacity: (interne.contenuto === interneIniz.contenuto && interne.note === interneIniz.note) ? 0.5 : 1 }}>
                    {salvando ? '…' : 'Salva appunti'}
                  </button>
                  {salvaMsg && <span style={{ fontSize: '12px', fontWeight: 600, color: salvaMsg === 'Salvato' ? '#16a34a' : '#dc2626' }}>{salvaMsg}</span>}
                </div>
              </div>
            </div>
          )}

          {mod && (
            <div ref={modRef} className="ds-scheda ds-correggi" style={{ ...card, border: '1px solid #fed7aa' }}>
              <div className="ds-sezione" style={{ ...cardH, background: '#fff7ed', color: '#ea580c' }}>Correggi peso / misure</div>
              <div style={{ padding: '14px 15px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>L'etichetta <b>non</b> cambia. Si ricalcola il costo: la differenza va in rettifica sul cliente (addebito se sale, rimborso se scende).</div>
                {colliForm.map((c, i) => (
                  <div key={i} style={{ marginBottom: '10px' }}>
                    {colliForm.length > 1 && <div className="ds-etichetta" style={{ ...lblS, marginBottom: '4px', color: '#ea580c' }}>Collo {i + 1}</div>}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                      {([['Peso kg', 'peso'], ['Lungh. cm', 'lunghezza'], ['Largh. cm', 'larghezza'], ['Alt. cm', 'altezza']] as [string, string][]).map(([lab, k]) => (
                        <div key={k}>
                          <div className="ds-etichetta" style={lblS}>{lab}</div>
                          <input type="number" value={(c as any)[k]} onChange={e => setCollo(i, k, e.target.value)} style={{ width: '100%', padding: '7px 9px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {ant && (
                  <div className="ds-anteprima" data-tipo={ant.tipo} style={{ marginTop: '12px', padding: '10px 12px', background: ant.tipo === 'addebito' ? '#fef2f2' : ant.tipo === 'rimborso' ? '#f0fdf4' : '#f8fafc', borderRadius: '7px', fontSize: '13px' }}>
                    <div>Peso: <b>{ant.pesoPrima} kg → {ant.pesoDopo} kg</b></div>
                    <div>Nuovo costo cliente: <b>{eur(ant.nuovoCostoCliente)}</b> (era {eur(s.costo_totale)})</div>
                    <div style={{ marginTop: '4px', fontWeight: 700, color: ant.tipo === 'addebito' ? '#dc2626' : ant.tipo === 'rimborso' ? '#16a34a' : '#666' }}>
                      {ant.tipo === 'addebito' ? `Addebito al cliente: ${eur(Math.abs(ant.importo))}` : ant.tipo === 'rimborso' ? `Rimborso al cliente: ${eur(ant.importo)}` : 'Nessuna variazione di costo'}
                    </div>
                  </div>
                )}
                {msg && <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '8px' }}>{msg}</div>}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button className="ds-btn ds-btn-secondario" onClick={() => invia(true)} disabled={busy} style={{ padding: '8px 14px', background: '#fff', color: '#ea580c', border: '1px solid #fed7aa', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>{busy ? '…' : 'Calcola'}</button>
                  {ant && ant.tipo !== 'nessuna variazione' && <button className="ds-btn ds-btn-primario" onClick={() => invia(false)} disabled={busy} style={{ padding: '8px 14px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>{busy ? '…' : 'Conferma correzione'}</button>}
                  <button className="ds-btn ds-btn-testo" onClick={() => { setMod(false); setAnt(null); setMsg('') }} style={{ padding: '8px 14px', background: 'none', color: '#666', border: 'none', fontSize: '13px', cursor: 'pointer' }}>Annulla</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="ds-piede" style={{ padding: '14px 20px', borderTop: '1px solid #e8e8e8', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: '#fff', borderRadius: '0 0 12px 12px' }}>
          {puoCorreggere && !mod && <button className="ds-btn ds-btn-secondario ds-sinistra" onClick={() => setMod(true)} style={{ marginRight: 'auto', padding: '9px 16px', background: '#fff', color: '#ea580c', border: '1px solid #fed7aa', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{nuova ? <Icona id="i-matita" /> : '✏️ '}Correggi peso e misure</button>}
          {etichettaHref && <a className="ds-btn ds-btn-secondario" href={etichettaHref} download style={{ padding: '9px 16px', background: '#fff7ed', color: '#ea580c', border: '1px solid #fed7aa', borderRadius: '7px', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>{nuova ? <Icona id="i-stampa" /> : '🖨️ '}Etichetta</a>}
          <button className="ds-btn ds-btn-primario" onClick={onClose} style={{ padding: '9px 18px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Chiudi</button>
        </div>
      </div>
    </div>
  )
}
