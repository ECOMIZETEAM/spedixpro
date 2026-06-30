import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'

const DISPONIBILI = [
  {tipo:'spedisci',nome:'Spedisci.online',desc:'Aggregatore'},
  {tipo:'gls',nome:'GLS',desc:'Diretto'},
  {tipo:'sda',nome:'SDA Express',desc:'Diretto'},
  {tipo:'brt',nome:'BRT',desc:'Diretto'},
  {tipo:'dhl',nome:'DHL Express',desc:'Diretto'},
  {tipo:'poste',nome:'Poste Italiane',desc:'Diretto'},
  {tipo:'ups',nome:'UPS',desc:'Diretto'},
  {tipo:'tnt',nome:'TNT',desc:'Diretto'},
  {tipo:'inpost',nome:'InPost',desc:'Diretto'},
  {tipo:'spring',nome:'Spring',desc:'Diretto'},
  {tipo:'fedex',nome:'FedEx',desc:'Diretto'},
  {tipo:'hrp',nome:'HR Parcel',desc:'Diretto'},
]

export default async function CorrieriPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data: corrieri } = await supabase.from('corrieri').select('*').eq('master_id', utente?.master_id).order('created_at')

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Corrieri</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>{corrieri?.length||0} contratti configurati</p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13.5px',fontWeight:'600',color:'#1a1a1a'}}>Contratti Configurati</div>
          {!corrieri?.length ? (
            <div style={{padding:'30px',textAlign:'center',color:'#1a1a1a',fontSize:'13px'}}>Nessun contratto — aggiungine uno →</div>
          ) : corrieri.map(c => (
            <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 18px',borderBottom:'1px solid #f5f5f5'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{width:'44px',height:'28px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'4px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',color:'#333',textTransform:'uppercase'}}>{c.tipo}</div>
                <div>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#1a1a1a'}}>{c.nome_contratto}</div>
                  <div style={{fontSize:'11px',color:'#1a1a1a'}}>L{c.livello}</div>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <span style={{background:c.attivo?'#f0fdf4':'#fef2f2',color:c.attivo?'#16a34a':'#dc2626',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'600'}}>{c.attivo?'Attivo':'Off'}</span>
                <a href={`/dashboard/corrieri/aggiungi?tipo=${c.tipo}`} style={{padding:'4px 10px',background:'#f5f5f5',color:'#333',borderRadius:'4px',fontSize:'11px',textDecoration:'none',border:'1px solid #e8e8e8'}}>Impostazioni</a>
              </div>
            </div>
          ))}
        </div>

        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'13.5px',fontWeight:'600',color:'#1a1a1a'}}>Aggiungi Corriere</div>
          <div style={{padding:'16px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
            {DISPONIBILI.map(c => (
              <a key={c.tipo} href={`/dashboard/corrieri/aggiungi?tipo=${c.tipo}`}
                style={{border:'1px solid #e8e8e8',borderRadius:'6px',padding:'12px 8px',textAlign:'center',textDecoration:'none',display:'block',transition:'border-color .15s'}}>
                <div style={{width:'40px',height:'24px',background:'#f5f5f5',borderRadius:'3px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'9px',fontWeight:'700',color:'#333',margin:'0 auto 6px',textTransform:'uppercase'}}>{c.tipo}</div>
                <div style={{fontSize:'11px',fontWeight:'600',color:'#1a1a1a',lineHeight:1.3}}>{c.nome}</div>
                <div style={{fontSize:'10px',color:'#1a1a1a',marginTop:'2px'}}>{c.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
