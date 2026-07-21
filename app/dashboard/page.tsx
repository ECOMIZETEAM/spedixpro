'use client'
import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import ReportGuadagno from '@/app/components/ReportGuadagno'
import GuadagnoChart from '@/app/components/GuadagnoChart'
import GuadagnoAgente from '@/app/components/GuadagnoAgente'

export default function Dashboard() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    const carica = () => fetch('/api/dashboard', { cache: 'no-store' }).then(r=>r.json()).then(d=>{ if (vivo) { setData(d); setLoading(false) } }).catch(()=>{ if (vivo) setLoading(false) })
    carica()
    // Ogni 2 min e SOLO a scheda visibile (prima ogni 20s sempre: con le schede lasciate aperte le
    // RPC dashboard dominavano il carico DB). Al ritorno sulla pagina c'è già il refresh immediato.
    const t = setInterval(() => { if (document.visibilityState === 'visible') carica() }, 120000)
    const onFocus = () => { if (document.visibilityState === 'visible') carica() }  // e al ritorno sulla pagina
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus) }
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
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'12px'}}>

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

        {/* LDV da chiudere in distinta — cliccabile: porta alla creazione distinta */}
        <a href="/dashboard/distinte/crea" style={{...kpiCardLight, textDecoration:'none', display:'block', ...(Number(data.daMettereInDistinta||0) > 0 ? {borderColor:'#fed7aa', background:'#fff7ed'} : {})}}>
          <div style={kpiIconLight}>🧾</div>
          <div style={kpiLabel}>DA CHIUDERE<br/><span style={{color:'#bbb'}}>IN DISTINTA</span></div>
          <div style={{...kpiValue, color: Number(data.daMettereInDistinta||0) > 0 ? '#ea580c' : '#1a1a1a'}}>{data.daMettereInDistinta ?? 0}</div>
        </a>

        {/* Clienti */}
        <div style={kpiCardLight}>
          <div style={kpiIconLight}>👥</div>
          <div style={kpiLabel}>CLIENTI<br/><span style={{color:'#bbb'}}>REGISTRATI</span></div>
          <div style={kpiValue}>{data.totClienti}</div>
        </div>
      </div>

      {/* KPI globali di tutta la rete (spedizioni proprie + improprie) */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'12px'}}>
        <div style={kpiCardLight}>
          <div style={kpiIconLight}>📦</div>
          <div style={kpiLabel}>SPEDIZIONI<br/><span style={{color:'#bbb'}}>TOTALI RETE</span></div>
          <div style={kpiValue}>{Number(data.spedizioniTotali||0).toLocaleString()}</div>
        </div>
        <div style={kpiCardLight}>
          <div style={kpiIconLight}>💶</div>
          <div style={kpiLabel}>VOLUME<br/><span style={{color:'#bbb'}}>DEL MESE</span></div>
          <div style={{...kpiValue,fontSize:'20px'}}>€ {Number(data.fatturatoMese||0).toLocaleString('it-IT',{minimumFractionDigits:2})}</div>
        </div>
        <div style={kpiCardLight}>
          <div style={{...kpiIconLight,background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#16a34a'}}>✅</div>
          <div style={kpiLabel}>CONSEGNATE<br/><span style={{color:'#bbb'}}>(MESE)</span></div>
          <div style={kpiValue}>{Number(data.consegnateMese||0).toLocaleString()}</div>
        </div>
        <div style={kpiCardLight}>
          <div style={{...kpiIconLight,background:'#eff6ff',border:'1px solid #bfdbfe',color:'#2563eb'}}>🚛</div>
          <div style={kpiLabel}>IN TRANSITO</div>
          <div style={kpiValue}>{Number(data.inTransito||0).toLocaleString()}</div>
        </div>
        <div style={kpiCardLight}>
          <div style={{...kpiIconLight,background:'#fef2f2',border:'1px solid #fecaca',color:'#dc2626'}}>⏸️</div>
          <div style={kpiLabel}>IN GIACENZA</div>
          <div style={kpiValue}>{Number(data.inGiacenza||0).toLocaleString()}</div>
        </div>
        <div style={kpiCardLight}>
          <div style={kpiIconLight}>💵</div>
          <div style={kpiLabel}>CONTRASSEGNI<br/><span style={{color:'#bbb'}}>DA RIMETTERE</span></div>
          <div style={{...kpiValue,fontSize:'20px',color:Number(data.codDaRimettere)>0?'#ea580c':'#1a1a1a'}}>€ {Number(data.codDaRimettere||0).toLocaleString('it-IT',{minimumFractionDigits:2})}</div>
        </div>
      </div>

      {/* Tasso consegna + Top corriere + Top cliente */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:'12px'}}>
        <div style={kpiCardLight}>
          <div style={{...kpiIconLight,background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#16a34a'}}>📈</div>
          <div style={kpiLabel}>TASSO DI CONSEGNA</div>
          <div style={{...kpiValue,color:'#16a34a'}}>{Number(data.tassoConsegna||0).toFixed(1)}%</div>
          <div style={{fontSize:'11px',color:'#999',marginTop:'4px'}}>{Number(data.consegnateTotali||0).toLocaleString()} consegnate su {Number(data.spedizioniTotali||0).toLocaleString()}</div>
        </div>
        <div style={kpiCardLight}>
          <div style={{...kpiIconLight,background:'#eff6ff',border:'1px solid #bfdbfe',color:'#2563eb'}}>🚚</div>
          <div style={kpiLabel}>TOP CORRIERE</div>
          <div style={{...kpiValue,fontSize:'17px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const}}>{data.topCorriere?.nome || '—'}</div>
          <div style={{fontSize:'11px',color:'#999',marginTop:'4px'}}>{data.topCorriere?.n ? `${Number(data.topCorriere.n).toLocaleString()} spedizioni` : 'nessun dato'}</div>
        </div>
        <div style={kpiCardLight}>
          <div style={{...kpiIconLight,background:'#fff7ed',border:'1px solid #fed7aa',color:'#f97316'}}>🏆</div>
          <div style={kpiLabel}>TOP CLIENTE</div>
          <div style={{...kpiValue,fontSize:'17px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const}}>{data.topCliente?.nome || '—'}</div>
          <div style={{fontSize:'11px',color:'#999',marginTop:'4px'}}>{data.topCliente?.n ? `${Number(data.topCliente.n).toLocaleString()} spedizioni` : 'nessun dato'}</div>
        </div>
      </div>

      {/* Grafici */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:'16px'}}>
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
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:'16px'}}>
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

      {/* Report Guadagno — l'agente vede il PROPRIO margine (prezzo cliente − suo costo) */}
      {data?.ruolo === 'agente' ? (
        <GuadagnoAgente />
      ) : (
        <>
          <div style={{fontSize:'13px',fontWeight:700,color:'#1a1a1a',marginTop:'2px'}}>Report Guadagno</div>
          <GuadagnoChart />
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:'14px'}}>
            <ReportGuadagno titolo="Rettifiche" endpoint="/api/reports/guadagno-rettifiche" />
            <ReportGuadagno titolo="Supplementi" endpoint="/api/reports/guadagno-supplementi" />
          </div>
        </>
      )}
    </div>
  )
}
