'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const inp = {width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}
const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'20px',marginBottom:'16px'}
const cardTitle = {fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a',marginBottom:'16px'}

export default function NuovoRitiroPage() {
  const router = useRouter()
  const [spedizioni, setSpedizioni] = useState<any[]>([])
  const [selezionate, setSelezionate] = useState<Set<string>>(new Set())
  const [loadingSped, setLoadingSped] = useState(true)
  const [cercaLdv, setCercaLdv] = useState('')

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
  const [errore, setErrore] = useState('')

  useEffect(() => {
    fetch('/api/spedizioni/ritirabili').then(r => r.json()).then(d => {
      setSpedizioni(Array.isArray(d) ? d : [])
      setLoadingSped(false)
    }).catch(() => setLoadingSped(false))

    fetch('/api/cliente/profilo').then(r => r.json()).then(d => {
      if (d?.nome) setMittNome(d.nome)
      if (d?.indirizzo_operativo) setMittIndirizzo(d.indirizzo_operativo)
      if (d?.citta_operativo) setMittCitta(d.citta_operativo)
      if (d?.provincia_operativo) setMittProvincia(d.provincia_operativo)
      if (d?.cap_operativo) setMittCap(d.cap_operativo)
      if (d?.telefono) setMittTelefono(d.telefono)
      if (d?.email) setMittEmail(d.email)
    }).catch(() => {})

    const oggi = new Date()
    oggi.setDate(oggi.getDate() + 1)
    setDataRitiro(oggi.toISOString().split('T')[0])
  }, [])

  function toggleSpedizione(id: string) {
    setSelezionate(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function creaRitiro() {
    if (!selezionate.size) { setErrore('Seleziona almeno una spedizione da ritirare'); return }
    if (!mittNome || !mittIndirizzo || !mittCitta || !mittCap) { setErrore('Compila tutti i dati mittente'); return }
    if (!dataRitiro) { setErrore('Seleziona una data di ritiro'); return }
    setSaving(true); setErrore('')

    const res = await fetch('/api/ritiri/crea', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spedizioneIds: Array.from(selezionate),
        mittNome, mittIndirizzo, mittCitta, mittProvincia, mittCap, mittPaese: 'IT',
        mittTelefono, mittEmail,
        contenuto, dataRitiro, orarioRitiro, istruzioni,
      })
    })
    const data = await res.json()
    setSaving(false)

    if (data.error) { setErrore(data.error); return }
    router.push('/cliente/ritiri?success=' + (data.pickupId || ''))
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Nuovo Ritiro</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>Seleziona le spedizioni pronte e richiedi il ritiro al corriere</p>
      </div>

      {errore && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#dc2626' }}>{errore}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>

        {/* SINISTRA: dati mittente + data/orario + invio */}
        <div>
          <div style={card}>
            <div style={cardTitle}>Dati Mittente</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div><label style={lbl}>Rif. Mittente *</label><input value={mittNome} onChange={e => setMittNome(e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Telefono</label><input value={mittTelefono} onChange={e => setMittTelefono(e.target.value)} style={inp} /></div>
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
                <input type="date" value={dataRitiro} onChange={e => setDataRitiro(e.target.value)} style={inp} />
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

          <button onClick={creaRitiro} disabled={saving}
            style={{ width: '100%', background: '#f97316', color: '#fff', border: 'none', padding: '12px 32px', borderRadius: '6px', fontSize: '13.5px', fontWeight: '700', cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Richiesta in corso...' : 'Richiedi Ritiro'}
          </button>
        </div>

        {/* DESTRA: selezione LDV */}
        <div style={card}>
          <div style={cardTitle}>Seleziona spedizioni da ritirare ({selezionate.size} selezionate)</div>
          {loadingSped ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>Caricamento spedizioni...</div>
          ) : !spedizioni.length ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '20px', fontSize: '13px' }}>
              Nessuna spedizione in lavorazione da ritirare. Crea prima una spedizione.
            </div>
          ) : (
            <div>
              <input type="text" value={cercaLdv} onChange={e=>setCercaLdv(e.target.value)} placeholder="Cerca LDV / numero spedizione..." style={{ ...inp, marginBottom: '8px' }} />
              <div style={{ maxHeight: '520px', overflowY: 'auto' }}>
                {spedizioni.filter(s => !cercaLdv || String(s.numero||'').toLowerCase().includes(cercaLdv.toLowerCase())).map(s => {
                  const sel = selezionate.has(s.id)
                  return (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 8px', borderRadius: '6px', border: `1px solid ${sel ? '#fed7aa' : '#f0f0f0'}`, background: sel ? '#fff7ed' : '#fff', marginBottom: '6px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={sel} onChange={() => toggleSpedizione(s.id)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: '600', fontSize: '13px', color: '#1a1a1a' }}>{s.numero}</div>
                        <div style={{ fontSize: '11px', color: '#999' }}>{s.dest_nome} → {s.dest_citta} · {s.colli} collo/i · {s.peso_reale}kg</div>
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
