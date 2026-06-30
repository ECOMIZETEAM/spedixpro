import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'

export default async function ClienteDashboard() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/cliente')
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) redirect('/cliente')
  const { data: spedizioni } = await supabase.from('spedizioni').select('*').eq('cliente_id', utente.cliente_id).order('created_at',{ascending:false}).limit(20)

  const stats = {
    totali: spedizioni?.length||0,
    inLav: spedizioni?.filter(s=>s.stato==='in_lavorazione').length||0,
    spedite: spedizioni?.filter(s=>s.stato==='spedita'||s.stato==='in_transito').length||0,
    consegnate: spedizioni?.filter(s=>s.stato==='consegnata').length||0,
  }

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Dashboard</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>{new Date().toLocaleDateString('it-IT',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'16px',marginBottom:'24px'}}>
        {[{l:'Totali',v:stats.totali,c:'#1a1a1a'},{l:'In Lavorazione',v:stats.inLav,c:'#d97706'},{l:'In Transito',v:stats.spedite,c:'#2563eb'},{l:'Consegnate',v:stats.consegnate,c:'#16a34a'}].map(k=>(
          <div key={k.l} style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'20px'}}>
            <div style={{fontSize:'28px',fontWeight:'800',color:k.c,lineHeight:1}}>{k.v}</div>
            <div style={{fontSize:'11.5px',color:'#999',marginTop:'6px',textTransform:'uppercase',letterSpacing:'0.5px'}}>{k.l}</div>
          </div>
        ))}
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        <div style={{padding:'14px 20px',borderBottom:'1px solid #f0f0f0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:'13.5px',fontWeight:'600',color:'#1a1a1a'}}>Ultime Spedizioni</span>
          <a href="/cliente/spedizioni/nuova" style={{background:'#f97316',color:'#fff',padding:'7px 16px',borderRadius:'6px',fontSize:'12px',fontWeight:'600',textDecoration:'none'}}>+ Nuova Spedizione</a>
        </div>
        {!spedizioni?.length ? (
          <div style={{padding:'40px',textAlign:'center',color:'#bbb',fontSize:'13px'}}>
            Nessuna spedizione — <a href="/cliente/spedizioni/nuova" style={{color:'#f97316',textDecoration:'none',fontWeight:'500'}}>crea la prima</a>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                {['N. Spedizione','Destinatario','Città','Data','Stato','Totale',''].map(h=>(
                  <th key={h} style={{textAlign:'left',padding:'8px 16px',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',color:'#bbb',borderBottom:'1px solid #f0f0f0'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spedizioni.map(s=>(
                <tr key={s.id} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'10px 16px',fontWeight:'600',color:'#f97316',fontSize:'12.5px'}}>{s.numero}</td>
                  <td style={{padding:'10px 16px',color:'#333',fontWeight:'500'}}>{s.dest_nome}</td>
                  <td style={{padding:'10px 16px',color:'#999',fontSize:'12px'}}>{s.dest_citta} ({s.dest_provincia})</td>
                  <td style={{padding:'10px 16px',color:'#999',fontSize:'12px',whiteSpace:'nowrap'}}>{new Date(s.created_at).toLocaleDateString('it-IT')}</td>
                  <td style={{padding:'10px 16px'}}>
                    <span style={{background:s.stato==='consegnata'?'#f0fdf4':s.stato==='in_lavorazione'?'#fffbeb':'#eff6ff',color:s.stato==='consegnata'?'#16a34a':s.stato==='in_lavorazione'?'#d97706':'#2563eb',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'500'}}>
                      {s.stato.replace(/_/g,' ')}
                    </span>
                  </td>
                  <td style={{padding:'10px 16px',fontWeight:'600',color:'#1a1a1a'}}>€ {Number(s.costo_totale||0).toFixed(2)}</td>
                  <td style={{padding:'10px 16px'}}>
                    <a href={`/dashboard/spedizioni/${s.id}/etichetta`} target="_blank"
                      style={{padding:'4px 10px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'4px',fontSize:'11px',color:'#333',textDecoration:'none'}}>🖨️</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
