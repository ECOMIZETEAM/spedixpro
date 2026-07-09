'use client'
import { useState, useEffect } from 'react'

export default function StaffPage() {
  const [utenti, setUtenti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cerca, setCerca] = useState('')
  const [perPagina, setPerPagina] = useState(10)
  const [pagina, setPagina] = useState(1)

  async function carica() {
    setLoading(true)
    const r = await fetch('/api/staff')
    const j = await r.json()
    setUtenti(Array.isArray(j) ? j : [])
    setLoading(false)
  }
  useEffect(() => { carica() }, [])

  const filtrati = utenti.filter(u => {
    const r = (u.ruolo||'').toLowerCase()
    if (r === 'cliente' || r === 'master') return false
    if (!cerca) return true
    const t = cerca.toLowerCase()
    return (u.nome||'').toLowerCase().includes(t) || (u.email||'').toLowerCase().includes(t) || (u.ruolo||'').toLowerCase().includes(t)
  })
  const totale = filtrati.length
  const inizio = (pagina - 1) * perPagina
  const paginati = filtrati.slice(inizio, inizio + perPagina)
  const numPagine = Math.max(1, Math.ceil(totale / perPagina))

  const [resetCred, setResetCred] = useState<{nome:string,email:string,password:string}|null>(null)
  const [resetting, setResetting] = useState('')

  async function elimina(id: string) {
    if (!confirm('Eliminare questo account?')) return
    await fetch('/api/staff?id=' + id, { method: 'DELETE' })
    carica()
  }

  async function reimposta(u: any) {
    if (!confirm(`Generare una nuova password per ${[u.nome,u.cognome].filter(Boolean).join(' ')||u.email} e inviarla via email?`)) return
    setResetting(u.id)
    const r = await fetch('/api/staff', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: u.id, resetPassword: true }) })
    const j = await r.json()
    setResetting('')
    if (j.error) { alert('Errore: ' + j.error); return }
    setResetCred({ nome: [u.nome,u.cognome].filter(Boolean).join(' ')||u.email, email: j.email || u.email, password: j.password })
  }

  const th = { padding:'12px 14px', textAlign:'left' as const, fontSize:'13px', fontWeight:'700', color:'#374151', borderBottom:'2px solid #eee', whiteSpace:'nowrap' as const }
  const td = { padding:'12px 14px', fontSize:'13px', color:'#1a1a1a', borderBottom:'1px solid #f1f5f9' }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'14px' }}>
        <a href="/dashboard/impostazioni/staff/crea" style={{ padding:'9px 18px', background:'#f97316', color:'#fff', borderRadius:'6px', fontSize:'13px', fontWeight:'700', textDecoration:'none' }}>+ Crea account</a>
      </div>
      <div style={{ background:'#fff', borderRadius:'8px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', overflow:'hidden' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #eee', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
          <span style={{ fontSize:'16px', fontWeight:'700', color:'#374151' }}>Utenti</span>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <span style={{ fontSize:'13px', color:'#1a1a1a' }}>Cerca:</span>
            <input value={cerca} onChange={e=>{ setCerca(e.target.value); setPagina(1) }} style={{ padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:'6px', fontSize:'13px', color:'#1a1a1a' }} />
          </div>
        </div>
        <div style={{ padding:'10px 20px', fontSize:'13px', color:'#1a1a1a' }}>
          Mostra{' '}
          <select value={perPagina} onChange={e=>{ setPerPagina(Number(e.target.value)); setPagina(1) }} style={{ padding:'4px 8px', border:'1px solid #d1d5db', borderRadius:'5px', color:'#1a1a1a' }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>{' '}elementi
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['Nome','Email','Telefono','Ruolo','Ultimo accesso','Azioni'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ ...td, textAlign:'center', color:'#999' }}>Caricamento...</td></tr>
              ) : paginati.length === 0 ? (
                <tr><td colSpan={6} style={{ ...td, textAlign:'center', color:'#999' }}>Nessun utente</td></tr>
              ) : paginati.map(u => (
                <tr key={u.id}>
                  <td style={td}>{[u.nome, u.cognome].filter(Boolean).join(' ') || '—'}</td>
                  <td style={td}>{u.email || '—'}</td>
                  <td style={td}>{u.telefono || ''}</td>
                  <td style={td}>{u.ruolo || ''}</td>
                  <td style={{ ...td, whiteSpace:'nowrap' }}>{u.ultimo_accesso ? new Date(u.ultimo_accesso).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '-'}</td>
                  <td style={td}>
                    <div style={{ display:'flex', gap:'6px' }}>
                      <button onClick={()=>reimposta(u)} disabled={resetting===u.id} style={{ padding:'6px 10px', background:'#fff7ed', color:'#ea580c', border:'1px solid #fed7aa', borderRadius:'5px', fontSize:'12px', fontWeight:'600', cursor:'pointer', opacity: resetting===u.id?0.6:1 }} title="Reimposta password e invia via email">{resetting===u.id?'...':'Reimposta password'}</button>
                      <button onClick={()=>elimina(u.id)} style={{ padding:'6px 10px', background:'#dc2626', color:'#fff', border:'none', borderRadius:'5px', fontSize:'13px', cursor:'pointer' }} title="Elimina">&#128465;</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px', borderTop:'1px solid #eee' }}>
          <span style={{ fontSize:'13px', color:'#666' }}>Risultati da {totale === 0 ? 0 : inizio+1} a {Math.min(inizio+perPagina, totale)} di {totale} elementi</span>
          <div style={{ display:'flex', gap:'4px' }}>
            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={pagina<=1} style={{ padding:'6px 12px', border:'1px solid #d1d5db', background:'#fff', borderRadius:'5px', fontSize:'13px', cursor:'pointer', color:'#1a1a1a', opacity: pagina<=1?0.5:1 }}>Precedente</button>
            {Array.from({length: numPagine}).map((_,i)=>(
              <button key={i} onClick={()=>setPagina(i+1)} style={{ padding:'6px 12px', border:'1px solid #d1d5db', background: pagina===i+1?'#f97316':'#fff', color: pagina===i+1?'#fff':'#1a1a1a', borderRadius:'5px', fontSize:'13px', cursor:'pointer' }}>{i+1}</button>
            ))}
            <button onClick={()=>setPagina(p=>Math.min(numPagine,p+1))} disabled={pagina>=numPagine} style={{ padding:'6px 12px', border:'1px solid #d1d5db', background:'#fff', borderRadius:'5px', fontSize:'13px', cursor:'pointer', color:'#1a1a1a', opacity: pagina>=numPagine?0.5:1 }}>Successivo</button>
          </div>
        </div>
      </div>

      {resetCred && (
        <div onClick={()=>setResetCred(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:'10px', padding:'24px', width:'420px', maxWidth:'90vw', boxShadow:'0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize:'16px', fontWeight:'700', color:'#1a1a1a', marginBottom:'6px' }}>Nuova password generata</div>
            <p style={{ fontSize:'13px', color:'#666', marginBottom:'16px', lineHeight:1.5 }}>Le credenziali di <b>{resetCred.nome}</b> sono state aggiornate e inviate via email. Condividile anche manualmente se necessario.</p>
            <div style={{ background:'#f9fafb', border:'1px solid #eee', borderRadius:'8px', padding:'14px', marginBottom:'16px' }}>
              <div style={{ fontSize:'12px', color:'#999', marginBottom:'4px' }}>Email</div>
              <div style={{ fontSize:'14px', color:'#1a1a1a', fontFamily:'monospace', marginBottom:'12px' }}>{resetCred.email}</div>
              <div style={{ fontSize:'12px', color:'#999', marginBottom:'4px' }}>Nuova password</div>
              <div style={{ fontSize:'16px', fontWeight:'700', color:'#f97316', fontFamily:'monospace' }}>{resetCred.password}</div>
            </div>
            <div style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
              <button onClick={()=>navigator.clipboard?.writeText(`Email: ${resetCred.email}\nPassword: ${resetCred.password}\nPortale: https://moovexpress.com`)} style={{ padding:'9px 16px', background:'#16a34a', color:'#fff', border:'none', borderRadius:'6px', fontSize:'13px', fontWeight:'700', cursor:'pointer' }}>Copia</button>
              <button onClick={()=>setResetCred(null)} style={{ padding:'9px 16px', background:'#f97316', color:'#fff', border:'none', borderRadius:'6px', fontSize:'13px', fontWeight:'700', cursor:'pointer' }}>Chiudi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}