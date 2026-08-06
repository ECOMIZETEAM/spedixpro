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

const euro = (v: any) => {
  // Il PUNTO qui e' separatore delle migliaia e la VIRGOLA e' decimale: "1.234,56".
  if (typeof v === 'number') return v
  return Number(String(v ?? '0').replace(/\./g, '').replace(',', '.')) || 0
}
const kg = (v: any) => {
  // Qui invece il punto E' decimale: "8.000" sono otto chili, non ottomila.
  if (typeof v === 'number') return v
  return Number(String(v ?? '0').replace(',', '.')) || 0
}

function misure(v: any): { lunghezza: number; larghezza: number; altezza: number } {
  const p = String(v ?? '').toLowerCase().split('x').map(x => Number(String(x).trim()) || 0)
  return { lunghezza: p[0] || 0, larghezza: p[1] || 0, altezza: p[2] || 0 }
}

// Le righe arrivano gia' lette dalla pagina (xlsx legge sia CSV sia XLS), quindi qui non si fa
// nessun parsing di testo: si normalizzano solo i NOMI delle colonne, perche' "id_ordine",
// "ID Ordine" e "id-ordine" devono essere la stessa cosa.
function normalizza(riga: any): Record<string, any> {
  const out: Record<string, any> = {}
  for (const k of Object.keys(riga || {})) {
    out[String(k).toLowerCase().replace(/[^a-z0-9]/g, '')] = riga[k]
  }
  return out
}

// Il file e' di ripesature? Si riconosce dalle colonne, non dal nome del file: chi carica non deve
// sapere in quale schermata va quale export.
export function sembraRipesature(righe: any[]): boolean {
  const r = normalizza((righe || [])[0] || {})
  return 'idordine' in r && 'ldv' in r && ('misureriscontrate' in r || 'pesoriscontrato' in r)
}

export function leggiRipesature(righe: any[]): { righe: Ripesatura[]; scartate: number; totaleFornitore: number } {
  const gruppi = new Map<string, Ripesatura>()
  let scartate = 0
  for (const grezza of (righe || [])) {
    const c = normalizza(grezza)
    const idOrdine = String(c.idordine ?? '').trim()
    const ldv = String(c.ldv ?? '').trim()
    if (!idOrdine || !ldv) { scartate++; continue }
    const collo: ColloRipesato = { peso: kg(c.pesoriscontrato), ...misure(c.misureriscontrate) }

    const g = gruppi.get(idOrdine)
    if (!g) {
      gruppi.set(idOrdine, {
        idOrdine,
        idVerifiche: [String(c.idverifica ?? '')].filter(Boolean),
        ldv,
        // L'IMPORTO NON SI SOMMA: e' lo stesso su tutte le righe della spedizione.
        addebitoFornitore: euro(c.addebito),
        colli: [collo],
        dataChiusura: String(c.datachiusura ?? ''),
        mittente: String(c.mittente ?? ''),
        destinatario: String(c.destinatario ?? ''),
      })
    } else {
      if (c.idverifica) g.idVerifiche.push(String(c.idverifica))
      g.colli.push(collo)
      // La LDV madre e' la piu' corta: quella dei colli la contiene come suffisso.
      if (ldv.length < g.ldv.length) g.ldv = ldv
    }
  }
  const out = [...gruppi.values()]
  return { righe: out, scartate, totaleFornitore: out.reduce((s, r) => s + r.addebitoFornitore, 0) }
}
