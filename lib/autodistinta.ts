// AUTO DISTINTA SPENTA: VALE PER TUTTO IL PACCO, NON SOLO PER LA RIGA DEL CLIENTE.
//
// Un cliente con l'auto distinta spenta (impostazioni.autodistinta = 'no', Impostazioni cliente lato master)
// chiude le distinte da solo: e' la sua distinta a dire che il pacco parte. Su un contratto CONDIVISO pero' il
// pacco ha piu' righe, una per master, legate da raw_response.venditore_spedizione_id (lib/condivisione-catena):
// la riga del cliente e' una gamba-ponte, e quella che parla col corriere sta presso il master che vende il
// contratto, intestata al suo conto "(ingrosso)". Il giro serale saltava solo la riga del cliente, e la riga
// del venditore la chiudeva e la trasmetteva lo stesso.
// Guasto vero, 15-16/11/2026: SPIRITUAL SRL (QUICK, auto distinta spenta) crea 106 GLS NI W LIGHT domenica
// mattina; alle 22:00 il giro mette la riga di Wave ship nella distinta 80883 e manda la chiusura a GLS. I pacchi
// risultano spediti senza essere partiti, QUICK non trova la distinta (e' di Wave), e l'annullo viene rifiutato
// perche' "GLS gia' trasmessa".
//
// Qui le due regole che il giro serale (app/api/distinte/chiusura-automatica) applica a tutte le righe:
//  1. FERME: ogni riga, di qualunque master, di un pacco nato da un cliente spento che il cliente non ha ancora
//     chiuso in distinta. Il giro non le tocca.
//  2. DA RIPRENDERE: quando il cliente chiude a mano la sua distinta, le righe dei venditori di quei pacchi
//     restano aperte, perche' le chiusure a mano attestano solo la gamba-ponte (chiudiDistintaMoovexpress) e la
//     riga del venditore la chiude solo il giro serale. Senza questa regola il corriere non riceverebbe mai i
//     pacchi dei clienti spenti. Si riprendono la sera stessa, come succede ai clienti con l'auto distinta accesa
//     che chiudono a mano di giorno, anche se le righe sono piu' vecchie della finestra di 3 giorni: e' il
//     cliente ad averle chiuse.
// Il cliente che conta e' quello della riga da cui nasce il pacco (l'originante): e' l'unica riga intestata a un
// cliente vero, le altre sono intestate ai conti "(ingrosso)" dei master.

const STATI_IN_ANNULLO = ['annullata', 'annullamento_pending', 'annullamento_manuale']
const COLONNE_GIRO = 'id,master_id,cliente_id,corriere_id,colli,peso_reale,costo_totale,created_at'
// Oltre questi livelli la catena e' sporca: le catene vere hanno 2 o 3 righe.
const LIVELLI_MAX = 6

export async function clientiAutodistintaSpenta(db: any): Promise<Set<string>> {
  // Una lettura fallita deve fermare il giro: con l'elenco vuoto chiuderebbe proprio i clienti spenti.
  const { data, error } = await db.from('clienti').select('id').eq('impostazioni->>autodistinta', 'no')
  if (error) throw new Error('clienti con auto distinta spenta non letti: ' + error.message)
  return new Set((data || []).map((c: any) => String(c.id)))
}

// Le righe dei venditori sotto le righe date, a ogni livello, seguendo venditore_spedizione_id.
async function righeDeiVenditori(db: any, partenze: { id: string; venditore: string | null }[]): Promise<string[]> {
  const trovate: string[] = []
  const viste = new Set(partenze.map(p => String(p.id)))
  let daLeggere = [...new Set(partenze.map(p => p.venditore).filter(Boolean).map(String))].filter(id => !viste.has(id))
  for (let livello = 0; livello < LIVELLI_MAX && daLeggere.length; livello++) {
    const prossimi: string[] = []
    for (let i = 0; i < daLeggere.length; i += 200) {
      const { data, error } = await db.from('spedizioni')
        .select('id,venditore:raw_response->>venditore_spedizione_id').in('id', daLeggere.slice(i, i + 200))
      if (error) throw new Error('righe dei venditori non lette: ' + error.message)
      for (const r of (data || [])) {
        const id = String(r.id)
        if (viste.has(id)) continue
        viste.add(id)
        trovate.push(id)
        if (r.venditore && !viste.has(String(r.venditore))) prossimi.push(String(r.venditore))
      }
    }
    daLeggere = [...new Set(prossimi)]
  }
  return trovate
}

// Le righe dei clienti spenti, a pagine (sono centinaia la settimana, ma una pagina sola si ferma a 1.000).
async function righeDeiClienti(db: any, clienti: string[], filtro: (q: any) => any, colonne: string): Promise<any[]> {
  const out: any[] = []
  for (let c = 0; c < clienti.length; c += 100) {
    for (let da = 0; ; da += 1000) {
      const { data, error } = await filtro(db.from('spedizioni').select(colonne).in('cliente_id', clienti.slice(c, c + 100)))
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(da, da + 999)
      if (error) throw new Error('spedizioni dei clienti con auto distinta spenta non lette: ' + error.message)
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
  }
  return out
}

// REGOLA 1. `dal`: la riga del cliente nasce pochi secondi dopo quelle dei venditori, quindi basta partire un
// giorno prima della finestra del giro per coprire ogni riga di venditore che il giro legge.
// Tutti gli stati, annullate comprese: se la riga del cliente e' annullata o in annullo, la riga del venditore
// rimasta aperta trasmetterebbe al corriere un pacco annullato.
export async function righeFermePerAutodistinta(db: any, clientiSpenti: Set<string>, dal: Date): Promise<Set<string>> {
  const ferme = new Set<string>()
  if (!clientiSpenti.size) return ferme
  const aperte = await righeDeiClienti(db, [...clientiSpenti],
    q => q.is('distinta_id', null).gte('created_at', dal.toISOString()),
    'id,venditore:raw_response->>venditore_spedizione_id')
  for (const id of await righeDeiVenditori(db, aperte)) ferme.add(id)
  return ferme
}

// REGOLA 2. Le distinte chiuse a mano dai clienti spenti dal `chiuseDal` al `taglio` del giro (gli stessi tre
// giorni della finestra delle spedizioni); le righe dei clienti si cercano fra le ultime 30 giornate, come i resi.
// Si torna con le colonne che il giro usa per raggruppare, solo per le righe ancora senza distinta e non in annullo.
export async function righeDaRiprendereDopoChiusuraAMano(
  db: any, clientiSpenti: Set<string>, opz: { chiuseDal: Date; taglio: Date; righeDal: Date },
): Promise<any[]> {
  if (!clientiSpenti.size) return []
  const chiuse = await righeDeiClienti(db, [...clientiSpenti],
    q => q.not('distinta_id', 'is', null).gte('created_at', opz.righeDal.toISOString()),
    'id,distinta_id,venditore:raw_response->>venditore_spedizione_id')
  const conVenditore = chiuse.filter((r: any) => r.venditore)
  if (!conVenditore.length) return []

  // Quando e' nata la distinta: per id, non per cliente, perche' una distinta del master puo' tenere piu' clienti.
  const distinteIds = [...new Set(conVenditore.map((r: any) => String(r.distinta_id)))]
  const recenti = new Set<string>()
  for (let i = 0; i < distinteIds.length; i += 200) {
    const { data, error } = await db.from('distinte').select('id,created_at').in('id', distinteIds.slice(i, i + 200))
    if (error) throw new Error('distinte dei clienti con auto distinta spenta non lette: ' + error.message)
    for (const d of (data || [])) {
      const t = new Date(d.created_at).getTime()
      if (t >= opz.chiuseDal.getTime() && t < opz.taglio.getTime()) recenti.add(String(d.id))
    }
  }
  const partenze = conVenditore.filter((r: any) => recenti.has(String(r.distinta_id)))
  const venditori = await righeDeiVenditori(db, partenze)
  const out: any[] = []
  for (let i = 0; i < venditori.length; i += 200) {
    const { data, error } = await db.from('spedizioni').select(COLONNE_GIRO)
      .in('id', venditori.slice(i, i + 200)).is('distinta_id', null)
      .not('stato', 'in', `(${STATI_IN_ANNULLO.join(',')})`)
    if (error) throw new Error('righe dei venditori da riprendere non lette: ' + error.message)
    out.push(...(data || []))
  }
  return out.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
}
