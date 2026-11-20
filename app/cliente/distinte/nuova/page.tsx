'use client'
import { useState, useEffect } from 'react'
import DateRangePicker from '@/app/components/DateRangePicker'
import { marchioCorriere } from '@/lib/corriere-logo'

// Giorno (ora italiana del browser) in cui e' nata la spedizione, nello stesso formato del selettore date.
const giorno = (iso: string) => { const d = new Date(iso); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }

export default function CreaDistintaCliente() {
  const [tutte, setTutte] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [corriereId, setCorriereId] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [cerca, setCerca] = useState('')
  const [creando, setCreando] = useState(false)
  const [msg, setMsg] = useState('')
  // FILTRI DATA E VETTORE (clienti, 20/11/2026: «non fa selezionare la data e il corriere»). Il periodo parte
  // dalla spedizione aperta piu' vecchia fino a oggi, cosi' all'apertura non si nasconde niente: chi ha l'auto
  // distinta spenta puo' avere spedizioni di giorni prima ancora da chiudere.
  const [dal, setDal] = useState('')
  const [al, setAl] = useState('')
  const [vettore, setVettore] = useState('')
  useEffect(() => {
    fetch('/api/cliente/distinte/aperte').then(r=>r.json()).then(d=>{
      const arr = Array.isArray(d)?d:[]
      setTutte(arr)
      const oggi = giorno(new Date().toISOString())
      const prima = arr.reduce((m:string, s:any)=>{ const g = s.created_at ? giorno(s.created_at) : oggi; return g < m ? g : m }, oggi)
      setDal(prima); setAl(oggi)
      setLoading(false)
    }).catch(()=>setLoading(false))
  }, [])
  const nomeContratto = (s:any) => (s.corrieri?.nome_contratto)||'Contratto'
  // Il vettore dal NOME del contratto, come nella lista distinte: mai il tipo, che e' il fornitore tecnico.
  const vettoreDi = (s:any) => marchioCorriere(nomeContratto(s)) || 'Altro'
  const nelPeriodo = tutte.filter(s => { const g = s.created_at ? giorno(s.created_at) : ''; return (!dal || g >= dal) && (!al || g <= al) })
  const vettori: [string, number][] = Array.from(nelPeriodo.reduce<Map<string, number>>((m, s) => m.set(vettoreDi(s), (m.get(vettoreDi(s))||0)+1), new Map()).entries())
    .sort((a,b)=>a[0].localeCompare(b[0]))
  const corrieri: { id: string; nome: string; n: number }[] = Array.from(nelPeriodo.filter(s => !vettore || vettoreDi(s)===vettore)
    .reduce<Map<string, { id: string; nome: string; n: number }>>((m, s) => { const c = m.get(s.corriere_id) || { id: s.corriere_id, nome: nomeContratto(s), n: 0 }; c.n++; return m.set(s.corriere_id, c) }, new Map()).values())
    .sort((a,b)=>a.nome.localeCompare(b.nome))
  // Il contratto scelto deve restare fra quelli del periodo e del vettore; se ne resta uno solo, e' quello.
  const chiaviContratti = corrieri.map((c:any)=>c.id).join(',')
  useEffect(() => {
    if (corriereId && corrieri.some((c:any)=>c.id===corriereId)) return
    const nuovo = corrieri.length===1 ? corrieri[0].id : ''
    if (nuovo !== corriereId) { setCorriereId(nuovo); setSelected([]) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiaviContratti])
  // Le spedizioni che la distinta puo' prendere: contratto e periodo. La ricerca restringe solo la vista,
  // come prima: chi seleziona e poi cerca per aggiungerne altre non perde le prime.
  const delContratto = nelPeriodo.filter(s => corriereId && s.corriere_id===corriereId)
  const q = cerca.trim().toLowerCase()
  const visibili = delContratto.filter(s => !q || [s.numero, s.dest_nome, s.dest_citta, s.dest_cap, s.id_ordine, s.rif_destinatario]
    .some(v => String(v||'').toLowerCase().includes(q)))
  const toggle = (id:string)=>setSelected(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])
  const toggleAll = ()=>{ if(selected.length===visibili.length) setSelected([]); else setSelected(visibili.map(s=>s.id)) }
  const seleziona = (n:number)=>setSelected(visibili.slice(0,n).map(s=>s.id))
  async function creaDistinta(){
    if(!corriereId){setMsg('Seleziona un contratto');return}
    // Solo le selezionate che stanno ancora nel contratto e nel periodo scelti.
    const ammesse = new Set(delContratto.map(s=>s.id))
    const ids = selected.filter(id=>ammesse.has(id))
    if(!ids.length){setMsg('Seleziona almeno una spedizione');return}
    setCreando(true); setMsg('')
    const res = await fetch('/api/cliente/distinte/crea',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spedizioniIds:ids,corriereId})})
    const d = await res.json()
    setCreando(false)
    if(d.error){setMsg('Errore: '+d.error);return}
    setMsg('Distinta '+d.numero+' creata con '+d.totali.spedizioni+' spedizioni')
    setTutte(prev=>prev.filter(s=>!ids.includes(s.id)))
    setSelected([])
  }
  const lbl = {fontSize:'12px',fontWeight:'600',color:'#1a1a1a',display:'block',marginBottom:'4px'} as const
  const sel = {width:'100%',padding:'8px 11px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff'} as const
  const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const,marginBottom:'16px'}
  const th = {textAlign:'left' as const,padding:'10px 14px',fontSize:'11px',fontWeight:'700' as const,color:'#1a1a1a',borderBottom:'1px solid #e8e8e8',whiteSpace:'nowrap' as const}
  const td = {padding:'10px 14px',fontSize:'12px',color:'#1a1a1a',borderBottom:'1px solid #f5f5f5'}
  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Crea Distinta <span style={{fontSize:'13px',color:'#999',fontWeight:'400'}}>({tutte.filter(s=>!corriereId||s.corriere_id===corriereId).length} spedizioni in attesa di chiusura)</span></h1>
      </div>
      <div style={card}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700',color:'#1a1a1a'}}>Filtri</div>
        <div style={{padding:'16px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:'12px',maxWidth:'900px'}}>
          <div>
            <label style={lbl}>Data spedizione</label>
            {/* Il selettore si monta col periodo gia' deciso: vuoto, si metterebbe da solo su "oggi". */}
            {dal && al
              ? <DateRangePicker dal={dal} al={al} onChange={(d1,d2)=>{setDal(d1);setAl(d2);setSelected([])}} />
              : <div style={{...sel,color:'#999'}}>Caricamento...</div>}
          </div>
          <div>
            <label style={lbl}>Corriere</label>
            <select value={vettore} onChange={e=>{setVettore(e.target.value);setSelected([])}} style={sel}>
              <option value="">Tutti i corrieri</option>
              {/* Il corriere scelto resta in elenco anche senza spedizioni nel periodo (es. appena chiuse in
                  distinta): sparendo, la tendina mostrava "Tutti" mentre il filtro restava acceso. */}
              {vettore && !vettori.some(([v])=>v===vettore) && <option value={vettore}>{vettore} (0)</option>}
              {vettori.map(([v,n])=><option key={v} value={v}>{v} ({n})</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Contratto</label>
            <select value={corriereId} onChange={e=>{setCorriereId(e.target.value);setSelected([])}} style={sel}>
              <option value="">— Seleziona contratto —</option>
              {corrieri.map((c:any)=><option key={c.id} value={c.id}>{c.nome} ({c.n})</option>)}
            </select>
          </div>
        </div>
      </div>
      <div style={card}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #f0f0f0',display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
          <button onClick={()=>seleziona(20)} style={{padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Seleziona 20</button>
          <button onClick={()=>seleziona(50)} style={{padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Seleziona 50</button>
          <button onClick={()=>seleziona(100)} style={{padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',background:'#fff',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>Seleziona 100</button>
          <input value={cerca} onChange={e=>setCerca(e.target.value)} placeholder="Numero, destinatario, città, CAP, ordine..." style={{marginLeft:'auto',padding:'6px 12px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a',minWidth:'240px',maxWidth:'100%'}}/>
          <button onClick={creaDistinta} disabled={creando} style={{padding:'8px 18px',border:'none',borderRadius:'6px',background:'#1a1a1a',color:'#fff',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:creando?0.6:1}}>{creando?'Creazione...':'Crea Distinta'}</button>
        </div>
        {msg && <div style={{padding:'10px 16px',fontSize:'13px',color:msg.startsWith('Errore')?'#dc2626':'#16a34a',background:msg.startsWith('Errore')?'#fef2f2':'#f0fdf4'}}>{msg}</div>}
        {loading ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>Caricamento...</div>
        ) : !corriereId ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>{corrieri.length ? 'Seleziona un contratto per vedere le spedizioni' : `Nessuna spedizione ${vettore ? vettore+' ' : ''}in attesa nel periodo scelto`}</div>
        ) : !visibili.length ? (
          <div style={{padding:'40px',textAlign:'center',color:'#999',fontSize:'13px'}}>{q ? 'Nessuna spedizione trovata con questa ricerca' : 'Nessuna spedizione in attesa per questo contratto nel periodo scelto'}</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  <th style={th}><input type="checkbox" checked={selected.length===visibili.length&&visibili.length>0} onChange={toggleAll}/></th>
                  <th style={th}>N. Spedizione</th>
                  <th style={th}>Destinatario</th>
                  <th style={th}>Città</th>
                  <th style={th}>CAP</th>
                  <th style={th}>Prov.</th>
                  <th style={th}>Peso</th>
                  <th style={th}>Colli</th>
                  <th style={th}>Data</th>
                  <th style={th}>ID Ordine</th>
                </tr>
              </thead>
              <tbody>
                {visibili.map(s=>(
                  <tr key={s.id} style={{background:selected.includes(s.id)?'#fff7ed':'#fff'}}>
                    <td style={td}><input type="checkbox" checked={selected.includes(s.id)} onChange={()=>toggle(s.id)}/></td>
                    <td style={{...td,color:'#f97316',fontWeight:'600'}}>{s.numero||'—'}</td>
                    <td style={td}>{s.dest_nome}</td>
                    <td style={td}>{s.dest_citta}</td>
                    <td style={td}>{s.dest_cap}</td>
                    <td style={td}>{s.dest_provincia}</td>
                    <td style={td}>{s.peso_fatturato||s.peso_reale||'—'}</td>
                    <td style={td}>{s.colli||1}</td>
                    <td style={td}>{new Date(s.created_at).toLocaleDateString('it-IT')}</td>
                    <td style={td}>{s.id_ordine||'—'}</td>
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