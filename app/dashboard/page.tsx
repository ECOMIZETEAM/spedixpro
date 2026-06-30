'use client'
import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'

export default function Dashboard() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard').then(r=>r.json()).then(d=>{setData(d);setLoading(false)}).catch(()=>setLoading(false))
  }, [])

  if (loading) return <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a',fontSize:'14px'}}>Caricamento...</div>
  if (!data) return <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>Errore caricamento</div>

  const STATI_COLORS: Record<string,string> = {
    'in_lavorazione':'#f97316',
    'spedita':'#9ca3af',
    'in_transito':'#6ee7b7',
    'in_consegna':'#3b82f6',
    'consegnata':'#eab308',
    'in_giacenza':'#22c55e',
    'reso_mittente':'#ef4444',
    'non_consegnato':'#8b5cf6',
    'in_attesa_istruzioni':'#374151',
  }

  const STATI_LABELS: Record<string,string> = {
    'in_lavorazione':'In Lavorazione',
    'spedita':'Spedita',
    'in_transito':'In transito',
    'in_consegna':'In Consegna',
    'consegnata':'Consegnata',
    'in_giacenza':'In Giacenza',
    'reso_mittente':'Reso al mittente',
    'non_consegnato':'Non consegnato',
    'in_attesa_istruzioni':'In attesa di istruzioni',
  }

  const pieData = Object.entries(data.statiUltimi30 || {}).map(([stato, count]) => ({
    name: STATI_LABELS[stato] || stato.replace(/_/g,' '),
    value: count as number,
    color: STATI_COLORS[stato]||'#e5e7eb'
  })).filter(d => d.value > 0)

  const card = {background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden' as const}
  const cardH = {padding:'12px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13px',fontWeight:'700' as const,color:'#1a1a1a'}

  return (
    <div style={{display:'flex',flexDirection:'column' as const,gap:'16px'}}>

      {/* Saluto */}
      <div>
        <h1 style={{fontSize:'18px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Ciao, {data.masterNome}</h1>
        <p style={{color:'#1a1a1a',fontSize:'12px',margin:'4px 0 0'}}>{new Date().toLocaleDateString('it-IT',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
      </div>

      {/* KPI */}
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',gap:'12px'}}>

        {/* Spedizioni mese */}
        <div style={{background:'#29abe2',borderRadius:'8px',padding:'14px 18px',color:'#fff',display:'flex',alignItems:'center',gap:'14px'}}>
          <div style={{width:'44px',height:'44px',background:'rgba(255,255,255,0.2)',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',flexShrink:0}}>📦</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,letterSpacing:'0.6px',opacity:0.8,marginBottom:'3px'}}>
              SPEDIZIONI {new Date().toLocaleString('it-IT',{month:'short'}).toUpperCase()}
            </div>
            <div style={{fontSize:'20px',fontWeight:'800',lineHeight:1}}>{data.spedizioniMese?.toLocaleString()} <span style={{fontSize:'13px',opacity:0.7}}>/ {data.limiteMese?.toLocaleString()}</span></div>
            <div style={{background:'rgba(255,255,255,0.25)',borderRadius:'4px',height:'4px',marginTop:'8px'}}>
              <div style={{background:'#fff',borderRadius:'4px',height:'4px',width:`${Math.min(100,(data.spedizioniMese/data.limiteMese)*100)}%`,transition:'width 0.5s'}}/>
            </div>
            <div style={{fontSize:'10px',marginTop:'3px',opacity:0.75}}>{((data.spedizioniMese/data.limiteMese)*100).toFixed(3)}%</div>
          </div>
        </div>

        {/* Spedite oggi */}
        <div style={{background:'#29abe2',borderRadius:'8px',padding:'14px',color:'#fff'}}>
          <div style={{width:'36px',height:'36px',background:'rgba(255,255,255,0.2)',borderRadius:'7px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',marginBottom:'8px'}}>🚚</div>
          <div style={{fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,opacity:0.8,lineHeight:1.3}}>SPEDIZIONI SPEDITE<br/><span style={{opacity:0.65}}>(OGGI)</span></div>
          <div style={{fontSize:'26px',fontWeight:'800',marginTop:'4px',lineHeight:1}}>{data.spediteOggi}</div>
        </div>

        {/* Da spedire */}
        <div style={{background:'#5cb85c',borderRadius:'8px',padding:'14px',color:'#fff'}}>
          <div style={{width:'36px',height:'36px',background:'rgba(255,255,255,0.2)',borderRadius:'7px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',marginBottom:'8px'}}>📋</div>
          <div style={{fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,opacity:0.8,lineHeight:1.3}}>DA SPEDIRE<br/><span style={{opacity:0.65}}>(ULTIMI 30 GG)</span></div>
          <div style={{fontSize:'26px',fontWeight:'800',marginTop:'4px',lineHeight:1}}>{data.daSpedire}</div>
        </div>

        {/* In lavorazione */}
        <div style={{background:'#d9534f',borderRadius:'8px',padding:'14px',color:'#fff'}}>
          <div style={{width:'36px',height:'36px',background:'rgba(255,255,255,0.2)',borderRadius:'7px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',marginBottom:'8px'}}>⚙️</div>
          <div style={{fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,opacity:0.8,lineHeight:1.3}}>IN LAVORAZIONE<br/><span style={{opacity:0.65}}>(ULTIMI 30 GG)</span></div>
          <div style={{fontSize:'26px',fontWeight:'800',marginTop:'4px',lineHeight:1}}>{data.inLavorazione}</div>
        </div>

        {/* Clienti */}
        <div style={{background:'#f0ad4e',borderRadius:'8px',padding:'14px',color:'#fff'}}>
          <div style={{width:'36px',height:'36px',background:'rgba(255,255,255,0.2)',borderRadius:'7px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',marginBottom:'8px'}}>👥</div>
          <div style={{fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,opacity:0.8,lineHeight:1.3}}>CLIENTI<br/><span style={{opacity:0.65}}>REGISTRATI</span></div>
          <div style={{fontSize:'26px',fontWeight:'800',marginTop:'4px',lineHeight:1}}>{data.totClienti}</div>
        </div>
      </div>

      {/* Grafici */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
        <div style={card}>
          <div style={cardH}>Statistiche</div>
          <div style={{padding:'16px'}}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.statsMensili||[]} margin={{top:0,right:0,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5"/>
                <XAxis dataKey="mese" tick={{fontSize:10,fill:'#bbb'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:10,fill:'#bbb'}} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{borderRadius:'6px',border:'1px solid #e8e8e8',fontSize:'12px'}} formatter={(v:any)=>[v.toLocaleString(),'Spedizioni']}/>
                <Bar dataKey="totale" fill="#f97316" name="Totale Spedizioni" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={card}>
          <div style={cardH}>Statistiche (ultimi 30 gg)</div>
          <div style={{padding:'16px'}}>
            {pieData.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" strokeWidth={2}>
                    {pieData.map((entry,i) => <Cell key={i} fill={entry.color} stroke="#fff"/>)}
                  </Pie>
                  <Legend iconSize={10} wrapperStyle={{fontSize:'11px',color:'#1a1a1a'}}/>
                  <Tooltip contentStyle={{borderRadius:'6px',border:'1px solid #e8e8e8',fontSize:'12px'}}/>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{padding:'40px',textAlign:'center',color:'#1a1a1a',fontSize:'13px'}}>Nessun dato disponibile</div>
            )}
          </div>
        </div>
      </div>

      {/* Tabelle */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
        <div style={card}>
          <div style={cardH}>Statistiche Spedizioni</div>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['#','Mese','Totale Spedizioni','Totale €'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'8px 14px',fontSize:'11px',fontWeight:'600',color:'#1a1a1a',borderBottom:'1px solid #f0f0f0'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!(data.statsMensili||[]).length ? (
                <tr><td colSpan={4} style={{padding:'30px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'12px'}}>Nessun dato</td></tr>
              ) : (data.statsMensili||[]).map((s:any,i:number)=>(
                <tr key={i} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'8px 14px',color:'#1a1a1a',fontSize:'12px'}}>{i+1}</td>
                  <td style={{padding:'8px 14px',color:'#1a1a1a',fontWeight:'500'}}>{s.mese}</td>
                  <td style={{padding:'8px 14px',color:'#1a1a1a',fontWeight:'600'}}>{s.totale?.toLocaleString()}</td>
                  <td style={{padding:'8px 14px',color:'#f97316',fontWeight:'700'}}>€ {Number(s.importo||0).toLocaleString('it-IT',{minimumFractionDigits:2})}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={card}>
          <div style={cardH}>Statistiche spese spedizioni extra, resi, giacenze...</div>
          <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['#','Mese','Totale Operazioni','Importo Totale'].map(h=>(
                  <th key={h} style={{textAlign:'left' as const,padding:'8px 14px',fontSize:'11px',fontWeight:'600',color:'#1a1a1a',borderBottom:'1px solid #f0f0f0'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={4} style={{padding:'30px',textAlign:'center' as const,color:'#1a1a1a',fontSize:'12px'}}>Nessun dato disponibile</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}