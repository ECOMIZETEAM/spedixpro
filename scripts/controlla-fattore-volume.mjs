// CONTROLLO DEL FATTORE PESO/VOLUME SU TUTTA LA RETE.
//
// La regola: chi POSSIEDE il contratto decide il fattore, e sopra di lui non c'e' nessuno da cui
// ereditarlo — se carica 4000, e' 4000. Chi invece riceve il contratto propagato deve vedere e
// usare quello che gli e' stato assegnato. Se poi lui lo rivende ai suoi clienti con un fattore
// diverso e' una sua scelta commerciale, e non riguarda questo controllo.
//
// Lo script e' di sola LETTURA: elenca le differenze, non tocca niente.
//   node scripts/controlla-fattore-volume.mjs
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
  .filter(r => r.includes('=') && !r.trim().startsWith('#'))
  .map(r => [r.slice(0, r.indexOf('=')).trim(), r.slice(r.indexOf('=') + 1).trim()]))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function tutte(tabella, campi) {
  const out = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await db.from(tabella).select(campi).range(da, da + 999)
    if (error) throw new Error(`${tabella}: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

const masters = await tutte('masters', 'id,nome,parent_master_id,parent_listino_id')
const corrieri = await tutte('corrieri', 'id,nome_contratto,master_id,attivo')
const lCorr = await tutte('listini_corrieri', 'id,master_id,corriere_id,fattore_volume')
const lCorrCorr = await tutte('listini_corrieri_corrieri', 'listino_id,corriere_id,fattore_volume')
const lCli = await tutte('listini_clienti', 'id,master_id,nome,fattore_volume')
const lCliCorr = await tutte('listini_clienti_corrieri', 'listino_id,corriere_id,fattore_volume')

const master = Object.fromEntries(masters.map(m => [m.id, m]))
const listinoCli = Object.fromEntries(lCli.map(l => [l.id, l]))
const num = v => { const n = parseFloat(v); return n > 0 ? n : null }

// Quello che UN master ha impostato di suo per un contratto (override, poi default del listino legato).
function suo(masterId, corriereId) {
  const miei = lCorr.filter(l => l.master_id === masterId)
  if (!miei.length) return null
  const ids = new Set(miei.map(l => l.id))
  const righe = lCorrCorr.filter(r => ids.has(r.listino_id) && r.corriere_id === corriereId && num(r.fattore_volume))
    .sort((a, b) => String(a.listino_id).localeCompare(String(b.listino_id)))
  const legato = miei.find(l => l.corriere_id === corriereId)
  const scelta = righe.find(r => r.listino_id === legato?.id) || righe[0]
  return num(scelta?.fattore_volume) || num(legato?.fattore_volume) || null
}

// Quello che il master USA: il suo, altrimenti ereditato salendo la catena (come fa il codice).
function usato(masterId, corriereId) {
  let cur = masterId
  for (let i = 0; i < 20 && cur; i++) {
    const f = suo(cur, corriereId)
    if (f) return { valore: f, da: cur }
    cur = master[cur]?.parent_master_id || null
  }
  return { valore: 5000, da: null }
}

// Quello che il PADRE gli ha assegnato: sul listino cliente che gli ha dato, per lo STESSO
// contratto (i contratti si riconoscono dal nome: ogni master ha la sua copia).
function assegnato(m, nomeContratto) {
  const L = m.parent_listino_id ? listinoCli[m.parent_listino_id] : null
  if (!L) return null
  const copiaPadre = corrieri.find(c => c.master_id === L.master_id && c.nome_contratto === nomeContratto)
  if (copiaPadre) {
    const ov = lCliCorr.find(r => r.listino_id === L.id && r.corriere_id === copiaPadre.id && num(r.fattore_volume))
    if (ov) return { valore: num(ov.fattore_volume), dove: `override su "${L.nome}"` }
  }
  const def = num(L.fattore_volume)
  return def ? { valore: def, dove: `default del listino "${L.nome}"` } : null
}

// UN CONTRATTO E' DI CHI STA PIU' IN ALTO AD AVERLO.
// Sopra il proprietario non c'e' un fornitore che detta le condizioni: se lui carica 4000, e' 4000,
// e non c'e' niente da confrontare. Il controllo ha senso solo per le COPIE propagate piu' sotto.
function eProprietario(m, nomeContratto) {
  let cur = m.parent_master_id
  for (let i = 0; i < 20 && cur; i++) {
    if (corrieri.some(c => c.master_id === cur && c.nome_contratto === nomeContratto)) return false
    cur = master[cur]?.parent_master_id || null
  }
  return true
}

console.log('\n═══ FATTORE PESO/VOLUME — solo le COPIE propagate: assegnato dal padre vs usato ═══\n')
let diff = 0, ok = 0, senzaAssegnato = 0, propri = 0
for (const c of corrieri.filter(x => x.attivo !== false)) {
  const m = master[c.master_id]
  if (!m || !m.parent_master_id) continue          // il master principale non eredita da nessuno
  if (eProprietario(m, c.nome_contratto)) { propri++; continue }   // contratto suo: decide lui
  const a = assegnato(m, c.nome_contratto)
  const u = usato(c.master_id, c.id)
  if (!a) { senzaAssegnato++; continue }
  if (Math.abs(a.valore - u.valore) < 0.01) { ok++; continue }
  diff++
  const daChi = u.da === c.master_id ? 'impostato da lui' : u.da ? `ereditato da ${master[u.da]?.nome}` : 'ripiego 5000'
  console.log(`❌ ${m.nome} — ${c.nome_contratto}`)
  console.log(`     assegnato dal padre: ${a.valore}  (${a.dove})`)
  console.log(`     usato davvero      : ${u.valore}  (${daChi})\n`)
}
console.log(`── copie propagate allineate: ${ok} · differenti: ${diff} · senza listino assegnato: ${senzaAssegnato}`)
console.log(`   (esclusi ${propri} contratti PROPRI, dove il fattore lo decide chi possiede il contratto)\n`)
