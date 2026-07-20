const fs=require('fs')
for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}
const {createClient}=require('@supabase/supabase-js')
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)
async function all(tbl,cols,filt){let out=[],from=0;for(;;){let q=s.from(tbl).select(cols).range(from,from+999);if(filt)q=filt(q);const {data,error}=await q;if(error){console.log('ERR',tbl,error.message);break}out=out.concat(data||[]);if(!data||data.length<1000)break;from+=1000}return out}
;(async()=>{
  // distribuzione tipi
  const tipiRows=await all('movimenti','tipo')
  const c={}; for(const t of tipiRows)c[t.tipo]=(c[t.tipo]||0)+1
  console.log('Tipi movimenti (tutti):',JSON.stringify(c,null,0))
  const masters=await all('masters','id,parent_master_id,nome')
  const parent=Object.fromEntries(masters.map(m=>[m.id,m.parent_master_id]))
  const nome=Object.fromEntries(masters.map(m=>[m.id,m.nome]))
  function auditTipo(mv,label,speds){
    const perSped={}; for(const m of mv){if(!m.spedizione_id||!m.master_target_id)continue;(perSped[m.spedizione_id]=perSped[m.spedizione_id]||new Set()).add(m.master_target_id)}
    let ok=0,gap=0,startMiss=0; const ex=[]
    for(const sp of speds){ const M=perSped[sp.id]; if(!M)continue; if(!M.has(sp.master_id)){startMiss++;continue}
      let cur=sp.master_id,rem=new Set(M); while(cur&&rem.has(cur)){rem.delete(cur);cur=parent[cur]}
      if(rem.size>0){gap++;if(ex.length<5)ex.push(sp.id.slice(0,8)+' resto:'+[...rem].map(x=>nome[x]||x.slice(0,6)))}else ok++ }
    console.log(`\n=== ${label} === coperte:${ok+gap+startMiss} | OK:${ok} | buco:${gap} | start-miss:${startMiss}`)
    if(ex.length)console.log('   buchi:',ex.join(' | '))
  }
  // RESI
  const speds=await all('spedizioni','id,master_id,stato',()=>s.from('spedizioni').select('id,master_id,stato'))
  const mvReso=await all('movimenti','spedizione_id,master_target_id',q=>q.eq('tipo','reso').not('master_target_id','is',null))
  auditTipo(mvReso,'RESI (cascata)',speds)
  // STORNI su annullate: ogni annullata con movimenti 'spedizione' deve avere reversal
  const annull=await all('spedizioni','id,master_id',q=>q.eq('stato','annullata'))
  console.log('\nAnnullate:',annull.length)
  const annSet=new Set(annull.map(a=>a.id))
  const mvSpAnn=await all('movimenti','spedizione_id,master_target_id,tipo,importo',q=>q.in('tipo',['spedizione','storno','rimborso','storno_spedizione']).not('spedizione_id','is',null))
  // somma per (sped,master): se ~0 → stornata correttamente
  const bal={}; for(const m of mvSpAnn){if(!annSet.has(m.spedizione_id)||!m.master_target_id)continue;const k=m.spedizione_id+'|'+m.master_target_id;bal[k]=(bal[k]||0)+Number(m.importo||0)}
  let saldati=0,nonSaldati=0; const exNS=[]
  const perSpAnn={}; for(const k of Object.keys(bal)){const[sp,mt]=k.split('|');(perSpAnn[sp]=perSpAnn[sp]||[]).push({mt,b:bal[k]})}
  for(const sp of Object.keys(perSpAnn)){ const livelli=perSpAnn[sp]; const aperti=livelli.filter(x=>Math.abs(x.b)>0.005); if(aperti.length){nonSaldati++;if(exNS.length<6)exNS.push(sp.slice(0,8)+' aperti:'+aperti.map(x=>(nome[x.mt]||x.mt.slice(0,6))+'=€'+x.b.toFixed(2)).join(','))}else saldati++ }
  console.log('Annullate con movimenti: saldate(storno completo):',saldati,'| NON saldate(residuo per master):',nonSaldati)
  if(exNS.length)console.log('   residui:',exNS.join(' | '))
})().catch(e=>console.log('ERR',e.message))
