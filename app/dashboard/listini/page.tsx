'use client'
import { useState, useEffect } from 'react'

export default function ListiniPage() {
  const [listini, setListini] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [eliminando, setEliminando] = useState('')
  const [duplicando, setDuplicando] = useState('')
  const [cerca, setCerca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [dupModal, setDupModal] = useState<{ id: string; nome: string } | null>(null)
  const [dupNome, setDupNome] = useState('')
  const [dupMagg, setDupMagg] = useState('0')

  const PER_PAGINA = 10
  const filtrati = listini.filter(l => (l.nome || '').toLowerCase().includes(cerca.trim().toLowerCase()))
  const totalePagine = Math.max(1, Math.ceil(filtrati.length / PER_PAGINA))
  const paginaSafe = Math.min(pagina, totalePagine)
  const visibili = filtrati.slice((paginaSafe - 1) * PER_PAGINA, paginaSafe * PER_PAGINA)

  function apriDuplica(id: string, nome: string) {
    setDupNome(`${nome} (copia)`)
    setDupMagg('0')
    setDupModal({ id, nome })
  }
  async function confermaDuplica() {
    if (!dupModal) return
    const nome = dupNome.trim()
    if (!nome) return
    const maggiorazione = Number(String(dupMagg).replace(',', '.')) || 0
    setDuplicando(dupModal.id)
    const res = await fetch('/api/listini/duplica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listinoId: dupModal.id, nome, maggiorazione }) })
    const d = await res.json().catch(() => ({}))
    setDuplicando('')
    setDupModal(null)
    if (d?.error) { alert(d.error); return }
    carica()
  }

  function carica() {
    fetch('/api/listini/lista')
      .then(r => r.json())
      .then(d => { setListini(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => { carica() }, [])

  async function elimina(id: string, nome: string) {
    if (!confirm(`Eliminare il listino "${nome}"? L'operazione è irreversibile.`)) return
    setEliminando(id)
    const res = await fetch(`/api/listini/cliente/${id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    setEliminando('')
    if (d?.error) { alert(d.error); return }
    setListini(prev => prev.filter(l => l.id !== id))
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Listini Clienti</h1>
          <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{listini.length} listini totali</p>
        </div>
        <a href="/dashboard/listini/clienti/nuovo" style={{background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>+ Nuovo Listino</a>
      </div>

      {!loading && listini.length > 0 && (
        <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'12px',flexWrap:'wrap'}}>
          <input value={cerca} onChange={e=>{setCerca(e.target.value);setPagina(1)}} placeholder="🔍 Cerca listino per nome..."
            style={{flex:'1 1 260px',maxWidth:'360px',padding:'8px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',outline:'none'}}/>
          <span style={{fontSize:'12px',color:'#888'}}>{filtrati.length} risultati</span>
        </div>
      )}

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>
            <div style={{fontSize:'14px'}}>Caricamento...</div>
          </div>
        ) : !listini.length ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>💰</div>
            <div style={{fontSize:'14px',fontWeight:'500',color:'#1a1a1a'}}>Nessun listino</div>
            <a href="/dashboard/listini/clienti/nuovo" style={{display:'inline-block',marginTop:'12px',background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>Crea il primo</a>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['Nome Listino','Fasce','Creato il','Azioni'].map(h=>(
                  <th key={h} style={{textAlign:'left',padding:'9px 14px',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.5px',color:'#1a1a1a',borderBottom:'1px solid #f0f0f0'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibili.length === 0 && (
                <tr><td colSpan={4} style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Nessun listino corrisponde a “{cerca}”.</td></tr>
              )}
              {visibili.map(l => (
                <tr key={l.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'10px 14px',fontWeight:'600',color:'#1a1a1a'}}>{l.nome}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a'}}>{l.fasce_count||'—'}</td>
                  <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px'}}>{new Date(l.created_at).toLocaleDateString('it-IT')}</td>
                  <td style={{padding:'10px 14px'}}>
                    <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                      <a href={`/dashboard/listini/clienti/${l.id}`} style={{padding:'4px 10px',background:'#f5f5f5',color:'#333',borderRadius:'4px',fontSize:'12px',textDecoration:'none',border:'1px solid #e8e8e8'}}>✏️ Modifica</a>
                      <button onClick={()=>apriDuplica(l.id, l.nome)} disabled={duplicando===l.id} title="Duplica listino"
                        style={{padding:'4px 10px',background:'#fff7ed',color:'#ea580c',borderRadius:'4px',fontSize:'12px',border:'1px solid #fed7aa',cursor:'pointer',opacity:duplicando===l.id?0.5:1}}>
                        {duplicando===l.id?'…':'⧉ Duplica'}
                      </button>
                      <button onClick={()=>elimina(l.id, l.nome)} disabled={eliminando===l.id} title="Elimina listino"
                        style={{padding:'4px 10px',background:'#fef2f2',color:'#dc2626',borderRadius:'4px',fontSize:'12px',border:'1px solid #fecaca',cursor:'pointer',opacity:eliminando===l.id?0.5:1}}>
                        {eliminando===l.id?'…':'🗑 Elimina'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && filtrati.length > PER_PAGINA && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 14px',borderTop:'1px solid #f0f0f0',flexWrap:'wrap',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#888'}}>
              {(paginaSafe-1)*PER_PAGINA+1}–{Math.min(paginaSafe*PER_PAGINA,filtrati.length)} di {filtrati.length}
            </span>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaSafe<=1}
                style={{padding:'5px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',background:'#fff',fontSize:'12px',color:'#1a1a1a',cursor:paginaSafe<=1?'default':'pointer',opacity:paginaSafe<=1?0.5:1}}>‹ Precedente</button>
              <span style={{fontSize:'12px',color:'#666',padding:'0 6px'}}>Pag. {paginaSafe} / {totalePagine}</span>
              <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaSafe>=totalePagine}
                style={{padding:'5px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',background:'#fff',fontSize:'12px',color:'#1a1a1a',cursor:paginaSafe>=totalePagine?'default':'pointer',opacity:paginaSafe>=totalePagine?0.5:1}}>Successiva ›</button>
            </div>
          </div>
        )}
      </div>

      {dupModal && (
        <div onClick={()=>duplicando ? null : setDupModal(null)} style={{position:'fixed',inset:0,background:'rgba(15,15,15,0.55)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'12px',maxWidth:'440px',width:'100%',padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,.35)'}}>
            <div style={{fontSize:'17px',fontWeight:800,color:'#1a1a1a',marginBottom:'6px'}}>Duplica listino</div>
            <div style={{fontSize:'13px',color:'#666',marginBottom:'18px'}}>Copia di <b>{dupModal.nome}</b></div>

            <label style={{display:'block',fontSize:'12px',fontWeight:700,color:'#1a1a1a',marginBottom:'6px'}}>Nome del nuovo listino</label>
            <input value={dupNome} onChange={e=>setDupNome(e.target.value)} autoFocus
              style={{width:'100%',padding:'9px 12px',border:'1px solid #e2e2e2',borderRadius:'8px',fontSize:'14px',color:'#1a1a1a',outline:'none',marginBottom:'16px',boxSizing:'border-box'}}/>

            <label style={{display:'block',fontSize:'12px',fontWeight:700,color:'#1a1a1a',marginBottom:'6px'}}>Maggiorazione % sui prezzi peso/zona</label>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
              <input type="number" step="0.01" value={dupMagg} onChange={e=>setDupMagg(e.target.value)} placeholder="0"
                style={{width:'120px',padding:'9px 12px',border:'1px solid #e2e2e2',borderRadius:'8px',fontSize:'14px',color:'#1a1a1a',outline:'none'}}/>
              <span style={{fontSize:'15px',fontWeight:700,color:'#1a1a1a'}}>%</span>
            </div>
            <div style={{fontSize:'12px',color:'#888',marginBottom:'20px'}}>Applica l'aumento SOLO alle fasce peso/zona. Non tocca contrassegno, assicurazione, giacenze o servizi. Lascia 0 per una copia identica.</div>

            <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
              <button onClick={()=>setDupModal(null)} disabled={!!duplicando} style={{background:'#fff',color:'#1a1a1a',border:'1px solid #ddd',borderRadius:'8px',padding:'9px 18px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Annulla</button>
              <button onClick={confermaDuplica} disabled={!!duplicando || !dupNome.trim()} style={{background:'#f97316',color:'#fff',border:'none',borderRadius:'8px',padding:'9px 20px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:(duplicando||!dupNome.trim())?0.6:1}}>{duplicando?'Duplico…':'Duplica'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
