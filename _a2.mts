import { readFileSync } from 'node:fs'
for (const l of readFileSync('/Users/lorenzoantonelli/Desktop/spedixpro/.env.local','utf8').split('\n')) { if(!l.includes('=')||l.trim().startsWith('#'))continue; const i=l.indexOf('='); process.env[l.slice(0,i).trim()]=l.slice(i+1).trim().replace(/^["']|["']$/g,'') }
process.chdir('/Users/lorenzoantonelli/Desktop/spedixpro')
const { createClient } = await import('@supabase/supabase-js')
const { calcolaPrezzoCorriere } = await import('@/lib/pricing')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: ups } = await admin.from('corrieri').select('id').or('nome_contratto.ilike.%UPS Europa%,nome_contratto.ilike.%UPS Italia%')
// 2 IT + 2 estero
const { data: sp } = await admin.from('spedizioni').select('id,corriere_id,master_id,dest_provincia,dest_cap,dest_citta,dest_paese,peso_reale,lunghezza,larghezza,altezza').in('corriere_id',(ups||[]).map((c:any)=>c.id)).gte('created_at','2026-09-10').limit(60)
const it=(sp||[]).filter((s:any)=>(s.dest_paese||'IT')==='IT').slice(0,2)
const est=(sp||[]).filter((s:any)=>(s.dest_paese||'IT')!=='IT').slice(0,2)
for (const s of [...it,...est] as any[]){
  const packages=[{weight:Number(s.peso_reale)||1,length:Number(s.lunghezza)||10,width:Number(s.larghezza)||10,height:Number(s.altezza)||10}]
  const r:any = await calcolaPrezzoCorriere(admin,{corriereId:s.corriere_id,masterId:s.master_id,provincia:s.dest_provincia,cap:s.dest_cap,citta:s.dest_citta,paese:s.dest_paese,pesoReale:Number(s.peso_reale)||1,packages} as any)
  console.log(`${s.dest_paese} ${s.dest_provincia} ${s.dest_cap} ${s.peso_reale}kg → prezzo=${r?.prezzo} zona="${r?.zona}" fascia≤${r?.fascia_peso_max}`)
}
