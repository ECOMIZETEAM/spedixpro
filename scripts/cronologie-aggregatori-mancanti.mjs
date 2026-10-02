// LE CRONOLOGIE CHE GLI AGGREGATORI CI DANNO GIA' E NOI NON CHIEDIAMO PIU'.
//
// Il cron del tracking esclude gli stati terminali: una spedizione che diventa "consegnata" prima
// che la sua storia sia stata scritta non viene piu' guardata da nessuno. Per i contratti Poste/SDA
// c'e' il recupero via OneTracking dal Mac ([[recupero-cronologie-consegnate]]), ma per BRT e UPS
// venduti dagli aggregatori non c'era niente: al 02/10/2026, 9.676 BRT Express via SpediamoPro
// senza un solo evento, su 433 attive. Gli eventi, invece, l'aggregatore li ha: 6-9 per spedizione,
// con data, filiale e descrizione, dalla stessa API che paghiamo gia'.
//
// Quindi qui non si compra niente da fuori: si richiede quello che e' nostro e si scrive con le
// regole condivise (`normalizzaEventi` + `scriviCronologia`, che AGGIUNGE e non cancella mai).
//
// IL RESO. Una storia vecchia puo' contenere un ritorno al mittente su una spedizione segnata
// "consegnata" — e' il guasto trovato il 02/10 sulle consegnate Poste. Qui NON si tocca lo stato:
// si CONTA, si stampa l'elenco e si decide con i numeri davanti, perche' applicarlo fa partire
// l'addebito del reso a tutta la catena. Per SpediamoPro il reso si riconosce con
// `spediamoproEventiIndicanoReso` (il suo stato numerico non distingue il ritorno dalla consegna).
//
//   npx tsx scripts/cronologie-aggregatori-mancanti.mjs [--scrivi] [--max=N] [--tipo=spediamopro|easyparcel]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { spediamoproGetTracking, spediamoproEventiIndicanoReso } from '../lib/spediamopro.ts'
import { easyparcelTracking, eventiEasyparcel } from '../lib/easyparcel.ts'
import { normalizzaEventi, scriviCronologia } from '../lib/tracking-eventi.ts'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SCRIVI = process.argv.includes('--scrivi')
const MAX = Number((process.argv.find(a => a.startsWith('--max=')) || '').split('=')[1] || 400)
const TIPO = (process.argv.find(a => a.startsWith('--tipo=')) || '--tipo=spediamopro').split('=')[1]
const CONC = 5          // gentili col fornitore: cinque letture alla volta, non di piu'

const { data: corr } = await db.from('corrieri').select('id,credenziali,nome_contratto,master_id').eq('tipo', TIPO)
const credDi = new Map()
for (const c of corr || []) {
  let v = c.credenziali; if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  credDi.set(c.id, { cred: v || {}, nome: c.nome_contratto })
}
// Le piu' VECCHIE prima: sono quelle che nessuno guardera' mai piu'.
let sped = []
for (let f = 0; ; f += 1000) {
  const { data, error } = await db.from('spedizioni')
    .select('id,numero,stato,created_at,corriere_id,raw_response')
    .in('corriere_id', [...credDi.keys()]).eq('stato', 'consegnata')
    .order('created_at', { ascending: true }).range(f, f + 999)
  if (error) throw new Error(error.message)
  sped = sped.concat(data || []); if (!data || data.length < 1000 || sped.length > 40000) break
}
const ids = sped.map(s => s.id)
const conStoria = new Set()
for (let i = 0; i < ids.length; i += 200) {
  for (let f = 0; ; f += 1000) {
    const { data } = await db.from('tracking_events').select('spedizione_id').in('spedizione_id', ids.slice(i, i + 200)).order('id').range(f, f + 999)
    for (const e of data || []) conStoria.add(e.spedizione_id)
    if (!data || data.length < 1000) break
  }
}
const tutte = sped.filter(s => !conStoria.has(s.id))
const da = tutte.slice(0, MAX)
console.log(`${TIPO}: consegnate senza storia ${tutte.length} · ne lavoro ${da.length}${SCRIVI ? '' : '  (prova a vuoto)'}\n`)

let fatte = 0, eventiTot = 0, vuote = 0, salta = 0, errori = 0
const resi = []
for (let i = 0; i < da.length; i += CONC) {
  await Promise.all(da.slice(i, i + CONC).map(async (s) => {
    const { cred, nome } = credDi.get(s.corriere_id) || {}
    try {
      let eventi = [], grezzi = []
      if (TIPO === 'spediamopro') {
        const idSp = s.raw_response?.id ?? s.raw_response?.raw?.data?.id
        if (!idSp || !cred?.authcode) { salta++; return }
        const tr = await spediamoproGetTracking(cred.authcode, Number(idSp))
        grezzi = tr.events || []
        eventi = normalizzaEventi(grezzi, { data: ['at', 'date', 'data'], descrizione: ['description', 'title'], luogo: ['location', 'office'] }).eventi
        if (spediamoproEventiIndicanoReso(grezzi)) resi.push({ ...s, nome })
      } else {
        const offerta = s.raw_response?._codiceOfferta
        if (!offerta || !cred?.apikey) { salta++; return }
        const { raw } = await easyparcelTracking(cred.apikey, { codiceOfferta: String(offerta) })
        eventi = eventiEasyparcel(raw).eventi
      }
      if (!eventi.length) { vuote++; return }
      if (SCRIVI) await scriviCronologia(db, s.id, eventi)
      fatte++; eventiTot += eventi.length
    } catch (e) { errori++; if (errori <= 3) console.log(`  ! ${s.numero}: ${String(e.message).slice(0, 90)}`) }
  }))
  if (i && i % 100 === 0) console.log(`  ...${i}/${da.length}`)
}
console.log(`\nstorie ${SCRIVI ? 'scritte' : 'pronte'}: ${fatte} (${eventiTot} eventi) · senza eventi dal fornitore: ${vuote} · senza riferimento: ${salta} · errori: ${errori}`)
console.log(`restano da fare dopo questo giro: ${Math.max(0, tutte.length - da.length)}`)
if (resi.length) {
  console.log(`\n⚠ ${resi.length} segnate CONSEGNATA ma la storia dice RESO AL MITTENTE (stato NON toccato, decide Lorenzo):`)
  for (const r of resi.slice(0, 40)) console.log(`   ${r.numero} ${r.nome} part. ${String(r.created_at).slice(0, 10)}`)
} else {
  console.log('\nnessun reso nascosto in questo giro.')
}
