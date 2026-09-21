// AGGIORNA L'ARCHIVIO DELLE LOCALITA' (comuni.json + frazioni.json) DA GEONAMES.
//
// PERCHE' ESISTE. Un cliente non trovava "Villa Sant'Antonio" (Ascoli Piceno) nella tendina dei
// CAP. GeoNames quella localita' ce l'ha (63082, AP); era il NOSTRO archivio ad averla persa,
// perche' frazioni.json era stato costruito escludendo le voci "gia' presenti come comuni"
// confrontando SOLO IL NOME: qualunque frazione omonima di un comune altrove in Italia e' stata
// buttata via. "Villa Sant'Antonio" e' un comune in provincia di Oristano, quindi la frazione di
// Ascoli e' sparita. Misurato il 21/09/2026: 405 localita' perse cosi'.
//
// DUE COSE DIVERSE, DUE REGOLE DIVERSE.
//
// (A) LOCALITA' MANCANTI -> si aggiungono a frazioni.json, ma SOLO SE IL LORO CAP E' GIA' NOTO
//     all'archivio per quella provincia. Cosi' si rendono trovabili dei NOMI senza far entrare nel
//     sistema nessun CAP nuovo.
//
// (B) CAP MANCANTI SU COMUNI GIA' PRESENTI (i generici delle citta': 10100 Torino, 80100 Napoli,
//     40100 Bologna) -> si aggiungono all'array `cap` del comune, TRANNE quelli che renderebbero
//     AMBIGUA la corrispondenza CAP->provincia. Quella corrispondenza non serve solo alla tendina:
//     app/api/ordini/importa la usa per ricavare la provincia dagli ordini che non ce l'hanno
//     (Amazon non la scrive), e un CAP attribuito a due province viene scartato come ambiguo,
//     lasciando la provincia vuota. Meglio un CAP in meno che un import peggiore.
//
// NOTA su un allarme che si era rivelato infondato: si era temuto che aggiungere CAP generici
// facesse prezzare sottocosto, perche' pochi di quei CAP compaiono in `zone_cap`. Non e' cosi':
// zone_cap abbina CAP esatto -> PROVINCIA -> jolly, quindi un CAP senza riga esatta viene preso
// dalla riga di provincia e finisce nella zona giusta (verificato: CT->SICILIA, CA/SS->SARDEGNA,
// TO->PIEMONTE). La quasi totalita' dei CAP non ha una riga esatta, ed e' normale.
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

// CASO B: i CAP da appendere ai comuni, saltando quelli che creerebbero un'ambiguita' nuova.
const capProvincia = new Map()
const ambigui = new Set()
const mappa = (cap, sigla) => {
  if (!/^\d{5}$/.test(cap) || sigla.length !== 2 || ambigui.has(cap)) return
  const gia = capProvincia.get(cap)
  if (gia && gia !== sigla) { ambigui.add(cap); capProvincia.delete(cap); return }
  capProvincia.set(cap, sigla)
}
for (const c of comuni) for (const cap of c.cap) mappa(cap, c.sigla)
for (const f of frazioni) mappa(f.cap, f.sigla)

const capDaAggiungere = [], capScartati = []
for (const g of sonoComuni) {
  const gia = capProvincia.get(g.cap)
  if (gia && gia !== g.sigla) capScartati.push({ ...g, conflitto: gia })
  else capDaAggiungere.push(g)
}
console.log(`\n  CAP da appendere ai comuni: ${capDaAggiungere.length} (scartati per ambiguita' CAP->provincia: ${capScartati.length})`)
for (const g of capScartati) console.log(`     scartato ${g.nome} (${g.sigla}) ${g.cap} — il CAP risulta gia' di ${g.conflitto}`)


if (!SCRIVI) {
  console.log('\nReferto soltanto. Per applicare le aggiunte sicure: node scripts/aggiorna-archivio-cap.mjs --scrivi')
  process.exit(0)
}

if (!daAggiungere.length && !capDaAggiungere.length) { console.log('\nNiente da aggiungere: archivio allineato.'); process.exit(0) }

if (capDaAggiungere.length) {
  const perNomeProvincia = new Map(comuni.map((c) => [`${norm(c.nome)}|${c.sigla}`, c]))
  for (const g of capDaAggiungere) {
    const c = perNomeProvincia.get(`${norm(g.nome)}|${g.sigla}`)
    if (c && !c.cap.includes(g.cap)) { c.cap.push(g.cap); c.cap.sort() }
  }
  writeFileSync('lib/data/comuni.json', JSON.stringify(comuni))
  console.log(`Scritti ${capDaAggiungere.length} CAP su comuni.json`)
}

if (!daAggiungere.length) process.exit(0)

// Si inserisce mantenendo l'ordine alfabetico del file (diff piccolo e leggibile).
const nuovo = frazioni.concat(daAggiungere.map((g) => ({
  nome: g.nome, sigla: g.sigla, provincia: g.provincia, cap: g.cap,
})))
nuovo.sort((a, b) => a.nome.localeCompare(b.nome, 'it') || a.sigla.localeCompare(b.sigla) || a.cap.localeCompare(b.cap))
writeFileSync('lib/data/frazioni.json', JSON.stringify(nuovo))
console.log(`\nScritte ${daAggiungere.length} localita'. frazioni.json: ${frazioni.length} -> ${nuovo.length}`)
