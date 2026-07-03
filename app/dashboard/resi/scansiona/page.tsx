'use client'
import { useState, useEffect, useRef } from 'react'

const inp = {width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const btn = (bg: string) => ({padding:'8px 18px',background:bg,color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'600' as const,cursor:'pointer'})

export default function ScansionaResiPage() {
  const [ldv, setLdv] = useState('')
  const [spedizioneFound, setSpedizioneFound] = useState<any>(null)
  const [errore, setErrore] = useState('')
  const [distinta, setDistinta] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [successo, setSuccesso] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function cercaLDV() {
    if (!ldv.trim()) return
    setSearching(true); setErrore(''); setSpedizioneFound(null)
    const res = await fetch(`/api/resi?ldv=${ldv.trim()}`)
    const data = await res.json()
    setSearching(false)
    if (data.error) { setErrore(data.error); return }
    const giaIn = distinta.find(d => d.id === data.id)
    if (giaIn) { setErrore('Spedizione gia aggiunta alla distinta'); return }
    // aggiungo automaticamente alla distinta
    setDistinta(prev => [...prev, { ...data, data_scansione: new Date().toISOString() }])
    setSpedizioneFound(null)
    setLdv('')
    inputRef.current?.focus()
  }

  function aggiungiInDistinta() {
    if (!spedizioneFound) return
    setDistinta(prev => [...prev, { ...spedizioneFound, data_scansione: new Date().toISOString() }])
    setSpedizioneFound(null)
    setLdv('')
    inputRef.current?.focus()
  }

  async function chiudiDistinta() {
    if (!distinta.length) { setErrore('Aggiungi almeno una spedizione'); return }
    setSaving(true); setErrore('')
    const totale = distinta.reduce((acc, s) => acc + parseFloat(s.costo_totale || 0), 0)
    const clienteId = distinta[0]?.cliente_id
    const res = await fetch('/api/resi/distinte', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spedizioniIds: distinta.map(s => s.id),
        clienteId,
        totale,
        voci: distinta.map(s => ({
          id: s.id, numero: s.numero, mitt_nome: s.mitt_nome,
          dest_nome: s.dest_nome, dest_citta: s.dest_citta,
          colli: s.colli, costo_totale: s.costo_totale,
          data_scansione: s.data_scansione
        }))
      })
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setErrore(data.error); return }
    setSuccesso(`Distinta #${data.numero} creata con successo!`)
    setDistinta([])
  }

  function rimuovi(id: string) {
    setDistinta(prev => prev.filter(s => s.id !== id))
  }

  const totale = distinta.reduce((acc, s) => acc + parseFloat(s.costo_totale || 0), 0)

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Scansiona Resi</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>Inserisci il numero LDV per aggiungere alla distinta</p>
      </div>

      {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {errore}</div>}
      {successo && <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#16a34a'}}>✅ {successo}</div>}

      {/* Barra scansione */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'16px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',marginBottom:'8px'}}>⌕ Scansiona Spedizione</div>
        <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
          <input
            ref={inputRef}
            value={ldv}
            onChange={e=>setLdv(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&cercaLDV()}
            placeholder="Inserisci numero LDV o tracking..."
            style={{...inp,flex:1}}
          />
          <button onClick={cercaLDV} disabled={searching} style={btn('#f97316')}>
            {searching ? 'Ricerca...' : '+ Aggiungi in Distinta'}
          </button>
          <button onClick={chiudiDistinta} disabled={saving||!distinta.length}
            style={{...btn('#22c55e'),opacity:(!distinta.length||saving)?0.5:1}}>
            {saving ? 'Salvataggio...' : '✓ Chiudi Distinta'}
          </button>
        </div>

        {/* Spedizione trovata */}
        {spedizioneFound && (
          <div style={{marginTop:'12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'12px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontSize:'13px'}}>
              <span style={{fontWeight:'700',color:'#f97316'}}>{spedizioneFound.numero}</span>
              <span style={{color:'#1a1a1a',marginLeft:'12px'}}>{spedizioneFound.mitt_nome} → {spedizioneFound.dest_nome}</span>
              <span style={{color:'#1a1a1a',marginLeft:'12px',fontSize:'12px'}}>{spedizioneFound.dest_citta}</span>
              <span style={{fontWeight:'700',color:'#1a1a1a',marginLeft:'12px'}}>€ {Number(spedizioneFound.costo_totale||0).toFixed(2)}</span>
            </div>
            <button onClick={aggiungiInDistinta} style={btn('#22c55e')}>+ Aggiungi</button>
          </div>
        )}
      </div>

      {/* Tabella distinta */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>
            📄 Nuova Distinta {distinta.length > 0 && <span style={{color:'#f97316'}}>({distinta.length} spedizioni)</span>}
          </span>
          {distinta.length > 0 && (
            <span style={{fontSize:'13px',fontWeight:'700',color:'#f97316'}}>Totale: € {totale.toFixed(2)}</span>
          )}
        </div>
        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
          <thead>
            <tr style={{background:'#fafafa'}}>
              {['N. Spedizione','Mittente','Destinatario','Contrassegno','Stato','Colli','Costo Reso','Data scansione','Azioni'].map(h=>(
                <th key={h} style={{textAlign:'left' as const,padding:'9px 14px',fontSize:'11px',fontWeight:'600',textTransform:'uppercase' as const,letterSpacing:'0.5px',color:'#1a1a1a',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap' as const}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!distinta.length ? (
              <tr><td colSpan={9} style={{padding:'40px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'13px'}}>Nessun dato disponibile nella tabella</td></tr>
            ) : distinta.map(s => (
              <tr key={s.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                <td style={{padding:'10px 14px',fontWeight:'600',color:'#f97316'}}>{s.numero}</td>
                <td style={{padding:'10px 14px',color:'#1a1a1a'}}>{s.mitt_nome}</td>
                <td style={{padding:'10px 14px',color:'#333'}}>{s.dest_nome}<br/><span style={{fontSize:'11px',color:'#1a1a1a'}}>{s.dest_citta}</span></td>
                <td style={{padding:'10px 14px',color:'#1a1a1a'}}>—</td>
                <td style={{padding:'10px 14px'}}>
                  <span style={{background:'#fef2f2',color:'#dc2626',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'500'}}>Reso</span>
                </td>
                <td style={{padding:'10px 14px',color:'#1a1a1a'}}>{s.colli}</td>
                <td style={{padding:'10px 14px',fontWeight:'600',color:'#1a1a1a'}}>€ {Number(s.costo_totale||0).toFixed(2)}</td>
                <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(s.data_scansione).toLocaleString('it-IT')}</td>
                <td style={{padding:'10px 14px'}}>
                  <button onClick={()=>rimuovi(s.id)} style={{padding:'3px 8px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'4px',fontSize:'11px',cursor:'pointer'}}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}