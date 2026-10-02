// I RESI NASCOSTI DENTRO LE STORIE RECUPERATE — passata una volta sola.
//
// Il recupero delle cronologie (cronologie.mjs → /api/tracking/cieche-ingest con soloCronologia)
// scriveva la storia senza toccare lo stato: dentro quelle storie c'erano resi al mittente su
// spedizioni rimaste "consegnata". Il cliente leggeva che il pacco era arrivato, e il reso non lo
// pagava nessuno. Dal 02/10/2026 cieche-ingest applica il reso anche in soloCronologia; questo
// script sistema le 35 rimaste indietro prima di quella correzione.
//
// NON decide niente da se': lo stato lo calcola `statoDaLetturaPoste`, la stessa funzione che usano
// tutte le porte, su TUTTA la cronologia che abbiamo in casa. Qui si trasporta, non si interpreta.
//
// Cosa succede dopo, e lo fa il database (verificato prima di lanciare):
//  * trg_reso_da_addebitare accoda il reso, ma solo se non esiste gia' un movimento tipo 'reso':
//    chi ha gia' pagato non paga due volte. Poi lo addebita /api/cron/addebiti-code.
//  * trg_contrassegno_chiudi_su_reso annulla il contrassegno SOLO se e' ancora 'in_attesa' e non
//    sta su una distinta: i due segnati 'pagato' non li tocca, e il credito non si muove.
// Nessuna notifica al cliente: si corregge un archivio di luglio/agosto, non si annuncia una novita'.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { statoDaLetturaPoste } from '../lib/tracking-poste.ts'

for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SCRIVI = process.argv.includes('--scrivi')

// Chi ha un evento di reso in cronologia. Paginato: senza .range() PostgREST si ferma a 1000.
const ids = new Set()
for (let f = 0; ; f += 1000) {
  const { data, error } = await db.from('tracking_events').select('spedizione_id').eq('stato', 'reso_mittente').order('id').range(f, f + 999)
  if (error) throw new Error(error.message)
  for (const e of data || []) ids.add(e.spedizione_id)
  if (!data || data.length < 1000) break
}
let sped = []
const arr = [...ids]
for (let i = 0; i < arr.length; i += 300) {
  const { data } = await db.from('spedizioni').select('id,numero,stato,created_at,contrassegno,stato_contrassegno').in('id', arr.slice(i, i + 300))
  sped = sped.concat(data || [])
}
const da = sped.filter(s => !['reso_mittente', 'annullata', 'annullamento_manuale'].includes(s.stato))
console.log(`cronologie con un reso: ${arr.length} spedizioni · da riallineare: ${da.length}${SCRIVI ? '' : '  (prova a vuoto: aggiungi --scrivi)'}\n`)

let cambiate = 0, confermate = 0
for (const s of da.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
  const eventi = []
  for (let f = 0; ; f += 1000) {
    const { data } = await db.from('tracking_events').select('stato').eq('spedizione_id', s.id).order('id').range(f, f + 999)
    eventi.push(...(data || [])); if (!data || data.length < 1000) break
  }
  const nuovo = statoDaLetturaPoste(eventi, s.stato)
  if (nuovo !== 'reso_mittente') { confermate++; console.log(`  = ${s.numero} resta ${s.stato} (la funzione dice ${nuovo || 'niente'})`); continue }
  if (SCRIVI) {
    const { error } = await db.from('spedizioni').update({ stato: 'reso_mittente' }).eq('id', s.id)
    if (error) { console.log(`  ! ${s.numero} ${error.message}`); continue }
  }
  cambiate++
  const cod = Number(s.contrassegno) > 0 ? ` · COD ${Number(s.contrassegno).toFixed(2)} ${s.stato_contrassegno}` : ''
  console.log(`  → ${s.numero} ${s.stato} → reso_mittente (part. ${String(s.created_at).slice(0, 10)})${cod}`)
}
console.log(`\n${SCRIVI ? 'riallineate' : 'da riallineare'}: ${cambiate} · lasciate come stanno: ${confermate}`)
if (SCRIVI) {
  const { count } = await db.from('resi_da_addebitare').select('spedizione_id', { count: 'exact', head: true })
  console.log(`in coda per l'addebito del reso adesso: ${count} (li lavora /api/cron/addebiti-code)`)
}
