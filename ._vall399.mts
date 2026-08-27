import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
Object.assign(process.env, env)
const { createAdminSupabase } = await import('./lib/supabase-admin')
const { calcolaRipesature } = await import('./lib/ripesature-calcolo')
const admin = createAdminSupabase()
let rows:any[]=[]
for(let off=0;;off+=1000){
  const {data}=await admin.from('rettifiche')
    .select('id,numero_spedizione,cliente_id,colli_ripesati,differenza,fuori_sagoma, clienti(ragione_sociale)')
    .eq('confermata',false).is('target_master_id',null).not('cliente_id','is',null).order('id').range(off,off+999)
  if(!data||!data.length)break; rows.push(...data); if(data.length<1000)break
}
console.log('TOTALE 399 verso cliente:', rows.length)
let ok=0,mism=0,nocolli=0; const diffs:string[]=[]
let done=0
for(const r of rows){
  const colli=(r.colli_ripesati||[]).map((c:any)=>({peso:Number(c.weight)||0,lunghezza:Number(c.length)||0,larghezza:Number(c.width)||0,altezza:Number(c.height)||0}))
  const stored=(Number(r.differenza)<0?-Number(r.differenza):0)+(Number(r.fuori_sagoma)||0)
  if(!colli.length){nocolli++;continue}
  const [e]=await calcolaRipesature(admin,[{idOrdine:r.id,idVerifiche:[],ldv:r.numero_spedizione,addebitoFornitore:0,colli,dataChiusura:'',mittente:'',destinatario:''} as any])
  const liv=e?.livelli?.find((l:any)=>l.clienteId===r.cliente_id)||e?.livelli?.find((l:any)=>l.clienteId)
  const nuovo=((liv&&liv.differenza!=null&&liv.differenza>=0.01)?liv.differenza:0)+(Number(r.fuori_sagoma)||0)
  if(Math.abs(stored-nuovo)>0.05){mism++; diffs.push(`${r.numero_spedizione} ${(r.clienti?.ragione_sociale||'').slice(0,20)} stored ${stored.toFixed(2)} -> nuovo ${nuovo.toFixed(2)}`)} else ok++
  if(++done%50===0)console.log(`...${done}/${rows.length} (diversi ${mism})`)
}
console.log(`\n=== VERIFICA 399 ===`)
console.log(`UGUALI ${ok}  DIVERSI ${mism}  senza-colli ${nocolli}`)
if(diffs.length){console.log('\n--- DIVERSE (da ricalcolare prima di confermare) ---'); diffs.slice(0,60).forEach(d=>console.log('  '+d))}
