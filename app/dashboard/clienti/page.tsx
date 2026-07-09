'use client'
import { useState, useEffect, useMemo } from 'react'

const inp = {width:'100%',padding:'8px 11px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'12.5px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box' as const}
const lbl = {fontSize:'11px',fontWeight:'600' as const,color:'#999',display:'block' as const,marginBottom:'4px',textTransform:'uppercase' as const,letterSpacing:'0.4px'}

export default function ClientiPage() {
  const [clienti, setClienti] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [filtroStato, setFiltroStato] = useState('tutti')
  const [filtroContratto, setFiltroContratto] = useState('tutti')
  const [filtroListino, setFiltroListino] = useState('tutti')

  useEffect(() => {
    fetch('/api/clienti/lista?conMaster=1')
      .then(r => r.json())
      .then(d => { setClienti(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const tipiContratto = useMemo(() => {
    const set = new Set(clienti.map(c => c.tipo_contratto).filter(Boolean))
    return Array.from(set)
  }, [clienti])

  const clientiFiltrati = useMemo(() => {
    return clienti.filter(c => {
      if (filtroStato === 'attivo' && !c.attivo) return false
      if (filtroStato === 'inattivo' && c.attivo) return false
      if (filtroContratto !== 'tutti' && c.tipo_contratto !== filtroContratto) return false
      if (filtroListino === 'assegnato' && !c.listino_cliente_id) return false
      if (filtroListino === 'non_assegnato' && c.listino_cliente_id) return false
      if (search.trim()) {
        const s = search.toLowerCase()
        const match = c.ragione_sociale?.toLowerCase().includes(s)
          || c.email?.toLowerCase().includes(s)
          || c.telefono?.includes(s)
          || c.codice_cliente?.toLowerCase().includes(s)
        if (!match) return false
      }
      return true
    })
  }, [clienti, search, filtroStato, filtroContratto, filtroListino])

  return (
    <div>
      <style>{`
        .cli-act{color:#9aa0a6;font-size:16px;line-height:1;text-decoration:none;transition:color .12s;cursor:pointer}
        .cli-act:hover{color:#f97316}
        .lst-link{color:#f97316;font-weight:600;text-decoration:none;cursor:pointer}
        .lst-link:hover{text-decoration:underline}
      `}</style>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Clienti</h1>
          <p style={{color:'#666',fontSize:'13px',marginTop:'4px'}}>{clientiFiltrati.length} di {clienti.length} clienti</p>
        </div>
        <a href="/dashboard/clienti/nuovo" style={{background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>+ Nuovo Cliente</a>
      </div>

      {/* FILTRI */}
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'18px',marginBottom:'16px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'12px',display:'flex',alignItems:'center',gap:'6px'}}>
          <span>▽</span> Filtri
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:'12px'}}>
          <div>
            <label style={lbl}>Status account</label>
            <select value={filtroStato} onChange={e => setFiltroStato(e.target.value)} style={inp}>
              <option value="tutti">Tutti</option>
              <option value="attivo">Attivo</option>
              <option value="inattivo">Inattivo</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Tipo Contratto</label>
            <select value={filtroContratto} onChange={e => setFiltroContratto(e.target.value)} style={inp}>
              <option value="tutti">Tutti</option>
              {tipiContratto.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Listino</label>
            <select value={filtroListino} onChange={e => setFiltroListino(e.target.value)} style={inp}>
              <option value="tutti">Tutti</option>
              <option value="assegnato">Assegnato</option>
              <option value="non_assegnato">Non assegnato</option>
            </select>
          </div>
          <div>
            <label style={lbl}>🔍 Cerca</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome, email, telefono..." style={inp} />
          </div>
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        {loading ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}><div style={{fontSize:'14px'}}>Caricamento...</div></div>
        ) : !clientiFiltrati.length ? (
          <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>👥</div>
            <div style={{fontSize:'14px',fontWeight:'500',color:'#1a1a1a'}}>
              {clienti.length ? 'Nessun cliente corrisponde ai filtri' : 'Nessun cliente'}
            </div>
            {!clienti.length && (
              <a href="/dashboard/clienti/nuovo" style={{display:'inline-block',marginTop:'12px',background:'#f97316',color:'#fff',padding:'8px 18px',borderRadius:'6px',fontSize:'13px',fontWeight:'600',textDecoration:'none'}}>Crea il primo</a>
            )}
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  {['Nr.#','Società','Tipo Contratto','Listino','Credito','Contratti attivi','Stato','Azioni'].map(h=>(
                    <th key={h} style={{textAlign:'left',padding:'9px 14px',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.5px',color:'#1a1a1a',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientiFiltrati.map(c => (
                  <tr key={c.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                    <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px'}}>{c.codice_cliente}</td>
                    <td style={{padding:'10px 14px'}}>
                      <div style={{fontWeight:'600',color:'#1a1a1a',display:'flex',alignItems:'center',gap:'7px'}}>
                        {c.ragione_sociale}
                        {c.is_master && <span style={{background:'#eef2ff',color:'#4f46e5',padding:'1px 7px',borderRadius:'10px',fontSize:'10px',fontWeight:'700',whiteSpace:'nowrap'}}>Sotto-master</span>}
                      </div>
                      <div style={{fontSize:'11px',color:'#1a1a1a'}}>{c.email}</div>
                      {c.telefono && <div style={{fontSize:'11px',color:'#1a1a1a'}}>{c.telefono}</div>}
                    </td>
                    <td style={{padding:'10px 14px',color:'#1a1a1a',fontSize:'12px',textTransform:'capitalize'}}>{c.tipo_contratto?.replace(/_/g,' ')||'—'}</td>
                    <td style={{padding:'10px 14px',fontSize:'12px'}}>
                      {c.listino_cliente_id
                        ? <a href={`/dashboard/listini/clienti/${c.listino_cliente_id}`} className="lst-link" title="Apri il listino su Listini Clienti">{c.listini_clienti?.nome || 'Assegnato'}</a>
                        : <span style={{color:'#1a1a1a'}}>—</span>}
                    </td>
                    <td style={{padding:'10px 14px',color:Number(c.credito||0) < 0 ? '#dc2626' : '#16a34a',fontSize:'12px',fontWeight:'600',whiteSpace:'nowrap'}}>€ {Number(c.credito||0).toFixed(2)}</td>
                    <td style={{padding:'10px 14px',fontSize:'12px'}}>
                      {(c.contratti_attivi && c.contratti_attivi.length)
                        ? c.contratti_attivi.map((ct:any, i:number)=>(
                            <div key={i} style={{marginBottom:'2px',color:'#1a1a1a'}}>{ct.tipo && !['spediamopro','spedisci'].includes(ct.tipo) && <span style={{fontWeight:'700'}}>{ct.tipo} </span>}{ct.nome_contratto}</div>
                          ))
                        : <span style={{color:'#1a1a1a'}}>-</span>}
                    </td>
                    <td style={{padding:'10px 14px'}}>
                      <span style={{background:c.attivo?'#f0fdf4':'#fef2f2',color:c.attivo?'#16a34a':'#dc2626',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'500'}}>
                        {c.attivo?'Attivo':'Inattivo'}
                      </span>
                    </td>
                    <td style={{padding:'10px 14px'}}>
                      <div style={{display:'flex',gap:'14px',alignItems:'center'}}>
                        {c.is_master ? (
                          <>
                            <a href={`/dashboard/clienti/${c.id}`} title="Credito, movimenti e dati" className="cli-act">▤</a>
                            <a href={`/dashboard/clienti/master/${String(c.id).slice(2)}`} title="Modifica dati e accesso" className="cli-act">✎</a>
                            <a href={`/dashboard/clienti/${c.id}/impostazioni`} title="Impostazioni" className="cli-act">⚙</a>
                          </>
                        ) : (
                          <>
                            <a href={`/api/clienti/${c.id}/impersona`} title="Accedi" target="_blank" rel="noopener noreferrer" className="cli-act">↪</a>
                            <a href={`/dashboard/clienti/${c.id}`} title="Credito e movimenti" className="cli-act">▤</a>
                            <a href={`/dashboard/clienti/${c.id}/modifica`} title="Modifica dati" className="cli-act">✎</a>
                            <a href={`/dashboard/clienti/${c.id}/impostazioni`} title="Impostazioni" className="cli-act">⚙</a>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
