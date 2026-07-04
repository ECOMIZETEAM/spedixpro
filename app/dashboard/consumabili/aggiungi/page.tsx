'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const inp = {width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'12px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function AggiungiSpesaPage() {
  const router = useRouter()
  const [clienti, setClienti] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [successo, setSuccesso] = useState('')
  const [form, setForm] = useState({
    clienteId: '',
    dataAcquisto: new Date().toISOString().split('T')[0],
    vettore: '',
    descrizione: '',
    prezzoUnitario: '',
    quantita: '1',
    iva: '0',
  })

  useEffect(() => {
    fetch('/api/clienti/lista').then(r=>r.json()).then(d=>setClienti(d||[]))
  }, [])

  const set = (k: string, v: string) => setForm(f => ({...f, [k]: v}))

  const importo = parseFloat(form.prezzoUnitario||'0') * parseInt(form.quantita||'1')
  const totaleIva = importo * (parseFloat(form.iva||'0') / 100)
  const totale = importo + totaleIva

  async function salva() {
    if (!form.clienteId) { setErrore('Seleziona un cliente'); return }
    if (!form.descrizione) { setErrore('Descrizione obbligatoria'); return }
    if (!form.prezzoUnitario) { setErrore('Prezzo obbligatorio'); return }
    setSaving(true); setErrore('')
    const res = await fetch('/api/consumabili', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(form)
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setErrore(data.error); return }
    setSuccesso('Spesa aggiunta con successo!')
    setForm(f => ({...f, clienteId:'', descrizione:'', prezzoUnitario:'', quantita:'1', vettore:''}))
  }

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Aggiungi Spesa</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>Addebita una spesa al cliente</p>
      </div>

      {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>⚠️ {errore}</div>}
      {successo && <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:'#16a34a'}}>✅ {successo}</div>}

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'20px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'16px',display:'flex',alignItems:'center',gap:'6px'}}>🔍 Aggiungi Spesa</div>

        {/* Riga 1: Cliente | Data Acquisto | Vettore */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px',marginBottom:'16px'}}>
          <div>
            <label style={lbl}>Cliente</label>
            <select value={form.clienteId} onChange={e=>set('clienteId',e.target.value)} style={inp}>
              <option value="">Seleziona cliente...</option>
              {clienti.map((c:any)=><option key={c.id} value={c.id}>{c.ragione_sociale}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Data Acquisto</label>
            <input type="date" value={form.dataAcquisto} onChange={e=>set('dataAcquisto',e.target.value)} style={inp}/>
          </div>
          <div>
            <label style={lbl}>Vettore</label>
            <select value={form.vettore} onChange={e=>set('vettore',e.target.value)} style={inp}>
              <option value="">Seleziona...</option>
              <option value="sda">SDA Express</option>
              <option value="gls">GLS</option>
              <option value="brt">BRT</option>
              <option value="poste">Poste Italiane</option>
              <option value="dhl">DHL Express</option>
              <option value="altro">Altro</option>
            </select>
          </div>
        </div>

        {/* Riga 2: Descrizione | Prezzo Unità | Quantità | IVA */}
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:'16px',marginBottom:'20px'}}>
          <div>
            <label style={lbl}>Descrizione</label>
            <input value={form.descrizione} onChange={e=>set('descrizione',e.target.value)} placeholder="es. Spesa carburante, materiale..." style={inp}/>
          </div>
          <div>
            <label style={lbl}>Prezzo Unità</label>
            <input type="number" value={form.prezzoUnitario} onChange={e=>set('prezzoUnitario',e.target.value)} min="0" step="0.01" placeholder="0.00" style={inp}/>
          </div>
          <div>
            <label style={lbl}>Quantità</label>
            <input type="number" value={form.quantita} onChange={e=>set('quantita',e.target.value)} min="1" style={inp}/>
          </div>
          <div>
            <label style={lbl}>IVA</label>
            <select value={form.iva} onChange={e=>set('iva',e.target.value)} style={inp}>
              <option value="22">22%</option>
              <option value="10">10%</option>
              <option value="4">4%</option>
              <option value="0">0%</option>
            </select>
          </div>
        </div>

        {/* Riepilogo */}
        {form.prezzoUnitario && (
          <div style={{background:'#f9fafb',borderRadius:'8px',padding:'14px',marginBottom:'20px',border:'1px solid #d1d5db',display:'flex',gap:'24px',fontSize:'13px'}}>
            <div><span style={{color:'#1a1a1a'}}>Imponibile: </span><strong>€ {importo.toFixed(2)}</strong></div>
            <div><span style={{color:'#1a1a1a'}}>IVA {form.iva}%: </span><strong>€ {totaleIva.toFixed(2)}</strong></div>
            <div><span style={{color:'#1a1a1a'}}>Totale: </span><strong style={{color:'#f97316',fontSize:'15px'}}>€ {totale.toFixed(2)}</strong></div>
          </div>
        )}

        <button onClick={salva} disabled={saving}
          style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
          {saving?'Salvataggio...':'Salva'}
        </button>
      </div>
    </div>
  )
}