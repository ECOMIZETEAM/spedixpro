'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function NuovoListinoPage() {
  const router = useRouter()
  const [step, setStep] = useState<'nome'|'contratti'>('nome')
  const [nomeListino, setNomeListino] = useState('')
  const [corrieri, setCorrieri] = useState<any[]>([])
  const [selectedCorrieri, setSelectedCorrieri] = useState<string[]>([])
  const [listino, setListino] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')

  useEffect(() => {
    fetch('/api/corrieri/lista').then(r=>r.json()).then(d=>setCorrieri(d||[]))
  }, [])

  async function creaListino() {
    if (!nomeListino.trim()) { setErrore('Inserisci il nome del listino'); return }
    if (!selectedCorrieri.length) { setErrore('Seleziona almeno un contratto'); return }
    setSaving(true); setErrore('')
    const res = await fetch('/api/listini/crea', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ nome: nomeListino, corriereIds: selectedCorrieri })
    })
    const data = await res.json()
    if (data.error) { setSaving(false); setErrore(data.error); return }
    for (const corriereId of selectedCorrieri) {
      await fetch('/api/listini/cliente-corrieri', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ listinoId: data.id, corriereId })
      })
    }
    setSaving(false)
    setListino(data)
    setStep('contratti')
  }

  function toggleCorriere(id: string) {
    setSelectedCorrieri(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id])
  }

  if (step === 'contratti') {
    return <ModificaListino listino={listino} corriereIds={selectedCorrieri} corrieri={corrieri} router={router}/>
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Nuovo Listino</h1>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'20px'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#1a1a1a',marginBottom:'16px'}}>🔍 Listino cliente</div>

        {errore && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'6px',padding:'10px',marginBottom:'16px',fontSize:'13px',color:'#dc2626'}}>{errore}</div>}

        <div style={{maxWidth:'600px',margin:'0 auto'}}>
          <div style={{marginBottom:'20px'}}>
            <label style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',display:'block',marginBottom:'6px'}}>Nome listino</label>
            <input value={nomeListino} onChange={e=>setNomeListino(e.target.value)}
              style={{width:'100%',padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box' as const}}/>
          </div>

          <div>
            <div style={{fontSize:'13px',fontWeight:'700',color:'#1a1a1a',marginBottom:'10px'}}>Contratti</div>
            <div style={{display:'flex',flexDirection:'column' as const,gap:'6px'}}>
              {corrieri.map((c:any)=>(
                <label key={c.id} style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',padding:'6px 8px',borderRadius:'4px',background:selectedCorrieri.includes(c.id)?'#fff7ed':'transparent'}}>
                  <input type="checkbox" checked={selectedCorrieri.includes(c.id)} onChange={()=>toggleCorriere(c.id)}
                    style={{width:'14px',height:'14px',cursor:'pointer'}}/>
                  <span style={{fontSize:'13px',color:'#1a1a1a',fontWeight:selectedCorrieri.includes(c.id)?'600':'400'}}>
                    {c.nome_contratto||c.nome}
                  </span>
                </label>
              ))}
              {!corrieri.length && <div style={{color:'#666',fontSize:'13px'}}>Nessun corriere configurato</div>}
            </div>
          </div>

          <div style={{marginTop:'24px',display:'flex',gap:'10px'}}>
            <button onClick={creaListino} disabled={saving}
              style={{padding:'9px 28px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer',opacity:saving?0.7:1}}>
              {saving?'Creazione...':'Avanti →'}
            </button>
            <button onClick={()=>router.push('/dashboard/listini')}
              style={{padding:'9px 20px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',cursor:'pointer',color:'#1a1a1a'}}>
              Annulla
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModificaListino({listino, corriereIds, corrieri, router}: any) {
  const [aggiungendo, setAggiungendo] = useState(false)
  const [nuovoCorriere, setNuovoCorriere] = useState('')
  const [assegnati, setAssegnati] = useState<string[]>(corriereIds)
  const [saving, setSaving] = useState(false)

  const corrieriSelezionati = corrieri.filter((c:any) => assegnati.includes(c.id))
  const corrieriDisponibili = corrieri.filter((c:any) => !assegnati.includes(c.id))

  async function confermaAggiungi() {
    if (!nuovoCorriere) return
    setSaving(true)
    await fetch('/api/listini/cliente-corrieri', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ listinoId: listino?.id, corriereId: nuovoCorriere })
    })
    setAssegnati(prev => [...prev, nuovoCorriere])
    setNuovoCorriere('')
    setAggiungendo(false)
    setSaving(false)
  }

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Modifica Listino</h1>
      </div>

      <div style={{background:'#2563eb',color:'#fff',borderRadius:'6px',padding:'12px 16px',marginBottom:'16px',fontSize:'13px',fontWeight:'600'}}>
        Il nuovo listino è stato creato!
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>
        <div style={{padding:'14px 20px',borderBottom:'1px solid #d1d5db',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:'16px',fontWeight:'700',color:'#1a1a1a'}}>{listino?.nome}</span>
          {!aggiungendo && corrieriDisponibili.length > 0 && (
            <button onClick={()=>setAggiungendo(true)}
              style={{background:'none',border:'none',color:'#2563eb',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
              + Aggiungi contratto
            </button>
          )}
        </div>

        {aggiungendo && (
          <div style={{padding:'14px 20px',borderBottom:'1px solid #d1d5db',background:'#f9fafb',display:'flex',alignItems:'center',gap:'10px'}}>
            <select value={nuovoCorriere} onChange={e=>setNuovoCorriere(e.target.value)}
              style={{padding:'7px 10px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',color:'#1a1a1a',flex:1}}>
              <option value="">Seleziona contratto...</option>
              {corrieriDisponibili.map((c:any)=>(
                <option key={c.id} value={c.id}>{c.nome_contratto||c.nome}</option>
              ))}
            </select>
            <button onClick={confermaAggiungi} disabled={saving || !nuovoCorriere}
              style={{padding:'7px 14px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'700',cursor:'pointer',opacity:(saving||!nuovoCorriere)?0.6:1}}>
              {saving?'Aggiungo...':'Aggiungi'}
            </button>
            <button onClick={()=>{setAggiungendo(false);setNuovoCorriere('')}}
              style={{padding:'7px 14px',background:'#f5f5f5',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',cursor:'pointer',color:'#1a1a1a'}}>
              Annulla
            </button>
          </div>
        )}

        {corrieriSelezionati.map((c:any)=>(
          <div key={c.id} style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',alignItems:'center',gap:'14px',cursor:'pointer'}}
            onClick={()=>router.push('/dashboard/listini/clienti/' + listino?.id + '?corriere=' + c.id)}>
            <div style={{width:'60px',height:'36px',background:'#ffd700',borderRadius:'4px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',color:'#1a1a1a',textAlign:'center' as const,padding:'2px'}}>
              {c.tipo?.toUpperCase()||'CORR'}
            </div>
            <span style={{fontSize:'14px',fontWeight:'600',color:'#2563eb'}}>{c.nome_contratto||c.nome}</span>
          </div>
        ))}

        {!corrieriSelezionati.length && (
          <div style={{padding:'40px',textAlign:'center' as const,color:'#666',fontSize:'13px'}}>Nessun contratto selezionato</div>
        )}
      </div>

      <div style={{marginTop:'16px'}}>
        <button onClick={()=>router.push('/dashboard/listini')}
          style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>
          ✅ Fine
        </button>
      </div>
    </div>
  )
}