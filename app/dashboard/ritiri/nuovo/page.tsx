'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

const inp = {width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}
const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'20px',marginBottom:'16px'}
const cardTitle = {fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a',marginBottom:'16px'}

function giornoOf(s: any): string { return String(s?.created_at || '').split('T')[0] }
function giornoLabel(g: string): string { const [y,m,d] = g.split('-'); return d && m && y ? `${d}/${m}/${y}` : g }

export default function NuovoRitiroPage() {
  const router = useRouter()
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [selezionate, setSelezionate] = useState<Set<string>>(new Set())
  const [loadingSped, setLoadingSped] = useState(true)
  const [cercaLdv, setCercaLdv] = useState('')
  const [fCliente, setFCliente] = useState('')
  const [fCorriere, setFCorriere] = useState('')
  const [fGiorno, setFGiorno] = useState('')

  const [mittNome, setMittNome] = useState('')
  const [mittIndirizzo, setMittIndirizzo] = useState('')
  const [mittCitta, setMittCitta] = useState('')
  const [mittProvincia, setMittProvincia] = useState('')
  const [mittCap, setMittCap] = useState('')
  const [mittTelefono, setMittTelefono] = useState('')
  const [mittEmail, setMittEmail] = useState('')

  const [contenuto, setContenuto] = useState('')
  const [dataRitiro, setDataRitiro] = useState('')
  const [orarioRitiro, setOrarioRitiro] = useState('pomeriggio')
  const [istruzioni, setIstruzioni] = useState('')

  const [saving, setSaving] = useState(false)
  const [progresso, setProgresso] = useState<{done:number,total:number}|null>(null)
  const [errore, setErrore] = useState('')
  const [clientiList, setClientiList] = useState<any[]>([])   // lista completa (clienti + sotto-master) per il selettore
  const [mittProprio, setMittProprio] = useState<any>(null)   // indirizzo del master (ritiro "per me")
  const [ritiroPer, setRitiroPer] = useState('__proprio__')   // chi richiede il ritiro (come Nuova Spedizione)

  useEffect(() => {
    fetch('/api/spedizioni/ritirabili').then(r => r.json()).then(d => {
      setSpedizioni(Array.isArray(d) ? d : [])
      setLoadingSped(false)
    }).catch(() => setLoadingSped(false))

    fetch('/api/master').then(r => r.json()).then(d => {
      if (!d || d.error) return
      // Snapshot dell'indirizzo del master (usa l'operativo se c'è, altrimenti la sede legale):
      // è il mittente del ritiro "per me" e il default all'apertura della pagina.
      const mp = {
        nome: d.ragione_sociale || d.nome || '',
        indirizzo: d.indirizzo_operativo || d.indirizzo || '',
        citta: d.citta_operativo || d.citta || '',
        provincia: d.provincia_operativo || d.provincia || '',
        cap: d.cap_operativo || d.cap || '',
        telefono: d.telefono_operativo || d.telefono || '',
        email: d.email_sede || d.email || d.email_supporto || '',
      }
      setMittProprio(mp)
      // Compilo il mittente solo se è ancora vuoto (non sovrascrivo una scelta già fatta).
      setMittNome(prev => prev || mp.nome)
      setMittIndirizzo(prev => prev || mp.indirizzo)
      setMittCitta(prev => prev || mp.citta)
      setMittProvincia(prev => prev || mp.provincia)
      setMittCap(prev => prev || mp.cap)
      setMittTelefono(prev => prev || mp.telefono)
      setMittEmail(prev => prev || mp.email)
    }).catch(() => {})

    const oggi = new Date()
    oggi.setDate(oggi.getDate() + 1)
    setDataRitiro(oggi.toISOString().split('T')[0])

    // Lista completa clienti + sotto-master (per il selettore "Ritiro per" e l'auto-compilazione).
    fetch('/api/clienti/lista?conMaster=1').then(r => r.json()).then((arr: any[]) => {
      setClientiList(Array.isArray(arr) ? arr : [])
    }).catch(() => {})
  }, [])

  // Selettore "Ritiro per" (come Nuova Spedizione): compila il mittente con l'indirizzo del
  // soggetto scelto (io / cliente / sotto-master) e filtra la lista LDV su quel soggetto.
  function selezionaRitiroPer(id: string) {
    setRitiroPer(id)
    if (id === '__proprio__') {
      if (mittProprio) {
        setMittNome(mittProprio.nome); setMittIndirizzo(mittProprio.indirizzo); setMittCitta(mittProprio.citta)
        setMittProvincia(mittProprio.provincia); setMittCap(mittProprio.cap); setMittTelefono(mittProprio.telefono); setMittEmail(mittProprio.email)
      }
      setFCliente('')   // mostra tutte le spedizioni
      return
    }
    const c = clientiList.find(x => String(x.id) === id)
    if (!c) return
    setMittNome(c.ragione_sociale || c.nome || '')
    setMittIndirizzo(c.so_indirizzo || c.indirizzo_operativo || c.indirizzo || '')
    setMittCitta(c.so_citta || c.citta_operativo || c.citta || '')
    setMittProvincia(c.so_provincia || c.provincia_operativo || c.provincia || '')
    setMittCap(c.so_cap || c.cap_operativo || c.cap || '')
    setMittTelefono(c.telefono || '')
    setMittEmail(c.email || '')
    // Filtro le spedizioni ritirabili su questo soggetto (l'id origine è senza prefisso "m:").
    setFCliente(String(id).replace(/^m:/, ''))
  }

  // Opzioni per i filtri (calcolate sulle spedizioni caricate)
  const optClienti = useMemo(() => {
    const m = new Map<string,string>()
    for (const s of spedizioni) if (s.origine_id) m.set(s.origine_id, s.origine_nome)
    return [...m.entries()].map(([id,nome]) => ({id,nome})).sort((a,b)=>a.nome.localeCompare(b.nome))
  }, [spedizioni])
  const optCorrieri = useMemo(() => {
    const s2 = new Set<string>(); for (const s of spedizioni) if (s.corriere_nome) s2.add(s.corriere_nome)
    return [...s2].sort()
  }, [spedizioni])
  const optGiorni = useMemo(() => {
    const s2 = new Set<string>(); for (const s of spedizioni) { const g = giornoOf(s); if (g) s2.add(g) }
    return [...s2].sort().reverse()
  }, [spedizioni])

  const filtrate = useMemo(() => spedizioni.filter(s => {
    if (fCliente && s.origine_id !== fCliente) return false
    if (fCorriere && s.corriere_nome !== fCorriere) return false
    if (fGiorno && giornoOf(s) !== fGiorno) return false
    if (cercaLdv && !String(s.numero||'').toLowerCase().includes(cercaLdv.toLowerCase())) return false
    return true
  }), [spedizioni, fCliente, fCorriere, fGiorno, cercaLdv])

  function toggleSpedizione(id: string) {
    setSelezionate(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleTutte() {
    const ids = filtrate.map(s => s.id)
    const tutteSel = ids.length > 0 && ids.every(id => selezionate.has(id))
    setSelezionate(prev => {
      const next = new Set(prev)
      if (tutteSel) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  async function creaRitiro() {
    const ids = Array.from(selezionate)
    if (!ids.length) { setErrore('Seleziona almeno una spedizione da ritirare'); return }
    if (!mittNome || !mittIndirizzo || !mittCitta || !mittCap) { setErrore('Compila tutti i dati mittente'); return }
    if (!dataRitiro) { setErrore('Seleziona una data di ritiro'); return }
    { const gg = new Date(dataRitiro + 'T00:00:00').getDay(); if (gg === 0 || gg === 6) { setErrore('I ritiri non sono disponibili nei giorni festivi o nel weekend. Scegli un giorno lavorativo (lun-ven).'); return } }
    if (!mittTelefono || mittTelefono.replace(/[^0-9]/g, '').length < 6) { setErrore('Inserisci un numero di telefono valido: il corriere lo richiede per il ritiro.'); return }
    setSaving(true); setErrore(''); setProgresso({done:0,total:ids.length})

    // Un ritiro DISTINTO per ogni LDV selezionata, con barra di progressione
    const errori: string[] = []
    let ultimoPickup = ''
    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await fetch('/api/ritiri/crea', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spedizioneIds: [ids[i]],
            mittNome, mittIndirizzo, mittCitta, mittProvincia, mittCap, mittPaese: 'IT',
            mittTelefono, mittEmail,
            contenuto, dataRitiro, orarioRitiro, istruzioni,
          })
        })
        const data = await res.json()
        if (data.error) { const s = spedizioni.find(x=>x.id===ids[i]); errori.push(`${s?.numero||ids[i]}: ${data.error}`) }
        else ultimoPickup = data.pickupId || ultimoPickup
      } catch (e: any) {
        const s = spedizioni.find(x=>x.id===ids[i]); errori.push(`${s?.numero||ids[i]}: ${e?.message||'errore'}`)
      }
      setProgresso({done:i+1,total:ids.length})
    }

    setSaving(false); setProgresso(null)
    if (errori.length) {
      setErrore(`Creati ${ids.length - errori.length}/${ids.length} ritiri. Errori:\n` + errori.join('\n'))
      return
    }
    router.push('/dashboard/ritiri/elenco?success=' + ids.length)
  }

  const tutteSelezionate = filtrate.length > 0 && filtrate.every(s => selezionate.has(s.id))

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Nuovo Ritiro</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>Seleziona le spedizioni pronte e richiedi il ritiro al corriere. Ogni LDV genera un ritiro distinto.</p>
      </div>

      {errore && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#dc2626', whiteSpace: 'pre-line' }}>{errore}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>

        {/* SINISTRA: dati mittente + data/orario + invio */}
        <div>
          <div style={card}>
            <div style={cardTitle}>Dati Mittente</div>
            <div style={{ marginBottom: '14px' }}>
              <label style={lbl}>Ritiro per</label>
              <select value={ritiroPer} onChange={e => selezionaRitiroPer(e.target.value)} style={inp}>
                <option value="__proprio__">— Io (ritiro per me) —</option>
                {clientiList.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.ragione_sociale || c.nome}{c.is_master ? ' — sotto-master' : ''}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div><label style={lbl}>Rif. Mittente *</label><input value={mittNome} onChange={e => setMittNome(e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Telefono *</label><input value={mittTelefono} onChange={e => setMittTelefono(e.target.value)} style={inp} /></div>
            </div>
            <div style={{ marginBottom: '14px' }}>
              <label style={lbl}>Indirizzo *</label>
              <input value={mittIndirizzo} onChange={e => setMittIndirizzo(e.target.value)} style={inp} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px' }}>
              <div><label style={lbl}>Città *</label><input value={mittCitta} onChange={e => setMittCitta(e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Provincia</label><input value={mittProvincia} onChange={e => setMittProvincia(e.target.value)} style={inp} /></div>
              <div><label style={lbl}>CAP *</label><input value={mittCap} onChange={e => setMittCap(e.target.value)} style={inp} /></div>
            </div>
          </div>

          <div style={card}>
            <div style={cardTitle}>Data e Orario Ritiro</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div>
                <label style={lbl}>Data Ritiro *</label>
                <input type="date" value={dataRitiro} min={new Date().toLocaleDateString('sv-SE')} onChange={e => setDataRitiro(e.target.value)} style={inp} />
                {dataRitiro && [0,6].includes(new Date(dataRitiro + 'T00:00:00').getDay()) && (
                  <div style={{marginTop:'6px',fontSize:'12px',color:'#dc2626',fontWeight:'600'}}>Sabato e domenica i ritiri non sono disponibili. Scegli un giorno lavorativo.</div>
                )}
              </div>
              <div>
                <label style={lbl}>Fascia Orario</label>
                <select value={orarioRitiro} onChange={e => setOrarioRitiro(e.target.value)} style={inp}>
                  <option value="mattina">Mattina</option>
                  <option value="pomeriggio">Pomeriggio</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: '14px' }}>
              <label style={lbl}>Contenuto</label>
              <input value={contenuto} onChange={e => setContenuto(e.target.value)} style={inp} placeholder="es. Materiale elettronico" />
            </div>
            <div>
              <label style={lbl}>Istruzioni per il corriere</label>
              <input value={istruzioni} onChange={e => setIstruzioni(e.target.value)} style={inp} placeholder="es. Suonare il citofono" />
            </div>
          </div>

          {progresso && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '6px' }}>Creazione ritiri {progresso.done}/{progresso.total}</div>
              <div style={{ height: '8px', background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round(progresso.done/progresso.total*100)}%`, background: '#f97316', transition: 'width .2s' }} />
              </div>
            </div>
          )}

          <button onClick={creaRitiro} disabled={saving}
            style={{ width: '100%', background: '#f97316', color: '#fff', border: 'none', padding: '12px 32px', borderRadius: '6px', fontSize: '13.5px', fontWeight: '700', cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? `Creazione ${progresso?.done||0}/${progresso?.total||0}...` : `Richiedi Ritiro${selezionate.size ? ` (${selezionate.size})` : ''}`}
          </button>
        </div>

        {/* DESTRA: selezione LDV con filtri */}
        <div style={card}>
          <div style={cardTitle}>Seleziona spedizioni da ritirare ({selezionate.size} selezionate)</div>

          {!loadingSped && spedizioni.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <select value={fCliente} onChange={e=>setFCliente(e.target.value)} style={{ ...inp, padding: '8px 10px' }}>
                <option value="">Tutti i clienti/master</option>
                {optClienti.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
              <select value={fCorriere} onChange={e=>setFCorriere(e.target.value)} style={{ ...inp, padding: '8px 10px' }}>
                <option value="">Tutti i contratti</option>
                {optCorrieri.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={fGiorno} onChange={e=>setFGiorno(e.target.value)} style={{ ...inp, padding: '8px 10px' }}>
                <option value="">Tutti i giorni</option>
                {optGiorni.map(g => <option key={g} value={g}>{giornoLabel(g)}</option>)}
              </select>
            </div>
          )}

          {loadingSped ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>Caricamento spedizioni...</div>
          ) : !spedizioni.length ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '20px', fontSize: '13px' }}>
              Nessuna spedizione in lavorazione da ritirare. Crea prima una spedizione.
            </div>
          ) : (
            <div>
              <input type="text" value={cercaLdv} onChange={e=>setCercaLdv(e.target.value)} placeholder="Cerca LDV / numero spedizione..." style={{ ...inp, marginBottom: '8px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: '#999' }}>{filtrate.length} risultati</span>
                {filtrate.length > 0 && (
                  <button onClick={toggleTutte} style={{ background: 'none', border: 'none', color: '#f97316', fontSize: '12px', fontWeight: '600', cursor: 'pointer', padding: 0 }}>
                    {tutteSelezionate ? 'Deseleziona tutte' : 'Seleziona tutte'}
                  </button>
                )}
              </div>
              <div style={{ maxHeight: '460px', overflowY: 'auto' }}>
                {filtrate.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#999', padding: '16px', fontSize: '13px' }}>Nessun risultato con questi filtri.</div>
                ) : filtrate.map(s => {
                  const sel = selezionate.has(s.id)
                  return (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 8px', borderRadius: '6px', border: `1px solid ${sel ? '#fed7aa' : '#f0f0f0'}`, background: sel ? '#fff7ed' : '#fff', marginBottom: '6px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={sel} onChange={() => toggleSpedizione(s.id)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                          <span style={{ fontWeight: '600', fontSize: '13px', color: '#1a1a1a' }}>{s.numero}</span>
                          <span style={{ fontSize: '11px', color: '#f97316', fontWeight: '600', whiteSpace: 'nowrap' }}>{s.corriere_nome}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#999' }}>{s.dest_nome} → {s.dest_citta} · {s.colli} collo/i · {s.peso_reale}kg</div>
                        <div style={{ fontSize: '11px', color: '#bbb' }}>{s.origine_nome} · {giornoLabel(giornoOf(s))}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
