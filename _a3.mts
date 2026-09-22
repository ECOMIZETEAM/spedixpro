import { readFileSync, writeFileSync } from 'node:fs'
for (const l of readFileSync('/Users/lorenzoantonelli/Desktop/spedixpro/.env.local','utf8').split('\n')) { if(!l.includes('=')||l.trim().startsWith('#'))continue; const i=l.indexOf('='); process.env[l.slice(0,i).trim()]=l.slice(i+1).trim().replace(/^["']|["']$/g,'') }
process.chdir('/Users/lorenzoantonelli/Desktop/spedixpro')
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const MULTI='a8d42a25-3711-4343-a6df-ee2ba9bbf08b'
const DAL = process.env.DAL || '2026-08-08'

// contratti propri MULTI
const { data: propri } = await admin.from('corrieri').select('nome_contratto').eq('master_id',MULTI).eq('proprio',true)
const ownNames = new Set((propri||[]).map((c:any)=>(c.nome_contratto||'').trim().toLowerCase()))
// tutte le corrieri -> nome; ids con nome nei propri
const { data: allc } = await admin.from('corrieri').select('id,nome_contratto')
const nomeById = new Map((allc||[]).map((c:any)=>[c.id,(c.nome_contratto||'').trim()]))
const ownCorrIds = (allc||[]).filter((c:any)=>ownNames.has((c.nome_contratto||'').trim().toLowerCase())).map((c:any)=>c.id)
console.log('contratti propri MULTI:', ownNames.size, '| copie corriere totali:', ownCorrIds.length)

// spedizioni
let speds:any[]=[]
for (let i=0;i<ownCorrIds.length;i+=200){ const chunk=ownCorrIds.slice(i,i+200); let from=0; while(true){ const { data } = await admin.from('spedizioni').select('id,corriere_id,dest_paese,dest_provincia,dest_cap,peso_reale,stato').in('corriere_id',chunk).gte('created_at',DAL+' 00:00:00+02').not('stato','in','(annullata,annullamento_pending,annullamento_manuale)').range(from,from+999); if(!data||!data.length)break; speds=speds.concat(data); if(data.length<1000)break; from+=1000 } }
console.log('spedizioni sui contratti propri dal',DAL,':',speds.length)
const spById=new Map(speds.map(s=>[s.id,s]))

// movimenti
const ids=speds.map(s=>s.id); let movs:any[]=[]
for (let i=0;i<ids.length;i+=300){ const chunk=ids.slice(i,i+300); let from=0; while(true){ const { data } = await admin.from('movimenti').select('spedizione_id,master_id,master_target_id,cliente_id,importo').eq('tipo','spedizione').in('spedizione_id',chunk).range(from,from+999); if(!data||!data.length)break; movs=movs.concat(data); if(data.length<1000)break; from+=1000 } }
const byS=new Map<string,any[]>(); for(const m of movs){ const a=byS.get(m.spedizione_id)||[]; a.push(m); byS.set(m.spedizione_id,a) }

function band(kg:number){ if(kg<=1)return'0-1'; if(kg<=3)return'1-3'; if(kg<=5)return'3-5'; if(kg<=10)return'5-10'; if(kg<=20)return'10-20'; if(kg<=30)return'20-30'; return'30+' }

type G={n:number,nLoss:number,loss:number,costs:number[],sales:number[]}
const groups=new Map<string,G>()
const perContr=new Map<string,{n:number,nLoss:number,loss:number,gain:number}>()
let tot=0,totLoss=0,totGain=0
for (const [sid,mv] of byS){
  const s=spById.get(sid); if(!s)continue
  const multiRow=mv.find((m:any)=>m.master_id===MULTI&&m.master_target_id===MULTI)
  if(!multiRow)continue
  const cost=Math.abs(Number(multiRow.importo))
  const altri=mv.filter((m:any)=>!(m.master_id===MULTI&&m.master_target_id===MULTI)).map((m:any)=>Math.abs(Number(m.importo)))
  if(!altri.length)continue
  const sale=Math.min(...altri); const marg=sale-cost
  const contr=nomeById.get(s.corriere_id)||'?'
  const pc=perContr.get(contr)||{n:0,nLoss:0,loss:0,gain:0}; pc.n++; if(marg<-0.001){pc.nLoss++;pc.loss+=marg}else pc.gain+=Math.max(0,marg); perContr.set(contr,pc)
  tot++; if(marg<-0.001){totLoss+=marg}else totGain+=marg
  if(marg>=-0.001)continue
  const dest=((s.dest_paese||'IT')==='IT')?('IT-'+(s.dest_provincia||'?')):(s.dest_paese)
  const key=contr+' ‖ '+dest+' ‖ '+band(Number(s.peso_reale)||0)
  const g=groups.get(key)||{n:0,nLoss:0,loss:0,costs:[],sales:[]}; g.n++; g.nLoss++; g.loss+=marg; g.costs.push(cost); g.sales.push(sale); groups.set(key,g)
}
const med=(a:number[])=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]}
console.log(`\n=== MARGINE MULTIEXPRESS sui contratti PROPRI (dal ${DAL}) ===`)
console.log(`spedizioni analizzate: ${tot} | perdita tot € ${totLoss.toFixed(2)} | guadagno tot € ${totGain.toFixed(2)} | NETTO € ${(totGain+totLoss).toFixed(2)}`)
console.log('\n── per contratto (solo con perdite) ──')
for (const [c,v] of [...perContr.entries()].filter(([_,v])=>v.loss<-0.001).sort((a,b)=>a[1].loss-b[1].loss)) console.log(`  ${c.padEnd(32)} perdite ${String(v.nLoss).padStart(4)} = € ${v.loss.toFixed(2).padStart(9)} | netto contratto € ${(v.gain+v.loss).toFixed(2)}`)

const rows=[...groups.entries()].map(([k,g])=>{const[contr,dest,b]=k.split(' ‖ ');const cmax=Math.max(...g.costs);const smed=med(g.sales);return{contr,dest,band:b,nLoss:g.nLoss,loss:Math.round(g.loss*100)/100,saleMed:Math.round(smed*100)/100,costMax:Math.round(cmax*100)/100,pareggio:Math.round(cmax*100)/100,aumento:Math.round((cmax-smed)*100)/100}}).sort((a,b)=>a.loss-b.loss)
console.log('\n── TOP 30 combinazioni (contratto ‖ destinazione ‖ fascia) da riprezzare ──')
console.log('  contratto | dest | fascia | n | perdita€ | vendita_med | costo_MAX | →pareggio | +aum')
for (const r of rows.slice(0,30)) console.log(`  ${r.contr} ‖ ${r.dest} ‖ ${r.band}kg | ${r.nLoss} | ${r.loss} | ${r.saleMed} | ${r.costMax} | ${r.pareggio} | +${r.aumento}`)
writeFileSync('/private/tmp/claude-501/-Users-lorenzoantonelli-Desktop-spedixpro/f239b072-fba8-4e5e-805b-0c200f081543/scratchpad/multi-sottocosto.json', JSON.stringify({perContr:[...perContr.entries()],rows},null,0))
console.log('\ncombinazioni in perdita totali:', rows.length, '| salvato multi-sottocosto.json')
