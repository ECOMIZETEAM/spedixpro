'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

const inp = {width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11.5px',fontWeight:'600' as const,color:'#666',display:'block' as const,marginBottom:'4px'}
const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'20px',marginBottom:'16px'}
const cardTitle = {fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a',marginBottom:'16px'}

export default function ModificaClientePage() {
  const { id } = useParams()
  const router = useRouter()
  const [cliente, setCliente] = useState<any>(null)
  const [listini, setListini] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [resetPassword, setResetPassword] = useState(false)

  const [form, setForm] = useState<any>({})

  useEffect(() => {
    fetch(`/api/clienti/${id}`).then(r => r.json()).then(d => {
      setCliente(d)
      setForm(d)
      setLoading(false)
    })
    fetch('/api/listini/lista').then(r => r.json()).then(d => {
      setListini(Array.isArray(d) ? d : [])
    })
  }, [id])

  function set(field: string, value: any) {
    setForm((prev: any) => ({ ...prev, [field]: value }))
  }

  async function salva() {
    setSaving(true); setMsg('')
    const res = await fetch(`/api/clienti/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, resetPassword })
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setMsg('Errore: ' + data.error); return }
    setMsg('✓ Anagrafica aggiornata!')
    setTimeout(() => router.push(`/dashboard/clienti/${id}`), 1200)
  }

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#1a1a1a'}}>Caricamento...</div>
  if (!cliente || cliente.error) return <div style={{padding:'40px',textAlign:'center',color:'#dc2626'}}>Cliente non trovato</div>

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <a href={`/dashboard/clienti/${id}`} style={{fontSize:'12px',color:'#f97316',textDecoration:'none'}}>← {cliente.ragione_sociale}</a>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:'4px 0 0'}}>Modifica Anagrafica</h1>
      </div>

      {msg && <div style={{background:msg.startsWith('✓')?'#f0fdf4':'#fef2f2',border:`1px solid ${msg.startsWith('✓')?'#bbf7d0':'#fecaca'}`,borderRadius:'6px',padding:'10px 14px',marginBottom:'16px',fontSize:'13px',color:msg.startsWith('✓')?'#15803d':'#dc2626'}}>{msg}</div>}

      <div style={{maxWidth:'780px'}}>

        <div style={card}>
          <div style={cardTitle}>Dati Aziendali</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'}}>
            <div><label style={lbl}>Ragione Sociale *</label><input value={form.ragione_sociale||''} onChange={e=>set('ragione_sociale',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>P.IVA</label><input value={form.piva||''} onChange={e=>set('piva',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>Codice Fiscale</label><input value={form.cf||''} onChange={e=>set('cf',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>PEC</label><input value={form.pec||''} onChange={e=>set('pec',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>Rappresentante Legale</label><input value={form.rappresentante_legale||''} onChange={e=>set('rappresentante_legale',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>Telefono</label><input value={form.telefono||''} onChange={e=>set('telefono',e.target.value)} style={inp}/></div>
          </div>
        </div>

        <div style={card}>
          <div style={cardTitle}>📋 Listino & Contratto</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'}}>
            <div>
              <label style={lbl}>Listino Prezzi assegnato</label>
              <select value={form.listino_cliente_id||''} onChange={e=>set('listino_cliente_id', e.target.value||null)} style={inp}>
                <option value="">— nessun listino —</option>
                {listini.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Tipo Contratto</label>
              <select value={form.tipo_contratto||'credito_scalare'} onChange={e=>set('tipo_contratto', e.target.value)} style={inp}>
                <option value="credito_scalare">Credito a scalare</option>
                <option value="fattura_mensile">Fattura mensile</option>
                <option value="pagamento_anticipato">Pagamento anticipato</option>
              </select>
            </div>
          </div>
        </div>

        <div style={card}>
          <div style={cardTitle}>📍 Sede Operativa (Dati mittente)</div>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr',gap:'14px',marginBottom:'14px'}}>
            <div><label style={lbl}>Indirizzo</label><input value={form.so_indirizzo||''} onChange={e=>set('so_indirizzo',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>Città</label><input value={form.so_citta||''} onChange={e=>set('so_citta',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>CAP</label><input value={form.so_cap||''} onChange={e=>set('so_cap',e.target.value)} style={inp}/></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'}}>
            <div><label style={lbl}>Provincia</label><input value={form.so_provincia||''} onChange={e=>set('so_provincia',e.target.value)} style={inp}/></div>
            <div><label style={lbl}>Paese</label><input value={form.so_paese||'Italia'} onChange={e=>set('so_paese',e.target.value)} style={inp}/></div>
          </div>
        </div>

        <div style={card}>
          <div style={cardTitle}>🔐 Sicurezza</div>
          <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>
            <input type="checkbox" checked={resetPassword} onChange={e=>setResetPassword(e.target.checked)} />
            Genera nuova password e invia via email al cliente
          </label>
        </div>

        <div style={{display:'flex',gap:'10px'}}>
          <button onClick={salva} disabled={saving}
            style={{background:'#f97316',color:'#fff',border:'none',padding:'10px 28px',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
            {saving?'Salvataggio...':'Salva Modifiche'}
          </button>
          <a href={`/dashboard/clienti/${id}`} style={{padding:'10px 28px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',fontWeight:'600',color:'#1a1a1a',textDecoration:'none'}}>Annulla</a>
        </div>
      </div>
    </div>
  )
}
