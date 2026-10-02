// LE CRONOLOGIE GLS CHE NON SONO MAI STATE SCRITTE — passata di recupero.
//
// Il ramo GLS del cron leggeva gli stati e non salvava niente in `tracking_events` (corretto il
// 02/10/2026, commit cab9bede). Le 127 attive le riempie ora il cron da se', un pezzo per giro; le
// **consegnate no**, perche' il cron esclude gli stati terminali e nessun altro pezzo le ripesca —
// lo stesso buco delle consegnate Poste ([[recupero-cronologie-consegnate]]). Questa passata serve
// a loro, una volta sola.
//
// NON interpreta: gli eventi li estrae `trackingGls` dal primo blocco <TRACKING> (quindi niente
// rientri/inoltri), la data la legge `istanteDaTesto` e la scrittura la fa `scriviCronologia`, che
// AGGIUNGE e non cancella mai.
//
// IL RESO. Gli eventi scritti non hanno la colonna `stato` (`normalizzaEventi` salva data,
// descrizione e luogo), quindi un reso nascosto in una storia GLS non si troverebbe cercando
// `stato='reso_mittente'`: qui si riconosce dalla DESCRIZIONE con `mapStatoGls`, che usa la regola
// condivisa `testoIndicaReso`. Se una GLS risulta "consegnata" e la sua storia dice che e' tornata
// al mittente, lo stato si corregge: il reso vince sulla consegna, ed e' la stessa decisione presa
// oggi per Poste. A valle i due trigger fanno il resto (accodano il reso solo se non c'e' gia' un
// movimento 'reso'; annullano il COD solo se ancora 'in_attesa'), quindi non si tocca il credito.
//
// Senza --scrivi non scrive niente e dice solo cosa farebbe.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { trackingGls, mapStatoGls } from '../lib/gls.ts'
import { normalizzaEventi, scriviCronologia } from '../lib/tracking-eventi.ts'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SCRIVI = process.argv.includes('--scrivi')
// Le annullate restano fuori: scrivere la loro storia puo' far scoprire al cron degli annulli che
// una era PARTITA, e quello muove soldi (vedi [[annulli-recupero-partite]]). Se serve, si fa a parte.
const STATI = ['consegnata', 'spedita', 'in_transito', 'in_consegna', 'non_consegnato', 'in_giacenza', 'reso_mittente', 'in_lavorazione']

const { data: corr } = await db.from('corrieri').select('id,credenziali,nome_contratto,master_id').eq('tipo', 'gls')
const credDi = new Map()
for (const c of corr || []) {
  let v = c.credenziali; if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  credDi.set(c.id, v || {})
}
let sped = []
for (let f = 0; ; f += 1000) {
  const { data, error } = await db.from('spedizioni')
    .select('id,numero,stato,created_at,raw_response,corriere_id')
    .in('corriere_id', [...credDi.keys()]).in('stato', STATI).order('id').range(f, f + 999)
  if (error) throw new Error(error.message)
  sped = sped.concat(data || []); if (!data || data.length < 1000) break
}
// Solo chi non ha NESSUN evento: chi ce l'ha lo tiene, non si riscrive sopra.
const ids = sped.map(s => s.id)
const conStoria = new Set()
for (let i = 0; i < ids.length; i += 200) {
  for (let f = 0; ; f += 1000) {
    const { data } = await db.from('tracking_events').select('spedizione_id').in('spedizione_id', ids.slice(i, i + 200)).order('id').range(f, f + 999)
    for (const e of data || []) conStoria.add(e.spedizione_id)
    if (!data || data.length < 1000) break
  }
}
const da = sped.filter(s => !conStoria.has(s.id))
console.log(`GLS dirette: ${sped.length} · senza storia: ${da.length}${SCRIVI ? '' : '  (prova a vuoto: aggiungi --scrivi)'}\n`)

let scritte = 0, eventiTot = 0, vuote = 0, salta = 0, resi = 0, errori = 0
const daCorreggere = []
const CONC = 6
for (let i = 0; i < da.length; i += CONC) {
  await Promise.all(da.slice(i, i + CONC).map(async (s) => {
    const cred = credDi.get(s.corriere_id) || {}
    const numeroNudo = s.raw_response?.numero
    if (!numeroNudo || !cred.sigla_sede) { salta++; return }
    try {
      const r = await trackingGls(cred, String(numeroNudo))
      const { eventi } = normalizzaEventi(r.eventi, { data: ['data'], descrizione: ['descrizione'], luogo: ['luogo'] })
      if (!eventi.length) { vuote++; return }
      if (SCRIVI) await scriviCronologia(db, s.id, eventi)
      scritte++; eventiTot += eventi.length
      // Il reso dalla DESCRIZIONE: gli eventi salvati non portano lo stato.
      if (eventi.some(e => mapStatoGls(e.descrizione) === 'reso_mittente')
          && !['reso_mittente', 'annullata', 'annullamento_manuale'].includes(s.stato)) {
        resi++; daCorreggere.push(s)
      }
    } catch (e) { errori++; console.log(`  ! ${s.numero}: ${e.message}`) }
  }))
  if (i && i % 120 === 0) console.log(`  ...${i}/${da.length}`)
}
console.log(`\nstorie ${SCRIVI ? 'scritte' : 'da scrivere'}: ${scritte} (${eventiTot} eventi) · GLS non le conosce: ${vuote} · senza riferimento: ${salta} · errori: ${errori}`)

if (daCorreggere.length) {
  console.log(`\n⚠ ${daCorreggere.length} dicono RESO AL MITTENTE ma in piattaforma sono altro:`)
  for (const s of daCorreggere) console.log(`   ${s.numero} ${s.stato} (part. ${String(s.created_at).slice(0, 10)})`)
  if (SCRIVI) {
    for (const s of daCorreggere) {
      const { error } = await db.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', s.id)
      console.log(`   ${error ? '! ' + error.message : '→ ' + s.numero + ' corretta'}`)
    }
    const { count } = await db.from('resi_da_addebitare').select('spedizione_id', { count: 'exact', head: true })
    console.log(`   in coda per l'addebito del reso: ${count}`)
  }
} else {
  console.log('\nnessun reso nascosto nelle storie GLS.')
}
