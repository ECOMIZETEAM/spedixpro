// COSTRUISCE L'ARCHIVIO DELLE LOCALITA' ESTERE (lib/data/estero/XX.json) DA GEONAMES.
//
// PERCHE' ESISTE. L'autocomplete della citta' nella Nuova Spedizione conosceva solo l'Italia, e la
// conosceva anche quando il paese del destinatario era un altro: chi spediva in Germania e batteva
// "Ber" si vedeva proporre Bergamo, e scegliendolo finivano nel form citta', provincia e CAP
// italiani su un pacco tedesco. Le spedizioni estere sono ~4.300 in 120 giorni (misurato il
// 17/10/2026: DE 1.345, FR 1.068, ES 513, BE 198, NL 190, AT 161, PL 132, PT 107…).
//
// FONTE. Lo stesso archivio dei codici postali GeoNames da cui vengono le frazioni italiane
// (licenza CC-BY 4.0: va citato GeoNames). Un file per paese: nome della localita', CAP, area
// amministrativa. La Grecia GeoNames non la pubblica: resta senza suggerimenti.
//
// QUATTRO PAESI HANNO SOLO LA PRIMA META' DEL CAP nel file leggero: Paesi Bassi (1011, non 1011 AB),
// Regno Unito (SW1A, non SW1A 1AA), Irlanda (D02, non D02 AF30) e Malta (MLH, non MLH 1916; per
// Malta un file completo GeoNames non c'e'). I file completi esistono ma
// pesano 470 mila e 1,8 milioni di righe per ~1,5 e ~0,2 spedizioni al giorno: non vale la pena.
// Per questi il file e' marcato `parziale` e il form completa il CAP solo con quella parte, che chi
// spedisce deve finire di scrivere.
//
//   node scripts/aggiorna-archivio-estero.mjs        -> scarica e riscrive lib/data/estero/
//
// E' idempotente: rilanciarlo con gli stessi dati produce gli stessi file.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

// Tutta l'Europa che GeoNames pubblica (IT ha il suo archivio, comuni.json + frazioni.json).
const PAESI = [
  'AD', 'AL', 'AT', 'AX', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FO',
  'FR', 'GB', 'GG', 'GI', 'HR', 'HU', 'IE', 'IM', 'IS', 'JE', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD',
  'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'UA', 'VA',
]
const PARZIALI = new Set(['NL', 'GB', 'IE', 'MT'])

// Quale colonna amministrativa si mostra accanto al nome, per distinguere gli omonimi.
// Di regola la prima (Land, regione, contea); dove la seconda e' quella che la gente usa
// nell'indirizzo — il dipartimento francese, la provincia spagnola e belga, la contea inglese — quella.
const AREA_2 = new Set(['FR', 'ES', 'BE', 'GB'])

// In Germania GeoNames mette anche i CAP "da grande cliente": aziende, banche, uffici pubblici con
// un CAP tutto loro (10875 Mercedes-Benz Vertrieb, 53110 Deutsche Welle). Sono ~3.000 righe e non
// sono localita': chi cerca "Stutt" non deve vedersi proporre "Stuttgarter Lebensversicherung".
// Si riconoscono dalla precisione vuota (colonna 12) INSIEME al nome: la sola precisione vuota non
// basta, la hanno anche paesi veri (04668 Parthenstein, 70178 Stuttgart-West).
const ENTE = /GmbH|mbH|\bAG\b|\bKG\b|\beG\b|e\.\s?V\.|a\.\s?G\.|\bOHG\b|\bSE\b|Bank|Sparkasse|[Vv]ersicherung|[Kk]asse\b|[Aa]mt\b|ämter|[Aa]mt |Universit|Hochschule|Verlag|Zentrum|Gesellschaft|Landes|Bundes|Agentur|Krankenhaus|Klinik|Verwaltung|Ministerium|Gericht|Polizei|Behörde|Lotterie|Genossenschaft|Verband|Stiftung|Institut|Service|Logistik|Vertrieb|Deutsche |Postbank|Fachbereich/

// In Francia lo stesso vale per i CEDEX ("75021 CEDEX 01"): CAP riservati alle aziende con la
// consegna dedicata, 14 mila righe. Un privato non ne ha uno, e "Paris" ne mostrava centinaia.
const CEDEX = /CEDEX/i

const TMP = join(tmpdir(), 'archivio-estero')
const OUT = 'lib/data/estero'

function scarica(paese) {
  const txt = join(TMP, `${paese}.txt`)
  if (existsSync(txt)) return txt
  mkdirSync(TMP, { recursive: true })
  execSync(`curl -sSf -o ${TMP}/${paese}.zip https://download.geonames.org/export/zip/${paese}.zip && unzip -oq ${TMP}/${paese}.zip ${paese}.txt -d ${TMP}`)
  return txt
}

// Il CAP come lo scrive la posta del paese, con una sola eccezione: il Lussemburgo, che GeoNames
// scrive "L-4974" ma che nelle spedizioni vere arriva quasi sempre come "4974" (19 su 22 nei 120
// giorni misurati) — il prefisso e' quello del paese, e il paese e' gia' nel suo campo.
function capPulito(paese, cap) {
  const c = cap.trim()
  if (paese === 'LU') return c.replace(/^L-\s*/i, '')
  return c
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const referto = []
for (const paese of PAESI) {
  const righe = readFileSync(scarica(paese), 'utf8').split('\n')
  const aree = [], idxArea = new Map()
  // Raggruppate per localita' (nome + area), coi suoi CAP in un elenco: come comuni.json. In
  // Portogallo il CAP e' quasi per via (207 mila righe, 22 mila nomi) e ripetere il nome a ogni
  // CAP triplicava il file.
  const gruppi = new Map()
  let enti = 0
  for (const riga of righe) {
    const p = riga.split('\t')
    if (p.length < 4 || p[0] !== paese) continue
    const cap = capPulito(paese, p[1] || '')
    const nome = (p[2] || '').trim()
    if (!cap || !nome) continue
    if (paese === 'DE' && !(p[11] || '').trim() && ENTE.test(nome)) { enti++; continue }
    if (paese === 'FR' && (CEDEX.test(cap) || CEDEX.test(nome))) { enti++; continue }
    const area = ((AREA_2.has(paese) && (p[5] || '').trim()) || (p[3] || '').trim())
    let ia = idxArea.get(area)
    if (ia === undefined) { ia = aree.length; aree.push(area); idxArea.set(area, ia) }
    const chiave = `${nome}|${ia}`
    let g = gruppi.get(chiave)
    if (!g) { g = [nome, ia, new Set()]; gruppi.set(chiave, g) }
    g[2].add(cap)
  }
  const voci = [...gruppi.values()]
    .map(([nome, ia, caps]) => [nome, ia, [...caps].sort()])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1])
  const file = { paese, parziale: PARZIALI.has(paese), aree, voci }
  writeFileSync(join(OUT, `${paese}.json`), JSON.stringify(file))
  referto.push({ paese, localita: voci.length, cap: new Set(voci.flatMap((v) => v[2])).size, aree: aree.length, enti_tolti: enti })
}

// L'indice: un import() per paese, cosi' il server carica solo il file del paese cercato.
const indice = [
  '// GENERATO da scripts/aggiorna-archivio-estero.mjs — non modificare a mano.',
  '// Un import() per paese: il server carica solo il file del paese che si sta cercando.',
  'export const ARCHIVIO_ESTERO: Record<string, () => Promise<{ default: unknown }>> = {',
  ...PAESI.map((p) => `  ${p}: () => import('./${p}.json'),`),
  '}',
  '',
]
writeFileSync(join(OUT, 'index.ts'), indice.join('\n'))

console.table(referto)
