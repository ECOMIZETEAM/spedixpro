import { readFileSync } from 'node:fs'
for (const l of readFileSync('/Users/lorenzoantonelli/Desktop/spedixpro/.env.local','utf8').split('\n')) { if(!l.includes('=')||l.trim().startsWith('#'))continue; const i=l.indexOf('='); process.env[l.slice(0,i).trim()]=l.slice(i+1).trim().replace(/^["']|["']$/g,'') }
process.chdir('/Users/lorenzoantonelli/Desktop/spedixpro')
const { createClient } = await import('@supabase/supabase-js')
const { calcolaPrezzoCorriere } = await import('@/lib/pricing')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const MULTI='a8d42a25-3711-4343-a6df-ee2ba9bbf08b'

// contratti PROPRI di MULTIEXPRESS
const { data: propri } = await admin.from('corrieri').select('id,nome_contratto,tipo').eq('master_id',MULTI).eq('proprio',true).eq('attivo',true)
const ownByNome=new Map<string,any>()
for (const c of (propri||[]) as any[]) ownByNome.set((c.nome_contratto||'').trim().toLowerCase(), c)
console.log('contratti propri MULTIEXPRESS attivi:', propri?.length)
console.log('  ', (propri||[]).map((c:any)=>c.nome_contratto).join(' | '))

// prova significato su 3 spedizioni UPS: base(engine MULTI) vs paga vs incassa
const { data: ups } = await admin.from('corrieri').select('id').or('nome_contratto.ilike.%UPS Europa%,nome_contratto.ilike.%UPS Italia%')
const { data: sp } = await admin.from('spedizioni').select('id,corriere_id,dest_provincia,dest_cap,dest_citta,dest_paese,peso_reale,lunghezza,larghezza,altezza').in('corriere_id',(ups||[]).map((c:any)=>c.id)).gte('created_at','2026-09-10').limit(3)
for (const s of (sp||[]) as any[]){
  const { data: cr } = await admin.from('corrieri').select('nome_contratto').eq('id',s.corriere_id).single()
  const own = ownByNome.get(((cr as any).nome_contratto||'').trim().toLowerCase())
  const packages=[{weight:Number(s.peso_reale)||1,length:Number(s.lunghezza)||10,width:Number(s.larghezza)||10,height:Number(s.altezza)||10}]
  const r:any = await calcolaPrezzoCorriere(admin,{corriereId:own.id,masterId:MULTI,provincia:s.dest_provincia,cap:s.dest_cap,citta:s.dest_citta,paese:s.dest_paese,pesoReale:Number(s.peso_reale)||1,packages} as any)
  const { data: mv } = await admin.from('movimenti').select('master_id,master_target_id,cliente_id,importo').eq('spedizione_id',s.id).eq('tipo','spedizione')
  const multiRow=(mv||[]).find((m:any)=>m.master_id===MULTI&&m.master_target_id===MULTI)
  const paga=multiRow?Math.abs(Number(multiRow.importo)):null
  const altri=(mv||[]).filter((m:any)=>!(m.master_id===MULTI&&m.master_target_id===MULTI)).map((m:any)=>Math.abs(Number(m.importo)))
  const incassa=altri.length?Math.min(...altri):null
  console.log(`\n${(cr as any).nome_contratto} | ${s.dest_paese} ${s.dest_provincia} ${s.dest_cap} ${s.peso_reale}kg`)
  console.log(`  ENGINE base(MULTI)=${r?.prezzo} zona="${r?.zona}" fascia≤${r?.fascia_peso_max}kg | movimenti: paga(costo reale)=${paga} incassa(figlio)=${incassa}`)
}
