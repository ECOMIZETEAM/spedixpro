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

  // Ricarica credito sotto-master
  const [ric, setRic] = useState<any>(null)
  const [ricImporto, setRicImporto] = useState('')
  const [ricDesc, setRicDesc] = useState('Ricarica credito')
  const [ricSaving, setRicSaving] = useState(false)
  const [ricErr, setRicErr] = useState('')
  const [okMsg, setOkMsg] = useState('')

  function carica() {
    fetch('/api/clienti/lista?conMaster=1')
      .then(r => r.json())
      .then(d => { setClienti(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => { carica() }, [])

  async function salvaRicarica() {
    setRicErr('')
    const imp = parseFloat(ricImporto.replace(',', '.'))
    if (!isFinite(imp) || imp === 0) { setRicErr('Inserisci un importo diverso da 0 (usa − per togliere)'); return }
    if (!ricDesc.trim()) { setRicErr('Inserisci una descrizione'); return }
    setRicSaving(true)
    try {
      const res = await fetch('/api/movimenti/crea', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId: ric.id, tipo: imp > 0 ? 'ricarica' : 'rettifica', descrizione: ricDesc.trim(), importo: imp }),
      })
      const d = await res.json()
      setRicSaving(false)
      if (!res.ok || d?.error) { setRicErr(d?.error || 'Errore durante la ricarica'); return }
      setRic(null); setRicImporto('')
      setOkMsg('✓ Credito caricato con successo')
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
      setTimeout(() => setOkMsg(''), 5000)
      carica()
    } catch { setRicSaving(false); setRicErr('Errore di rete') }
  }

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
      `}</style>

      {okMsg && (
        <div style={{background:'#16a34a',color:'#fff',padding:'12px 18px',borderRadius:'8px',marginBottom:'16px',fontSize:'14px',fontWeight:'700',boxShadow:'0 2px 8px rgba(22,163,74,0.25)'}}>{okMsg}</div>
      )}
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
                      {c.listini_clienti?.nome
                        ? <span style={{color:'#f97316',fontWeight:'600'}}>{c.listini_clienti.nome}</span>
                        : (c.listino_cliente_id ? <span style={{color:'#f97316',fontWeight:'600'}}>Assegnato</span> : <span style={{color:'#1a1a1a'}}>—</span>)}
                    </td>
                    <td style={{padding:'10px 14px',color:Number(c.credito||0) < 0 ? '#dc2626' : '#16a34a',fontSize:'12px',fontWeight:'600',whiteSpace:'nowrap'}}>€ {Number(c.credito||0).toFixed(2)}</td>
                    <td style={{padding:'10px 14px',fontSize:'12px'}}>
                      {(c.contratti_attivi && c.contratti_attivi.length)
                        ? c.contratti_attivi.map((ct:any, i:number)=>(
                            <div key={i} style={{marginBottom:'2px',color:'#1a1a1a'}}><span style={{fontWeight:'700'}}>{ct.tipo}</span> {ct.nome_contratto}</div>
                          ))
                        : <span style={{color:'#1a1a1a'}}>-</span>}
                    </td>
                    <td style={{padding:'10px 14px'}}>
                      <span style={{background:c.attivo?'#f0fdf4':'#fef2f2',color:c.attivo?'#16a34a':'#dc2626',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'500'}}>
                        {c.attivo?'Attivo':'Inattivo'}
                      </span>
                    </td>
                    <td style={{padding:'10px 14px'}}>
                      {c.is_master ? (
                        <div style={{display:'flex',gap:'14px',alignItems:'center'}}>
                          <button onClick={()=>{setRic(c);setRicImporto('');setRicDesc('Ricarica credito');setRicErr('')}} title="Ricarica credito" className="cli-act" style={{background:'none',border:'none'}}>💰</button>
                          <a href={`/api/master/${c.id.slice(2)}/impersona`} title="Accedi come sotto-master" target="_blank" rel="noopener noreferrer" className="cli-act">↪</a>
                        </div>
                      ) : (
                        <div style={{display:'flex',gap:'14px',alignItems:'center'}}>
                          <a href={`/api/clienti/${c.id}/impersona`} title="Accedi come cliente" target="_blank" rel="noopener noreferrer" className="cli-act">↪</a>
                          <a href={`/dashboard/clienti/${c.id}`} title="Credito e movimenti" className="cli-act">▤</a>
                          <a href={`/dashboard/clienti/${c.id}/modifica`} title="Modifica dati" className="cli-act">✎</a>
                          <a href={`/dashboard/clienti/${c.id}/impostazioni`} title="Impostazioni" className="cli-act">⚙</a>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODALE RICARICA SOTTO-MASTER */}
      {ric && (
        <div onClick={()=>!ricSaving&&setRic(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:'20px'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'10px',width:'420px',maxWidth:'100%'}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid #eee',fontSize:'15px',fontWeight:'700',color:'#1a1a1a'}}>Ricarica credito — {ric.ragione_sociale}</div>
            <div style={{padding:'20px',display:'flex',flexDirection:'column',gap:'12px'}}>
              <div style={{fontSize:'12.5px',color:'#666'}}>Credito attuale: <b style={{color:Number(ric.credito||0)<0?'#dc2626':'#16a34a'}}>€ {Number(ric.credito||0).toFixed(2)}</b></div>
              <div>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Importo €</label>
                <input value={ricImporto} onChange={e=>setRicImporto(e.target.value)} placeholder="es. 200 (o -200 per togliere)" style={inp}/>
              </div>
              <div>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'}}>Descrizione</label>
                <input value={ricDesc} onChange={e=>setRicDesc(e.target.value)} style={inp}/>
              </div>
              {ricErr && <div style={{fontSize:'12px',color:'#dc2626'}}>{ricErr}</div>}
              <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'4px'}}>
                <button onClick={()=>setRic(null)} disabled={ricSaving} style={{padding:'8px 16px',background:'#f2f2f2',color:'#1a1a1a',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Annulla</button>
                <button onClick={salvaRicarica} disabled={ricSaving} style={{padding:'8px 20px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:ricSaving?0.6:1}}>{ricSaving?'Salvataggio…':'Ricarica'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
