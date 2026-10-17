// RICERCA DI LOCALITA' E CAP ESTERI per l'autocomplete della Nuova Spedizione.
//
// L'archivio sta in lib/data/estero/XX.json (uno per paese, costruito da
// scripts/aggiorna-archivio-estero.mjs da GeoNames). Si carica SOLO il file del paese cercato, alla
// prima ricerca, e resta in memoria: il Portogallo da solo sono 200 mila CAP, caricarli tutti per
// chi spedisce a Vienna non avrebbe senso.
//
// Non decide niente sul prezzo: propone nomi e CAP che chi spedisce sceglie. La provincia del
// destinatario estero resta quella di oggi (la sigla del paese, messa dal form quando si cambia
// paese): l'area mostrata nella tendina serve solo a distinguere gli omonimi.
import { ARCHIVIO_ESTERO } from '@/lib/data/estero'

type FileEstero = { paese: string; parziale: boolean; aree: string[]; voci: [string, number, string[]][] }
type Gruppo = { nome: string; area: string; cap: string[]; chiavi: string[] }
type Indice = { parziale: boolean; gruppi: Gruppo[]; perCap: { cap: string; kc: string; g: Gruppo }[] }

export type VoceEstera = { nome: string; sigla: string; provincia: string; cap: string; paese: string; parziale: boolean }

// Il confronto dei nomi, come per l'Italia (app/api/comuni/route.ts): senza accenti, apostrofi,
// spazi. In piu' i trattini e i punti ("Saint-Denis" == "Saint Denis", "St. Gallen" == "St Gallen")
// e le lettere che NFD non scompone: ł polacca, ø danese, ß tedesca. Senza, chi batte "Lodz" non
// trova Łódź.
export function normNomeEstero(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
    .replace(/đ/g, 'd').replace(/ı/g, 'i').replace(/þ/g, 'th').replace(/ð/g, 'd')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’ʼ`´'.\-‐–]/g, '')
    .replace(/\s+/g, '')
}

// Seconda chiave per le dieresi scritte alla tedesca: "Muenchen", "Koeln", "Duesseldorf" sono il
// modo normale di scriverle senza tastiera tedesca, e senza questa chiave non trovavano niente.
function normDieresi(s: string): string {
  return normNomeEstero(s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'))
}

// Ogni nome si cerca per tutte le sue scritture. In Bulgaria (e in Serbia, Bielorussia...) GeoNames
// scrive il nome nei due alfabeti, "София / Sofija": senza la parte dopo la barra, chi batte in
// caratteri latini trovava la citta' solo per caso, a meta' parola.
function chiavi(nome: string): string[] {
  const k = new Set([normNomeEstero(nome), normDieresi(nome)])
  if (nome.includes('/')) for (const parte of nome.split('/')) { k.add(normNomeEstero(parte)); k.add(normDieresi(parte)) }
  k.delete('')
  return [...k]
}

// Il CAP si confronta senza spazi, trattini e punti ("60326" trova 60-326, "19045" trova 190 45),
// e senza il prefisso di paese scritto col trattino ("D-63456", "LV-1029", "L-4974"): e' la stessa
// cifra scritta all'uso di una volta. Il prefisso si toglie SOLO col trattino: i CAP inglesi e
// irlandesi cominciano con delle lettere (SW1A, D02) che fanno parte del codice.
export function normCapEstero(s: string): string {
  return s.toUpperCase().trim().replace(/^[A-Z]{1,2}-\s*(?=\d)/, '').replace(/[\s.\-]/g, '')
}

const cache = new Map<string, Promise<Indice>>()

// Solo le chiavi dell'indice: `paese` arriva dalla barra degli indirizzi.
const haArchivio = (paese: string) => Object.prototype.hasOwnProperty.call(ARCHIVIO_ESTERO, paese)

function indice(paese: string): Promise<Indice> | null {
  if (!haArchivio(paese)) return null
  const carica = ARCHIVIO_ESTERO[paese]
  let p = cache.get(paese)
  if (!p) {
    p = carica().then(({ default: f }) => {
      const file = f as FileEstero
      const gruppi: Gruppo[] = file.voci.map(([nome, ia, cap]) => ({ nome, area: file.aree[ia] || '', cap, chiavi: chiavi(nome) }))
      const perCap = gruppi.flatMap((g) => g.cap.map((cap) => ({ cap, kc: normCapEstero(cap), g })))
      perCap.sort((a, b) => a.kc.localeCompare(b.kc) || a.g.nome.localeCompare(b.g.nome))
      return { parziale: file.parziale, gruppi, perCap }
    })
    // Un caricamento fallito non deve restare in memoria come risposta per sempre.
    p.catch(() => cache.delete(paese))
    cache.set(paese, p)
  }
  return p
}

export function paeseInArchivio(paese: string): boolean {
  return haArchivio(paese)
}

export async function cercaLocalitaEstere(paese: string, raw: string): Promise<VoceEstera[]> {
  const ind = await indice(paese)
  if (!ind) return []
  const voce = (g: Gruppo, cap: string): VoceEstera =>
    ({ nome: g.nome, sigla: paese, provincia: g.area, cap, paese, parziale: ind.parziale })

  // Con una cifra dentro e' un CAP (anche "SW1A" o "D02"); senza, e' un nome.
  if (/\d/.test(raw)) {
    const q = normCapEstero(raw)
    if (q.length < 2) return []
    const voci: VoceEstera[] = []
    for (const r of ind.perCap) {
      if (r.kc.startsWith(q)) { voci.push(voce(r.g, r.cap)); if (voci.length >= 80) break }
    }
    // Paesi Bassi, Regno Unito, Irlanda: l'archivio ha solo la prima parte del CAP. Chi batte il
    // codice intero ("1013 CS", "SW18 1GU") deve trovare la localita' di quella prima parte, e la
    // voce porta il SUO codice intero: sceglierla non deve accorciarglielo.
    if (ind.parziale && !voci.length) {
      const intero = raw.trim().toUpperCase()
      const prima = ind.perCap.filter((r) => q.startsWith(r.kc))
      const piuLunga = Math.max(0, ...prima.map((r) => r.kc.length))
      for (const r of prima) if (r.kc.length === piuLunga) voci.push({ ...voce(r.g, intero), parziale: false })
    }
    return voci
  }

  const q = normNomeEstero(raw)
  if (q.length < 2) return []
  const inizia: Gruppo[] = [], contiene: Gruppo[] = []
  for (const g of ind.gruppi) {
    if (g.chiavi.some((k) => k.startsWith(q))) inizia.push(g)
    else if (g.chiavi.some((k) => k.includes(q))) contiene.push(g)
  }
  // Prima le localita' con piu' CAP: chi batte "Ber" in Germania cerca Berlino, non uno dei
  // quaranta paesi che si chiamano Berg. Il numero di CAP e' la misura piu' semplice di quanto un
  // posto e' grande, e l'archivio ce l'ha gia'.
  const perPeso = (a: Gruppo, b: Gruppo) => b.cap.length - a.cap.length || a.nome.localeCompare(b.nome)
  inizia.sort(perPeso); contiene.sort(perPeso)

  // Tutti i CAP di ogni localita', come per i comuni italiani: Berlino ne ha 190, e tagliarli
  // vorrebbe dire che chi cerca il suo non lo trova. Per questo il tetto e' piu' alto dell'Italia.
  const voci: VoceEstera[] = []
  for (const g of [...inizia.slice(0, 60), ...contiene.slice(0, 20)]) {
    for (const cap of g.cap) voci.push(voce(g, cap))
    if (voci.length >= 250) break
  }
  return voci.slice(0, 250)
}
