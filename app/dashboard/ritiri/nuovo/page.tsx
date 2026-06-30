'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const inp = {width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}
const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'20px',marginBottom:'16px'}
const cardTitle = {fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a',marginBottom:'16px'}

export default function NuovoRitiroPage() {
  const router = useRouter()
  const [mittNome, setMittNome] = useState('')
  const [mittIndirizzo, setMittIndirizzo] = useState('')
  const [mittCitta, setMittCitta] = useState('')
  const [mittProvincia, setMittProvincia] = useState('')
  const [mittCap, setMittCap] = useState('')
  const [mittTelefono, setMittTelefono] = useState('')
  const [mittEmail, setMittEmail] = useState('')

  const [colli, setColli] = useState('1')
  const [pesoTotale, setPesoTotale] = useState('1')
  const [lunghezza, setLunghezza] = useState('')
  const [larghezza, setLarghezza] = useState('')
  const [altezza, setAltezza] = useState('')
  const [contenuto, setContenuto] = useState('')

  const [dataRitiro, setDataRitiro] = useState('')
  const [orarioRitiro, setOrarioRitiro] = useState('pomeriggio')
  const [istruzioni, setIstruzioni] = useState('')

  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')

  useEffect(() => {
    fetch('/api/master').then(r => r.json()).then(d => {
      if (d?.nome) setMittNome(d.nome)
      if (d?.indirizzo_operativo) setMittIndirizzo(d.indirizzo_operativo)
      if (d?.citta_operativo) setMittCitta(d.citta_operativo)
      if (d?.provincia_operativo) setMittProvincia(d.provincia_operativo)
      if (d?.cap_operativo) setMittCap(d.cap_operativo)
      if (d?.telefono_operativo) setMittTelefono(d.telefono_operativo)
      if (d?.email) setMittEmail(d.email)
    }).catch(() => {})

    const oggi = new Date()
    oggi.setDate(oggi.getDate() + 1)
    setDataRitiro(oggi.toISOString().split('T')[0])
  }, [])

  async function creaRitiro() {
    if (!mittNome || !mittIndirizzo || !mittCitta || !mittCap) { setErrore('Compila tutti i dati mittente'); return }
    if (!dataRitiro) { setErrore('Seleziona una data di ritiro'); return }
    setSaving(true); setErrore('')

    const res = await fetch('/api/ritiri/crea', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mittNome, mittIndirizzo, mittCitta, mittProvincia, mittCap, mittPaese: 'IT',
        mittTelefono, mittEmail,
        colli: parseInt(colli) || 1, pesoTotale: parseFloat(pesoTotale) || 1,
        lunghezza: lunghezza ? parseFloat(lunghezza) : undefined,
        larghezza: larghezza ? parseFloat(larghezza) : undefined,
        altezza: altezza ? parseFloat(altezza) : undefined,
        contenuto, dataRitiro, orarioRitiro, istruzioni,
      })
    })
    const data = await res.json()
    setSaving(false)

    if (data.error) { setErrore(data.error); return }
    router.push('/dashboard/ritiri/elenco?success=' + (data.pickupId || ''))
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Nuovo Ritiro</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>Richiedi al corriere il ritiro dei tuoi colli pronti</p>
      </div>

      {errore && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#dc2626' }}>⚠️ {errore}</div>}

      <div style={{ maxWidth: '780px' }}>
        <div style={card}>
          <div style={cardTitle}>📍 Dati Mittente</div>
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
          <div style={cardTitle}>📦 Dati Spedizione</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div><label style={lbl}>Colli</label><input type="number" min="1" value={colli} onChange={e => setColli(e.target.value)} style={inp} /></div>
            <div><label style={lbl}>Peso totale (kg)</label><input type="number" min="0.1" step="0.1" value={pesoTotale} onChange={e => setPesoTotale(e.target.value)} style={inp} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div><label style={lbl}>Lunghezza (cm)</label><input type="number" value={lunghezza} onChange={e => setLunghezza(e.target.value)} style={inp} placeholder="opzionale" /></div>
            <div><label style={lbl}>Larghezza (cm)</label><input type="number" value={larghezza} onChange={e => setLarghezza(e.target.value)} style={inp} placeholder="opzionale" /></div>
            <div><label style={lbl}>Altezza (cm)</label><input type="number" value={altezza} onChange={e => setAltezza(e.target.value)} style={inp} placeholder="opzionale" /></div>
          </div>
          <div>
            <label style={lbl}>Contenuto</label>
            <input value={contenuto} onChange={e => setContenuto(e.target.value)} style={inp} placeholder="es. Materiale elettronico" />
          </div>
        </div>

        <div style={card}>
          <div style={cardTitle}>📅 Data e Orario Ritiro</div>
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
          <div>
            <label style={lbl}>Istruzioni per il corriere</label>
            <input value={istruzioni} onChange={e => setIstruzioni(e.target.value)} style={inp} placeholder="es. Suonare il citofono" />
          </div>
        </div>

        <button onClick={creaRitiro} disabled={saving}
          style={{ background: '#f97316', color: '#fff', border: 'none', padding: '11px 32px', borderRadius: '6px', fontSize: '13.5px', fontWeight: '700', cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Richiesta in corso...' : '✓ Richiedi Ritiro'}
        </button>
      </div>
    </div>
  )
}
