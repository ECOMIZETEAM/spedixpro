// IL FILE DELLE RIPESATURE DEL FORNITORE.
//
// Il corriere rimisura i colli e ci addebita la differenza. L'export che ne esce ha due trappole,
// e tutte e due costano soldi se non le si conosce.
//
// PRIMA: IL MULTICOLLO E' SPACCATO PER COLLO, MA L'ADDEBITO E' UNO SOLO.
// Una spedizione da cinque colli occupa cinque righe, e su OGNI riga c'e' lo stesso importo — che
// non va sommato, e' l'importo della spedizione ripetuto. Misurato sul file vero: 127 righe che
// sono 106 spedizioni, 547,62 euro riga per riga contro 356,35 veri. Caricarle a riga vorrebbe
// dire addebitare il 54% in piu' ai clienti.
// Le righe di una stessa spedizione si riconoscono dall'id_ordine. Controprova indipendente: la
// lettera di vettura di un collo FINISCE SEMPRE con quella madre (1WLJMFK6W + 3UW1WLJ009255).
//
// SECONDA: LE DUE COLONNE NUMERICHE USANO SEPARATORI DIVERSI.
// Il peso scrive "8.000" col PUNTO decimale (otto chili), l'importo "1,02" con la VIRGOLA.
// Leggendoli allo stesso modo un pacco da 8 kg diventa da ottomila, e il volumetrico esplode.
//
// E' il volume, non il peso, a fare il supplemento: verificato chiedendo al fornitore due preventivi
// sulla stessa spedizione, 106 casi su 106 al centesimo. Su 45 di quei 106 il pacco pesava MENO di
// quanto avevamo fatturato e pagava lo stesso — perche' misurava di piu'. Per questo le misure
// riscontrate contano quanto il peso e vanno portate fino al ricalcolo.

export type ColloRipesato = { peso: number; lunghezza: number; larghezza: number; altezza: number }

export type Ripesatura = {
  idOrdine: string          // chiave del raggruppamento e anti-doppione
  idVerifiche: string[]     // le singole verifiche che compongono questa spedizione
  ldv: string               // la lettera di vettura MADRE (quella della spedizione)
  addebitoFornitore: number // quanto ci addebita il fornitore, per la spedizione INTERA
  colli: ColloRipesato[]
  dataChiusura: string
  mittente: string
  destinatario: string
}

const euro = (s: string) => Number(String(s || '0').replace(/\./g, '').replace(',', '.')) || 0
const kg = (s: string) => Number(String(s || '0').replace(',', '.')) || 0

function misure(s: string): { lunghezza: number; larghezza: number; altezza: number } {
  const p = String(s || '').toLowerCase().split('x').map(x => Number(x.trim()) || 0)
  return { lunghezza: p[0] || 0, larghezza: p[1] || 0, altezza: p[2] || 0 }
}

// Divide una riga tenendo conto delle virgolette: i nomi contengono virgole e punti e virgola.
function celle(riga: string, sep: string): string[] {
  const out: string[] = []
  let cur = '', dentro = false
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i]
    if (c === '"') { if (dentro && riga[i + 1] === '"') { cur += '"'; i++ } else dentro = !dentro; continue }
    if (c === sep && !dentro) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out.map(x => x.trim())
}

export function leggiRipesature(testo: string): { righe: Ripesatura[]; scartate: number; totaleFornitore: number } {
  // Il BOM davanti alla prima intestazione fa fallire il confronto sul primo nome di colonna.
  const pulito = testo.replace(/^﻿/, '')
  const linee = pulito.split(/\r?\n/).filter(r => r.trim())
  if (!linee.length) return { righe: [], scartate: 0, totaleFornitore: 0 }

  const sep = (linee[0].match(/;/g) || []).length >= (linee[0].match(/,/g) || []).length ? ';' : ','
  // Via TUTTO cio' che non e' lettera o cifra: "id_ordine", "ID Ordine" e "id-ordine" devono
  // diventare la stessa cosa. Tenere il trattino basso, come facevo prima, bastava a non
  // riconoscere nemmeno una colonna.
  const intest = celle(linee[0], sep).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const col = (nome: string) => intest.indexOf(nome)
  const iOrdine = col('idordine'), iVerifica = col('idverifica'), iLdv = col('ldv')
  const iMisure = col('misureriscontrate'), iPeso = col('pesoriscontrato'), iAddebito = col('addebito')
  const iChiusura = col('datachiusura'), iMitt = col('mittente'), iDest = col('destinatario')
  if (iOrdine < 0 || iLdv < 0 || iAddebito < 0) {
    throw new Error('Il file non sembra un export di ripesature: mancano le colonne id_ordine, ldv o addebito.')
  }

  const gruppi = new Map<string, Ripesatura>()
  let scartate = 0
  for (let n = 1; n < linee.length; n++) {
    const c = celle(linee[n], sep)
    const idOrdine = c[iOrdine] || ''
    const ldv = c[iLdv] || ''
    if (!idOrdine || !ldv) { scartate++; continue }
    const m = misure(iMisure >= 0 ? c[iMisure] : '')
    const collo: ColloRipesato = { peso: kg(iPeso >= 0 ? c[iPeso] : '0'), ...m }

    const g = gruppi.get(idOrdine)
    if (!g) {
      gruppi.set(idOrdine, {
        idOrdine,
        idVerifiche: [c[iVerifica] || ''].filter(Boolean),
        ldv,
        // L'IMPORTO NON SI SOMMA: e' lo stesso su tutte le righe della spedizione.
        addebitoFornitore: euro(c[iAddebito]),
        colli: [collo],
        dataChiusura: iChiusura >= 0 ? c[iChiusura] : '',
        mittente: iMitt >= 0 ? c[iMitt] : '',
        destinatario: iDest >= 0 ? c[iDest] : '',
      })
    } else {
      if (c[iVerifica]) g.idVerifiche.push(c[iVerifica])
      g.colli.push(collo)
      // La LDV madre e' la piu' corta: quella dei colli la contiene come suffisso.
      if (ldv.length < g.ldv.length) g.ldv = ldv
    }
  }

  const righe = [...gruppi.values()]
  return { righe, scartate, totaleFornitore: righe.reduce((s, r) => s + r.addebitoFornitore, 0) }
}
