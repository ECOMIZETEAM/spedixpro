import type { Ripesatura } from '@/lib/ripesature'

// ── FORMATO XL (Poste "Andamento giornaliero", lo carica LOGIXIA): RIGHE CONTRO COLLI ──
//
// Qui il collo per collo e' gia' nel file, una riga per collo. Prima di riprezzare si guarda la
// spedizione vera — la STESSA gamba che sceglie il motore: la partenza (numero = tracking),
// altrimenti la prima — e si confrontano le righe coi suoi colli:
//  * meno colli misurati che colli spediti (righe mancanti o celle vuote): NON si addebita adesso.
//    Una rettifica a meta' chiederebbe meno del dovuto e poi l'anti-doppio impedirebbe di
//    completarla col file successivo, che il fornitore manda cumulativo. Si aspetta quello.
//    Niente coda misure_colli: quella serve a SpediamoPro, qui le misure arrivano dal file.
//  * piu' righe che colli: non deve succedere (sul file del 12/10 zero casi su 6.958). Se succede
//    non si indovina: si salta e si conta, da guardare a mano.
//
// MAI colli_dettaglio intero. Sulle SDA L ogni collo porta dentro la sua etichetta in PDF (base64,
// ~1,7 MB a collo): una spedizione da 10 colli pesa 79 MB, le partenze di 40 giorni 3,4 GB. Letto per
// ogni pacchetto da 50, la richiesta scaricava decine di mega per nulla e rischiava di cadere sempre
// sullo stesso pacchetto, fermando il file a meta'. Si legge solo il numero dei colli, e i pesi
// collo per collo (campo per campo) solo per le poche LDV che servono.
//
// NON SI RICALCOLA CIO' CHE NON E' CRESCIUTO. Una spedizione a un collo misurata non piu' pesante e
// con nessun lato piu' lungo di come l'abbiamo addebitata non puo' costare di piu' a nessun livello:
// peso, volume, lato massimo e circonferenza scendono o restano uguali. Il file di LOGIXIA del 12/10 ne
// ha 3.131 su 6.790, e tra queste NESSUNA delle 1.111 rettifiche della simulazione completa: rifare
// per loro la catena intera (65 domande al database l'una) era la meta' del tempo di caricamento.
// Si confronta col collo come l'abbiamo NOI (dettaglio colli: e' quello che e' stato addebitato), non
// col dichiarato scritto nel file. I lati si confrontano in ordine di grandezza, non per nome: chi
// misura puo' chiamare profondita' quella che per noi e' lunghezza. Multicollo: si calcolano sempre.
const nonCresciuto = (mis: { peso: number; lunghezza: number; larghezza: number; altezza: number }, dic: number[]) => {
  const [dp, ...dl] = dic
  if (!(dp > 0) || dl.some(x => !(x > 0))) return false        // dichiarato incompleto: si calcola
  const ml = [mis.lunghezza, mis.larghezza, mis.altezza].map(x => Number(x) || 0).sort((a, b) => b - a)
  const ds = [...dl].sort((a, b) => b - a)
  return (Number(mis.peso) || 0) <= dp && ml.every((x, i) => x <= ds[i])
}

// Cambia le righe sul posto (il peso pieno dei colli senza bilancia) e dice quali saltare.
export async function controllaColliXL(admin: any, nuove: Ripesatura[]): Promise<{
  daSaltare: Set<string>; misureIncomplete: number; colliInPiu: number; nonCresciute: number
}> {
  const daSaltare = new Set<string>()
  let misureIncomplete = 0, colliInPiu = 0, nonCresciute = 0
  const xl = nuove.filter(r => r.formato === 'xl')
  if (!xl.length) return { daSaltare, misureIncomplete, colliInPiu, nonCresciute }

  const gambaDelMotore = (ls: any[]) => ls.find(x => x.numero === x.tracking_number) || ls[0] || null
  const perLdv = async (ldv: string[], campi: string) => {
    const gambe = new Map<string, any[]>()
    for (let i = 0; i < ldv.length; i += 200) {
      const { data: sp } = await admin.from('spedizioni').select(campi).in('tracking_number', ldv.slice(i, i + 200))
      for (const s of (sp || []) as any[]) gambe.set(s.tracking_number, [...(gambe.get(s.tracking_number) || []), s])
    }
    const out = new Map<string, any>()
    for (const [k, ls] of gambe) { const g = gambaDelMotore(ls); if (g) out.set(k, g) }
    return out
  }

  // Del primo collo anche peso e lati come li abbiamo addebitati (campo per campo, senza etichetta).
  const primo = ['peso', 'lunghezza', 'larghezza', 'altezza'].map(c => `d_${c}:colli_dettaglio->0->${c}`).join(',')
  const spedite = await perLdv(Array.from(new Set(xl.map(r => r.ldv))), `tracking_number,numero,colli,${primo}`)
  const colliDi = new Map<string, number>()
  for (const r of xl) {
    const s = spedite.get(r.ldv)
    if (!s) continue                                   // non in piattaforma: la conta il motore
    const colli = Math.max(1, Number(s.colli) || 1)
    const righeFile = r.colli.length + (r.colliNonRilevati || 0)
    if (righeFile > colli) { colliInPiu++; daSaltare.add(r.ldv); continue }
    if (r.colli.length < colli) { misureIncomplete++; daSaltare.add(r.ldv); continue }
    if (colli === 1 && r.colli.length === 1 && !(r.colliPesoDaDichiarato || []).length
      && nonCresciuto(r.colli[0], [s.d_peso, s.d_lunghezza, s.d_larghezza, s.d_altezza].map(x => Number(x) || 0))) {
      nonCresciute++; daSaltare.add(r.ldv); continue
    }
    colliDi.set(r.ldv, colli)
  }

  // Colli con le misure ma senza peso: il peso dichiarato pieno dal dettaglio colli, abbinato al
  // valore arrotondato del file (lo stesso collo, al centesimo). Se non si abbina, resta quello del file.
  const servePeso = xl.filter(r => colliDi.has(r.ldv) && (r.colliPesoDaDichiarato || []).length)
  if (servePeso.length) {
    const n = Math.min(100, Math.max(...servePeso.map(r => colliDi.get(r.ldv) || 1)))
    const campi = ['tracking_number', 'numero', ...Array.from({ length: n }, (_, i) => `p${i}:colli_dettaglio->${i}->peso`)].join(',')
    const pesi = await perLdv(Array.from(new Set(servePeso.map(r => r.ldv))), campi)
    for (const r of servePeso) {
      const g = pesi.get(r.ldv)
      if (!g) continue
      const dettaglio = Array.from({ length: n }, (_, i) => Number(g['p' + i]) || 0)
      const usati = new Set<number>()
      for (const idx of (r.colliPesoDaDichiarato || [])) {
        const diFile = (r.pesiDichiaratiFile || [])[idx] || 0
        let scelto = -1, scarto = Infinity
        dettaglio.forEach((pd, j) => {
          const s2 = Math.abs(pd - diFile)
          if (!usati.has(j) && pd > 0 && s2 < 0.011 && s2 < scarto) { scelto = j; scarto = s2 }
        })
        if (scelto >= 0) { usati.add(scelto); r.colli[idx] = { ...r.colli[idx], peso: dettaglio[scelto] } }
      }
    }
  }
  return { daSaltare, misureIncomplete, colliInPiu, nonCresciute }
}
