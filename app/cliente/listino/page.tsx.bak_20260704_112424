import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import Link from 'next/link'

function iconaCorriere(nome: string): string | null {
  const n = (nome || '').toUpperCase()
  const regole: [string, string][] = [
    ['DELIVERY BUSINESS','poste_delivery_business'],['POSTE','poste_delivery_business'],
    ['SDA','sda'],['GLS','gls'],['BRT','brt'],['TNT','tnt'],
    ['DHL ECONNECT','dhl_econnect'],['ECONNECT','dhl_econnect'],['DHL','dhl'],
    ['FEDEX','fedex'],['UPS','ups'],['HERMES','hermes'],['NEXIVE','nexive'],
    ['LICCARDI','liccardi'],['SAILPOST','sailpost'],['BDM','bdm'],['NSSA','nssa'],
    ['HR PARCEL','hrp'],['HRP','hrp'],['PALLETWAYS','palletways'],
    ['CORREOS EXPRESS','correos_express'],['CORREOS','correos'],
    ['INPOST','inpost'],['SPRING','spring'],['PAACK','paack'],['SPEEDY','speedy'],
    ['AMAZON','amazon_shipping'],['CTT','ctt_express'],['AIPACK','aipack'],['GTECH','gtechgroup'],
  ]
  for (const [k, file] of regole) { if (n.includes(k)) return '/corrieri/' + file + '.png' }
  return null
}

function parseJSON(s: any) { try { return JSON.parse(s) } catch { return null } }
const EUR = '\u20AC'

export default async function ClienteListinoPage({ searchParams }: { searchParams: Promise<{ corriere?: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/cliente')
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  if (!utente?.cliente_id) redirect('/cliente')
  const { data: cliente } = await supabase.from('clienti').select('listino_cliente_id,ragione_sociale').eq('id', utente.cliente_id).single()

  if (!cliente?.listino_cliente_id) {
    return (
      <div>
        <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',marginBottom:'16px'}}>Listino prezzi</h1>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',padding:'40px',textAlign:'center',color:'#bbb'}}>
          Nessun listino assegnato - contatta il tuo operatore.
        </div>
      </div>
    )
  }

  const listinoId = cliente.listino_cliente_id
  const { data: listino } = await supabase.from('listini_clienti').select('*').eq('id', listinoId).single()

  const { data: agganci } = await supabase.from('listini_clienti_corrieri')
    .select('corriere_id, fattore_volume, corrieri(id,nome_contratto,tipo)')
    .eq('listino_id', listinoId)
  let contratti: any[] = (agganci || []).map((a: any) => a.corrieri ? { ...a.corrieri, fattore_volume: a.fattore_volume } : null).filter(Boolean)

  if (!contratti.length) {
    const { data: fCorr } = await supabase.from('listini_clienti_fasce').select('corriere_id').eq('listino_id', listinoId)
    const ids = Array.from(new Set((fCorr || []).map((r: any) => r.corriere_id).filter(Boolean)))
    if (ids.length) {
      const { data: cs } = await supabase.from('corrieri').select('id,nome_contratto,tipo').in('id', ids)
      contratti = (cs || []).map((c: any) => ({ ...c, fattore_volume: null }))
    }
  }

  const { corriere: corriereSel } = await searchParams
  const sel = corriereSel ? contratti.find((c: any) => c.id === corriereSel) : null

  if (!sel) {
    return (
      <div>
        <div style={{marginBottom:'20px'}}>
          <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>Listino prezzi</h1>
          <p style={{color:'#999',fontSize:'13px',marginTop:'4px'}}>Contratti attivi sul tuo account - clicca per vedere prezzi e supplementi</p>
        </div>
        <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
          {contratti.length === 0 && (
            <div style={{padding:'40px',textAlign:'center',color:'#bbb'}}>Nessun contratto disponibile.</div>
          )}
          {contratti.map((c: any, idx: number) => {
            const logo = iconaCorriere(c.nome_contratto)
            return (
              <Link key={c.id} href={'/cliente/listino?corriere=' + c.id}
                style={{display:'flex',alignItems:'center',gap:'18px',padding:'18px 22px',textDecoration:'none',borderTop: idx === 0 ? 'none' : '1px solid #f0f0f0'}}>
                <div style={{width:'110px',height:'40px',display:'flex',alignItems:'center',justifyContent:'flex-start',flexShrink:0}}>
                  {logo
                    ? <img src={logo} alt={c.nome_contratto} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}} />
                    : <div style={{fontSize:'12px',color:'#999'}}>{c.nome_contratto}</div>}
                </div>
                <div style={{fontSize:'15px',fontWeight:600,color:'#2d7fc4'}}>{c.nome_contratto}</div>
                <div style={{marginLeft:'auto',color:'#cbd5e1',fontSize:'20px'}}>{'\u203A'}</div>
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  const { data: fasce } = await supabase.from('listini_clienti_fasce')
    .select('*, zone(nome)').eq('listino_id', listinoId).eq('corriere_id', sel.id).order('peso_max', { ascending: true })
  const { data: suppl } = await supabase.from('listini_clienti_supplementi')
    .select('*').eq('listino_id', listinoId).eq('corriere_id', sel.id)

  const fattore = (sel.fattore_volume != null) ? sel.fattore_volume : (listino?.fattore_volume ?? 5000)

  const zoneMap: Record<string, { nome: string, fasce: any[] }> = {}
  ;(fasce || []).forEach((f: any) => {
    const zonaNome = (f.zone as any)?.nome || 'Zona'
    if (!zoneMap[f.zona_id]) zoneMap[f.zona_id] = { nome: zonaNome, fasce: [] }
    zoneMap[f.zona_id].fasce.push(f)
  })
  const pesiUniq = Array.from(new Set((fasce || []).map((f: any) => f.peso_max))).sort((a: any, b: any) => a - b)
  const zoneEntries = Object.entries(zoneMap)

  const byTipo = (t: string) => (suppl || []).filter((s: any) => s.tipo === t)
  const fmtValori = (s: any) => {
    const d = parseJSON(s.descrizione) || {}
    const prezzo = Number(s.valore || d.prezzo_fisso || d.prezzo || 0)
    const perc = Number(d.perc || d.perc_nolo || 0)
    const out: string[] = []
    if (prezzo > 0) out.push(EUR + ' ' + prezzo.toFixed(2))
    if (perc > 0) out.push(perc + '%')
    return out.length ? out.join('  +  ') : '-'
  }
  const nomeSuppl = (s: any) => { const d = parseJSON(s.descrizione) || {}; return s.nome || d.nome || '' }

  const sezioni: { titolo: string, righe: any[], mostraNome: boolean }[] = [
    { titolo: 'Assicurazione', righe: byTipo('assicurazione'), mostraNome: false },
    { titolo: 'Contrassegno', righe: byTipo('contrassegno'), mostraNome: false },
    { titolo: 'Servizi accessori', righe: byTipo('accessorio'), mostraNome: true },
    { titolo: 'Giacenze', righe: [...byTipo('giacenza'), ...byTipo('giacenza_apertura')], mostraNome: true },
    { titolo: 'Ritiro', righe: byTipo('ritiro'), mostraNome: true },
  ]
  const logoSel = iconaCorriere(sel.nome_contratto)

  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <Link href={'/cliente/listino'} style={{fontSize:'13px',color:'#2d7fc4',textDecoration:'none'}}>{'\u2190'} Tutti i contratti</Link>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'16px',marginBottom:'20px'}}>
        {logoSel && <img src={logoSel} alt={sel.nome_contratto} style={{height:'38px',objectFit:'contain'}} />}
        <div>
          <h1 style={{fontSize:'20px',fontWeight:700,color:'#1a1a1a',margin:0}}>{sel.nome_contratto}</h1>
          <p style={{color:'#999',fontSize:'13px',marginTop:'2px'}}>Listino {listino?.nome || ''} - sola lettura</p>
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden',marginBottom:'20px'}}>
        <div style={{padding:'12px 18px',borderBottom:'1px solid #f0f0f0',display:'flex',gap:'24px'}}>
          <div>
            <span style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Fattore volumetrico</span>
            <div style={{fontSize:'13.5px',fontWeight:700,color:'#1a1a1a',marginTop:'2px'}}>{fattore}</div>
          </div>
          <div>
            <span style={{fontSize:'11px',color:'#999',textTransform:'uppercase',letterSpacing:'0.5px'}}>Zone coperte</span>
            <div style={{fontSize:'13.5px',fontWeight:700,color:'#1a1a1a',marginTop:'2px'}}>{zoneEntries.length}</div>
          </div>
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
            <thead>
              <tr style={{background:'#fafafa'}}>
                <th style={{padding:'10px 16px',textAlign:'left',fontWeight:600,color:'#666',fontSize:'11.5px',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap'}}>Peso</th>
                {zoneEntries.map(([zid, z]) => (
                  <th key={zid} style={{padding:'10px 14px',textAlign:'center',fontWeight:600,color:'#666',fontSize:'11.5px',borderBottom:'1px solid #f0f0f0',whiteSpace:'nowrap'}}>{z.nome}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pesiUniq.map((peso: any) => (
                <tr key={peso} style={{borderBottom:'1px solid #f5f5f5'}}>
                  <td style={{padding:'10px 16px',fontWeight:600,color:'#1a1a1a',whiteSpace:'nowrap'}}>
                    {(fasce || []).find((f: any) => f.peso_max === peso)?.tipo === 'oltre' ? ('Oltre, ogni ' + peso + ' kg') : ('Fino a ' + peso + ' kg')}
                  </td>
                  {zoneEntries.map(([zid, z]) => {
                    const fascia = z.fasce.find((f: any) => f.peso_max === peso)
                    return (
                      <td key={zid} style={{padding:'10px 14px',textAlign:'center'}}>
                        {fascia
                          ? <span style={{fontWeight:700,color:'#f97316',fontSize:'14px'}}>{EUR} {Number(fascia.prezzo).toFixed(2)}</span>
                          : <span style={{color:'#e8e8e8'}}>-</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {pesiUniq.length === 0 && (
                <tr><td colSpan={zoneEntries.length + 1} style={{padding:'24px',textAlign:'center',color:'#bbb'}}>Nessuna fascia di prezzo impostata</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{padding:'12px 18px',background:'#fffbeb',borderTop:'1px solid #f0f0f0',fontSize:'12px',color:'#92400e'}}>
          Il prezzo si calcola sul peso maggiore tra peso reale e peso volumetrico (L x A x P / {fattore})
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #f0f0f0',fontSize:'14px',fontWeight:700,color:'#1a1a1a'}}>Supplementi e servizi</div>
        {sezioni.every(s => s.righe.length === 0) && (
          <div style={{padding:'28px',textAlign:'center',color:'#bbb'}}>Nessun supplemento impostato</div>
        )}
        {sezioni.map(sez => sez.righe.length > 0 && (
          <div key={sez.titolo}>
            <div style={{padding:'10px 18px',fontSize:'12px',fontWeight:700,color:'#666',textTransform:'uppercase',letterSpacing:'0.4px',background:'#fafafa',borderTop:'1px solid #f0f0f0'}}>{sez.titolo}</div>
            {sez.righe.map((r: any, i: number) => (
              <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 18px',fontSize:'13px',borderTop:'1px solid #f7f7f7'}}>
                <span style={{color:'#333'}}>{sez.mostraNome ? (nomeSuppl(r) || sez.titolo) : sez.titolo}</span>
                <span style={{fontWeight:700,color:'#1a1a1a'}}>{fmtValori(r)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}