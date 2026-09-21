// AGGIORNA L'ARCHIVIO DELLE LOCALITA' (comuni.json + frazioni.json) DA GEONAMES.
//
// PERCHE' ESISTE. Un cliente non trovava "Villa Sant'Antonio" (Ascoli Piceno) nella tendina dei
// CAP. GeoNames quella localita' ce l'ha (63082, AP); era il NOSTRO archivio ad averla persa,
// perche' frazioni.json era stato costruito escludendo le voci "gia' presenti come comuni"
// confrontando SOLO IL NOME: qualunque frazione omonima di un comune altrove in Italia e' stata
// buttata via. "Villa Sant'Antonio" e' un comune in provincia di Oristano, quindi la frazione di
// Ascoli e' sparita. Misurato il 21/09/2026: 405 localita' perse cosi'.
//
// LA REGOLA DI SICUREZZA, ed e' il motivo per cui questo script non aggiunge tutto quello che
// trova: si aggiunge una localita' SOLO SE IL SUO CAP E' GIA' NOTO all'archivio per quella
// provincia. Cosi' si rendono trovabili dei NOMI senza far entrare nel sistema nessun CAP nuovo —
// e quindi senza toccare il prezzo di niente. I CAP nuovi sono un'altra storia: le zone dei listini
// li conoscono uno per uno, e un CAP che le zone non hanno viene prezzato come "Italia" (cioe'
// sottocosto su isole e zone disagiate). Quelli vanno guardati a mano, contratto per contratto.
//
//   node scripts/aggiorna-archivio-cap.mjs           -> solo referto, non scrive
//   node scripts/aggiorna-archivio-cap.mjs --scrivi  -> applica le aggiunte sicure
//
// E' idempotente: rilanciarlo non duplica niente.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'

const SCRIVI = process.argv.includes('--scrivi')
const TMP = '/tmp/archivio-cap'
const IT = `${TMP}/IT.txt`

function scaricaGeonames() {
  if (existsSync(IT)) return
  mkdirSync(TMP, { recursive: true })
  console.log('Scarico l\'archivio GeoNames…')
  execSync(`curl -sS -o ${TMP}/IT.zip https://download.geonames.org/export/zip/IT.zip && unzip -oq ${TMP}/IT.zip -d ${TMP}`)
}

// Stesso confronto dell'autocomplete (app/api/comuni/route.ts): senza accenti, apostrofi, spazi.
// Devono restare uguali, altrimenti lo script crede che manchi qualcosa che invece si trova gia'.
const norm = (s) => s.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’ʼ`´']/g, '')
  .replace(/\s+/g, '')

scaricaGeonames()

const comuni = JSON.parse(readFileSync('lib/data/comuni.json', 'utf8'))
const frazioni = JSON.parse(readFileSync('lib/data/frazioni.json', 'utf8'))

const geo = []
for (const riga of readFileSync(IT, 'utf8').split('\n')) {
  const p = riga.split('\t')
  if (p.length < 8 || !/^\d{5}$/.test(p[1])) continue
  geo.push({ nome: p[2], sigla: p[6], provincia: p[5], cap: p[1] })
}

// Cosa e' gia' raggiungibile oggi, e quali CAP l'archivio conosce per ogni provincia.
const raggiungibili = new Set()
const capNotiPerProvincia = new Map()
const annota = (sigla, cap) => {
  if (!capNotiPerProvincia.has(sigla)) capNotiPerProvincia.set(sigla, new Set())
  capNotiPerProvincia.get(sigla).add(cap)
}
for (const c of comuni) for (const cap of c.cap) { raggiungibili.add(`${norm(c.nome)}|${c.sigla}|${cap}`); annota(c.sigla, cap) }
for (const f of frazioni) { raggiungibili.add(`${norm(f.nome)}|${f.sigla}|${f.cap}`); annota(f.sigla, f.cap) }

const comuniPerNomeProvincia = new Set(comuni.map((c) => `${norm(c.nome)}|${c.sigla}`))

const mancanti = geo.filter((g) => !raggiungibili.has(`${norm(g.nome)}|${g.sigla}|${g.cap}`))
const sonoComuni = mancanti.filter((g) => comuniPerNomeProvincia.has(`${norm(g.nome)}|${g.sigla}`))
const sonoLocalita = mancanti.filter((g) => !comuniPerNomeProvincia.has(`${norm(g.nome)}|${g.sigla}`))

const capNoto = (g) => capNotiPerProvincia.get(g.sigla)?.has(g.cap)
const daAggiungere = sonoLocalita.filter(capNoto)
const conCapNuovo = sonoLocalita.filter((g) => !capNoto(g))

console.log(`\nGeoNames: ${geo.length} voci | archivio: ${comuni.length} comuni + ${frazioni.length} localita'`)
console.log(`Non raggiungibili dall'autocomplete: ${mancanti.length}`)
console.log(`  DA AGGIUNGERE (localita' il cui CAP l'archivio gia' conosce): ${daAggiungere.length}`)
console.log(`  da guardare a mano — localita' con un CAP NUOVO:              ${conCapNuovo.length}`)
console.log(`  da guardare a mano — CAP mancanti su comuni gia' presenti:    ${sonoComuni.length}`)

if (conCapNuovo.length) {
  console.log('\n  CAP nuovi (spesso province cambiate: Sud Sardegna, ecc.) — NON aggiunti:')
  for (const g of conCapNuovo.slice(0, 20)) console.log(`     ${g.nome} (${g.sigla}) ${g.cap}`)
}

if (!SCRIVI) {
  console.log('\nReferto soltanto. Per applicare le aggiunte sicure: node scripts/aggiorna-archivio-cap.mjs --scrivi')
  process.exit(0)
}

if (!daAggiungere.length) { console.log('\nNiente da aggiungere: archivio gia' + "' allineato."); process.exit(0) }

// Si inserisce mantenendo l'ordine alfabetico del file (diff piccolo e leggibile).
const nuovo = frazioni.concat(daAggiungere.map((g) => ({
  nome: g.nome, sigla: g.sigla, provincia: g.provincia, cap: g.cap,
})))
nuovo.sort((a, b) => a.nome.localeCompare(b.nome, 'it') || a.sigla.localeCompare(b.sigla) || a.cap.localeCompare(b.cap))
writeFileSync('lib/data/frazioni.json', JSON.stringify(nuovo))
console.log(`\nScritte ${daAggiungere.length} localita'. frazioni.json: ${frazioni.length} -> ${nuovo.length}`)
