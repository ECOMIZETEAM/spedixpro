import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'

export default async function ClienteListinoPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/cliente')
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) redirect('/cliente')

  const { data: cliente } = await supabase.from('clienti').select('listino_cliente_id,ragione_sociale').eq('id', utente.cliente_id).single()

  if (!cliente?.listino_cliente_id) {
    return (
      <div>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',marginBottom:'16px'}}>Il mio Listino</h1>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'40px',textAlign:'center',color:'#bbb'}}>
          Nessun listino assegnato — contatta il tuo operatore.
        </div>
      </div>
    )
  }

  const { data: listino } = await supabase.from('listini_clienti').select('*').eq('id', cliente.listino_cliente_id).single()
  const { data: fasce } = await supabase.from('listini_clienti_fasce').select('*, zone(nome)').eq('listino_id', cliente.listino_cliente_id).order('peso_max',{ascending:true})

  // Raggruppa per zona
  const zoneMap: Record<string, {nome:string, fasce: any[]}> = {}
  fasce?.forEach(f => {
    const zonaNome = (f.zone as any)?.nome || 'Sconosciuta'
    if (!zoneMap[f.zona_id]) zoneMap[f.zona_id] = { nome: zonaNome, fasce: [] }
    zoneMap[f.zona_id].fasce.push(f)
  })

  // Griglia: zone come colonne, pesi come righe
  const pesiUniq = [...new Set(fasce?.map(f => f.peso_max))].sort((a,b) => a-b)
  const zoneList = Object.values(zoneMap)

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>Il mio Listino</h1>
        <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>{listino?.nome} — sola lettura</p>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden',marginBottom:'16px'}}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f0f0f0',display:'flex',gap:'24px'}}>
          <div>
            <span style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Listino</span>
            <div style={{fontSize:'13.5px',fontWeight:'700',color:'#1a1a1a',marginTop:'2px'}}>{listino?.nome}</div>
          </div>
          <div>
            <span style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Fattore Volumetrico</span>
            <div style={{fontSize:'13.5px',fontWeight:'700',color:'#1a1a1a',marginTop:'2px'}}>{listino?.fattore_volume || 5000}</div>
          </div>
          <div>
            <span style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Zone coperte</span>
            <div style={{fontSize:'13.5px',fontWeight:'700',color:'#1a1a1a',marginTop:'2px'}}>{zoneList.length}</div>
          </div>
        </div>

        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                <th style={{padding:'10px 16px',textAlign:'left',fontWeight:'600',color:'#666',fontSize:'11.5px',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap'}}>Peso</th>
                {zoneList.map(z=>(
                  <th key={z.nome} style={{padding:'10px 14px',textAlign:'center',fontWeight:'600',color:'#666',fontSize:'11.5px',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap'}}>
                    {z.nome} €
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pesiUniq.map(peso => (
                <tr key={peso} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'10px 16px',fontWeight:'600',color:'#1a1a1a'}}>
                    {fasce?.find(f=>f.peso_max===peso)?.tipo==='oltre' ? `Oltre X ogni ${peso} kg` : `Fino a ${peso} kg`}
                  </td>
                  {Object.entries(zoneMap).map(([zonaId, zona])=>{
                    const fascia = zona.fasce.find(f=>f.peso_max===peso)
                    return (
                      <td key={zonaId} style={{padding:'10px 14px',textAlign:'center'}}>
                        {fascia ? (
                          <span style={{fontWeight:'700',color:'#f97316',fontSize:'14px'}}>€ {Number(fascia.prezzo).toFixed(2)}</span>
                        ) : (
                          <span style={{color:'#e8e8e8'}}>—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{padding:'12px 18px',background:'#fffbeb',borderTop:'1px solid #f0f0f0',fontSize:'12px',color:'#92400e'}}>
          ℹ️ Il prezzo viene calcolato sul peso maggiore tra peso reale e peso volumetrico (L×A×P ÷ {listino?.fattore_volume||5000})
        </div>
      </div>
    </div>
  )
}
