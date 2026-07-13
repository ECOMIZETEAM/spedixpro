'use client'
import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import ReportGuadagno from '@/app/components/ReportGuadagno'
import GuadagnoChart from '@/app/components/GuadagnoChart'

export default function Dashboard() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard').then(r=>r.json()).then(d=>{setData(d);setLoading(false)}).catch(()=>setLoading(false))
  }, [])

  if (loading) return <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a',fontSize:'14px'}}>Caricamento...</div>
  if (!data) return <div style={{padding:'60px',textAlign:'center',color:'#1a1a1a'}}>Errore caricamento</div>

  const STATI_COLORS: Record<string,string> = {
    'in_lavorazione':'#ca8a04',
    'spedita':'#0284c7',
    'in_transito':'#2563eb',
    'in_consegna':'#ea580c',
    'consegnata':'#16a34a',
    'in_giacenza':'#dc2626',
    'reso_mittente':'#374151',
    'non_consegnato':'#6b7280',
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

  // KPI card monocromatiche: nero per il principale, arancione per accento, bianco/grigio per gli altri
  const kpiCardDark = {background:'#1a1a1a',borderRadius:'8px',padding:'14px 18px',color:'#fff',display:'flex',alignItems:'center',gap:'14px'}
  const kpiCardLight = {background:'#fff',border:'1px solid #e8e8e8',borderRadius:'8px',padding:'14px'}
  const kpiIconDark = {width:'44px',height:'44px',background:'rgba(249,115,22,0.15)',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',flexShrink:0,color:'#f97316'}
  const kpiIconLight = {width:'36px',height:'36px',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'7px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px',marginBottom:'8px',color:'#f97316'}
  const kpiLabel = {fontSize:'10px',fontWeight:'700' as const,textTransform:'uppercase' as const,letterSpacing:'0.6px',color:'#999',lineHeight:1.3}
  const kpiValue = {fontSize:'26px',fontWeight:'800' as const,marginTop:'4px',lineHeight:1,color:'#1a1a1a'}

  return (
    <div style={{display:'flex',flexDirection:'column' as const,gap:'16px'}}>

      {/* Saluto */}
      <div>
        <h1 style={{fontSize:'18px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Ciao, {data.masterNome}</h1>
        <p style={{color:'#999',fontSize:'12px',margin:'4px 0 0'}}>{new Date().toLocaleDateString('it-IT',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
      </div>

      {/* KPI */}
      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',gap:'12px'}}>

        {/* Spedizioni mese — card scura principale */}
        <div style={kpiCardDark}>
          <div style={kpiIconDark}>📦</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:'10px',fontWeight:'700',textTransform:'uppercase' as const,letterSpacing:'0.6px',color:'#999',marginBottom:'3px'}}>
              SPEDIZIONI {new Date().toLocaleString('it-IT',{month:'short'}).toUpperCase()}
            </div>
            <div style={{fontSize:'20px',fontWeight:'800',lineHeight:1,color:'#fff'}}>{data.spedizioniMese?.toLocaleString()} <span style={{fontSize:'13px',color:'#999'}}>/ {data.illimitato ? '∞' : data.limiteMese?.toLocaleString()}</span></div>
            {data.illimitato ? (
              <div style={{fontSize:'10px',marginTop:'8px',color:'#f97316',fontWeight:700}}>Illimitato</div>
            ) : (<>
              <div style={{background:'rgba(255,255,255,0.12)',borderRadius:'4px',height:'4px',marginTop:'8px'}}>
                <div style={{background:'#f97316',borderRadius:'4px',height:'4px',width:`${Math.min(100,(data.spedizioniMese/data.limiteMese)*100)}%`,transition:'width 0.5s'}}/>
              </div>
              <div style={{fontSize:'10px',marginTop:'3px',color:'#777'}}>{((data.spedizioniMese/data.limiteMese)*100).toFixed(3)}%</div>
            </>)}
          </div>
        </div>

        {/* Spedite oggi */}
        <div style={kpiCardLight}>
          <div style={kpiIconLight}>🚚</div>
          <div style={kpiLabel}>SPEDIZIONI SPEDITE<br/><span style={{color:'#bbb'}}>(OGGI)</span></div>
          <div style={kpiValue}>{data.spediteOggi}</div>
        </div>

        {/* Da spedire */}
        <div style={kpiCardLight}>
          <div style={kpiIconLight}>📋</div>
          <div style={kpiLabel}>DA SPEDIRE<br/><span style={{color:'#bbb'}}>(ULTIMI 30 GG)</span></div>
          <div style={kpiValue}>{data.daSpedire}</div>
        </div>

        {/* In lavorazione */}
        <div style={kpiCardLight}>
          <div style={kpiIconLight}>⚙️</div>
          <div style={kpiLabel}>IN LAVORAZIONE<br/><span style={{color:'#bbb'}}>(ULTIMI 30 GG)</span></div>
          <div style={kpiValue}>{data.inLavorazione}</div>
        </div>

        {/* Clienti */}
        <div style={kpiCardLight}>
          <div style={kpiIconLight}>👥</div>
          <div style={kpiLabel}>CLIENTI<br/><span style={{color:'#bbb'}}>REGISTRATI</span></div>
          <div style={kpiValue}>{data.totClienti}</div>
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

      {/* Report Guadagno */}
      <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginTop:'2px'}}>Report Guadagno</div>
      <GuadagnoChart />
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:'14px'}}>
        <ReportGuadagno titolo="Rettifiche" endpoint="/api/reports/guadagno-rettifiche" />
        <ReportGuadagno titolo="Supplementi" endpoint="/api/reports/guadagno-supplementi" />
      </div>
    </div>
  )
}
