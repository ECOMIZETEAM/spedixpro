/* PAGA GIUSTO? Le regole con cui il controllo GLS dice se il corriere ha fatto pagare giusto una riga senza un costo
 * in Moove con cui confrontarla: gli arrivi (contro le partenze dello stesso peso più il supplemento degli arrivi) e
 * le spedizioni fuori da tutto.
 * Niente grafica e niente database: la pagina le usa per la contestazione e per la singola spedizione, così l'«in
 * più» di una spedizione è la sua parte di quello che si contesta. */
import { descriviVoce, type RigaFatturaBrt } from '@/lib/fattura-brt'
import { eGls, type RigaFatturaGls } from '@/lib/fattura-gls'
import type { ControlloFuori } from './FattaPagare'

const r2 = (n: number) => Math.round(n * 100) / 100
const euro = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const kg = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' kg'

// Il servizio estero di GLS (Parcel): il suo nolo non si confronta con quello delle partenze italiane.
export const eEstero = (r: object | null | undefined) => /parcel/i.test(String((r as { servizio?: unknown } | null | undefined)?.servizio || ''))

// Il nolo che il corriere chiede in Italia a un dato peso, letto dalle partenze dello stesso documento (i noli con
// almeno 5 partenze il cui intervallo di pesi comprende quel peso). Senza partenze di quel peso (l'arrivo da 303,9 kg
// di ottobre) non c'è: meglio niente che un numero inventato. E non c'è nemmeno quando a quel peso le partenze hanno
// più prezzi: sopra i 5 kg il prezzo dipende dalla zona (borderò del 23/11, fra 5 e 10 kg 5,25 € su 159 partenze e
// 6,00 € su 127). Prendere il più frequente faceva sembrare sbagliati gli arrivi da Bitonto, Corato e Pastorano a
// 6,50 €, che sono i 6,00 € della loro zona più il supplemento degli arrivi.
export function noloDellePartenze(righe: RigaFatturaBrt[]): (peso: number) => number | null {
  const fasce = new Map<number, { min: number; max: number; n: number }>()
  for (const r of righe) {
    if (!r.andata || eEstero(r) || !(r.nolo > 0)) continue
    const f = fasce.get(r.nolo) || { min: Infinity, max: 0, n: 0 }
    f.min = Math.min(f.min, r.pesoTassato); f.max = Math.max(f.max, r.pesoTassato); f.n++; fasce.set(r.nolo, f)
  }
  return (peso: number) => {
    const cand = Array.from(fasce.entries()).filter(([, f]) => f.n >= 5 && f.min <= peso + 1e-9 && peso <= f.max + 1e-9)
    return cand.length === 1 ? cand[0][0] : null
  }
}

// LA TARIFFA DEI RESI DEL CONTRATTO (Wave, 27/11: "il reso costa fisso 3,50 € + fuel fino a 3 kg, oltre 3 kg 3,50 € +
// 0,10 € ogni kilo, + fuel 3% sempre"). Sta nelle impostazioni del contratto GLS (corrieri.settings.tariffa_resi): il
// listino di Moove il reso lo scrive come percentuale del nolo, e non la può dire. I kg si arrotondano in su: così
// tornano tutti i 25 «Addebito» (resi al mittente) del borderò del 23/11, 3,4 kg → 3,60 €, 4,9 kg → 3,70 €. Vale solo per
// i resi al mittente, non per gli arrivi (sotto).
export type TariffaResi = { base: number; finoKg: number; perKg: number }
export const tariffaReso = (kg: number, t: TariffaResi) => r2(t.base + t.perKg * Math.max(0, Math.ceil(kg - 1e-9) - t.finoKg))
export const descriviTariffaResi = (t: TariffaResi) => `${euro(t.base)} fino a ${t.finoKg.toLocaleString('it-IT')} kg, poi +${euro(t.perKg)} al kg`

// IL NOLO GIUSTO DI UN RIENTRO. Due tipi, due tariffe (Lorenzo, 27/11):
//  - ADDEBITO = il pacco di Wave che torna indietro non consegnato (il reso al mittente): la tariffa resi del contratto,
//    sopra. Borderò del 23/11: 25 su 25 la rispettano.
//  - ARRIVO = una spedizione vera che parte da fuori e arriva a Wave, che GLS fa pagare a Wave ("sono vere e proprie
//    spedizioni ma partono da fuori, non sono resi"). Non ha la tariffa resi: per un'ora del 27/11 l'aveva, e gli
//    arrivi a 4,00 € risultavano tutti pagati troppo (52,30 € a ottobre, quasi tutti sull'arrivo da 303,9 kg).
// Un rientro senza tariffa dal contratto si confronta col documento: nel borderò del 23/11 127 arrivi su 133 costano
// esattamente 0,50 € più delle partenze dello stesso peso, da qualunque posto. Lo scarto più frequente per tipo di
// rientro (almeno 5 confronti, a pari merito il più basso) fa da supplemento, e si segnala solo quello che va oltre.
export type RiferimentoRientro = { riferimento: number; come: string; tipo: string; daContratto: boolean; supplemento?: number; n?: number; su?: number }
export const eArrivo = (r: RigaFatturaBrt) => /arriv/i.test(String(r.tipoBolla || ''))
export function riferimentoRientri(righe: RigaFatturaBrt[], nolo: (peso: number) => number | null, tariffa?: TariffaResi | null): (r: RigaFatturaBrt) => RiferimentoRientro | null {
  const tipoDi = (r: RigaFatturaBrt) => String(r.tipoBolla || '').trim() || 'Rientro'
  const rientro = (r: RigaFatturaBrt) => !r.andata && !eEstero(r) && r.nolo > 0
  const daContratto = (r: RigaFatturaBrt) => !!tariffa && !eArrivo(r)
  const valuta = (r: RigaFatturaBrt) => rientro(r) && !daContratto(r) ? nolo(r.pesoTassato) : null
  const scarti = new Map<string, Map<number, number>>()
  for (const r of righe) {
    const p = valuta(r); if (p == null) continue
    const m = scarti.get(tipoDi(r)) || new Map<number, number>(); const c = Math.round((r.nolo - p) * 100)
    m.set(c, (m.get(c) || 0) + 1); scarti.set(tipoDi(r), m)
  }
  // Almeno 5 confronti, come per il nolo delle partenze: un solo reso da 9,50 € faceva diventare tariffa +6,00 €.
  const supp = new Map<string, { euro: number; n: number; su: number }>()
  for (const [tipo, m] of Array.from(scarti.entries())) {
    const su = Array.from(m.values()).reduce((t, x) => t + x, 0)
    if (su < 5) continue
    const [c, n] = Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    supp.set(tipo, { euro: c / 100, n, su })
  }
  return (r: RigaFatturaBrt) => {
    if (!rientro(r)) return null
    if (daContratto(r)) return { riferimento: tariffaReso(r.pesoTassato, tariffa!), come: `tariffa resi del contratto: ${descriviTariffaResi(tariffa!)}`, tipo: tipoDi(r), daContratto: true }
    const p = valuta(r); const s = supp.get(tipoDi(r))
    if (p == null || !s) return null
    return { riferimento: r2(p + s.euro), tipo: tipoDi(r), daContratto: false, supplemento: s.euro, n: s.n, su: s.su,
      come: Math.abs(s.euro) >= 0.005 ? `${euro(p)} delle partenze dello stesso peso + ${euro(s.euro)} degli arrivi di questo documento` : 'il nolo delle partenze dello stesso peso' }
  }
}

type StatoVoce = { stato: string; il: string; numero?: string }

// Una spedizione fuori da tutto (Lorenzo, 27/11: "facciamo sempre anche su queste i controlli sul fuel ecc., Wave
// deve sempre sapere se paga giusto"): il carburante oltre il contratto (calcolato come nella contestazione: sul nolo,
// la differenza di percentuale) e il nolo contro le partenze dello stesso peso. Per un arrivo quell'«in più» è nella
// contestazione degli arrivi; per una partenza no, da sola, perché una zona più cara la farebbe sembrare sbagliata:
// si dice di chiederlo.
export function controllaFuori(r: RigaFatturaBrt, c: {
  legenda?: Record<string, string> | null; carburanteListino: number | null; noloPartenze: (peso: number) => number | null
  rientri: (r: RigaFatturaBrt) => RiferimentoRientro | null
  stati: Record<string, StatoVoce>; corriere: string
}): ControlloFuori {
  const g = r as RigaFatturaGls
  const carbEuro = r2(r.voci.filter(v => descriviVoce(v.sigla, c.legenda).categoria === 'carburante').reduce((t, v) => t + v.importo, 0))
  const perc = eGls(r) && g.percentualeCarburante > 0 ? g.percentualeCarburante : null
  const listinoPct = c.carburanteListino
  // Senza la percentuale della riga o quella del listino il carburante non si è controllato: non è «giusto».
  const carbControllato = perc != null && listinoPct != null
  const carbInPiu = carbControllato && perc > listinoPct + 0.25 ? r2(r.nolo * (perc - listinoPct) / 100) : 0
  // Un rientro (arrivo, reso) si confronta con la tariffa dei resi del contratto (o, senza, con la partenza dello stesso
  // peso più il supplemento dei rientri); una partenza con le partenze dello stesso peso.
  const rientro = r.andata ? null : c.rientri(r)
  // Il nolo si confronta solo su GLS: per gli altri corrieri le regole di qui non valgono.
  const rif = !eGls(r) || eEstero(r) || !(r.nolo > 0) ? null : r.andata ? c.noloPartenze(r.pesoTassato) : rientro ? rientro.riferimento : null
  const noloInPiu = rif != null && r.nolo > rif + 0.005 ? r2(r.nolo - rif) : 0
  const comeSi = rientro ? rientro.come : 'il nolo delle partenze dello stesso peso'
  const nolo = {
    euro: r.nolo, riferimento: rif, inPiu: noloInPiu,
    perche: !eGls(r) ? `il nolo di ${c.corriere} qui non si confronta`
      : eEstero(r) ? 'il nolo estero non si confronta con le partenze italiane'
      : rif == null && !r.andata && c.noloPartenze(r.pesoTassato) != null ? 'nel documento ci sono troppo pochi rientri di questo tipo per sapere quanto costano più delle partenze'
      : rif == null ? `nel documento le partenze da ${kg(r.pesoTassato)} non hanno un prezzo solo (o sono troppo poche) per confrontarlo`
      : noloInPiu > 0 ? `${euro(r.nolo)} invece di ${euro(rif)} (${comeSi})` : '',
  }
  const altreVoci = r.voci.filter(v => Math.abs(v.importo) >= 0.005 && descriviVoce(v.sigla, c.legenda).categoria !== 'carburante')
    .map(v => ({ nome: descriviVoce(v.sigla, c.legenda).nome, euro: r2(v.importo) }))
  // Dove sta l'«in più»: nella contestazione già mandata (e com'è finita) o in quella da mandare.
  const dove = (chiave: string, cosa: string) => {
    const s = c.stati[chiave]
    return !s ? `${cosa} è nella contestazione da mandare a ${c.corriere} (riquadro in alto).`
      : s.stato === 'contestato' ? `${cosa} è stato contestato a ${c.corriere} il ${new Date(s.il).toLocaleDateString('it-IT')}: aspetti la risposta.`
      : s.stato === 'accreditato' ? `${cosa} è stato recuperato con la nota di credito${s.numero ? ' ' + s.numero : ''}.`
      : s.stato === 'respinto' ? `${cosa}: ${c.corriere} ha respinto la contestazione.`
      : s.stato === 'girato' ? `${cosa} è stato girato ai clienti.`
      : s.stato === 'tentato' ? `${cosa} è da girare ai clienti: la Rettifica non l'ha creato.`
      : s.stato === 'assorbito' ? `${cosa} lo hai assorbito tu.`
      : `${cosa}: ${s.stato}.`
  }
  const frasi: string[] = []
  if (carbInPiu > 0) frasi.push(dove(`carburante-doc:${g.contratto || ''}`, 'Il carburante in più'))
  if (noloInPiu > 0) frasi.push(r.andata ? `Il nolo chiedilo a ${c.corriere}, se non è una zona più cara.` : dove('arrivi-sopra', 'Il nolo in più del rientro'))
  const inPiu = r2(carbInPiu + noloInPiu)
  return {
    carburante: carbEuro || perc != null ? { euro: carbEuro, percentuale: perc, listino: listinoPct, inPiu: carbInPiu, controllato: carbControllato } : null,
    nolo, altreVoci, inPiu, atteso: r2(r.totale - inPiu), contestazione: frasi.join(' ') || null,
  }
}
