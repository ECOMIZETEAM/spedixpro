// DAL CODICE LETTO ALLA SPEDIZIONE.
//
// Il codice a barre di un'etichetta non sempre e' il numero della spedizione. Visti sui dati veri
// (15/10/2026):
// - Poste, UPS, InPost, FedEx, i nostri interni: il codice e' il numero (o il tracking);
// - SDA EXPRESS L, colli dal secondo in poi: un codice lungo che CONTIENE la LDV
//   ("224JMGH1D282224J037158" -> 282224J037158); i DataMatrix sono stringhe con separatori;
// - BRT diretto: il codice del collo e' il parcelID (18 cifre), salvato in raw_response;
// - GLS: in archivio il numero ha davanti la sigla della sede ("NN669062651"), l'etichetta puo'
//   portare solo le cifre.
// Si prova in quest'ordine, dal riconoscimento piu' sicuro al meno sicuro, e ci si ferma al primo
// che trova qualcosa. Una corrispondenza che indica due pacchi diversi non vale: meglio "non
// riconosciuto" (si scrive il numero) che un reso registrato sul pacco sbagliato.

// Finestra per le ricerche che non usano un indice: un reso rientra entro qualche mese dalla partenza.
const GIORNI_INDIETRO = 180

function pezzi(codici: string[]): string[] {
  const out = new Set<string>()
  for (const c of (codici || []).slice(0, 12)) {
    const pulito = String(c || '').replace(/[\x00-\x1f\x7f]+/g, '|').toUpperCase()
    for (const p of [pulito, ...pulito.split(/[|;,\s]+/)]) {
      const t = p.trim()
      // Solo lettere, cifre e trattino: il resto non compare in nessun numero di spedizione, e cosi'
      // un codice letto non puo' diventare un filtro della query.
      if (/^[A-Z0-9][A-Z0-9-]{4,59}$/.test(t)) out.add(t)
    }
  }
  return [...out]
}

async function perColonna(admin: any, campi: string, colonna: string, valori: string[]): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < valori.length; i += 150) {
    const { data } = await admin.from('spedizioni').select(campi).in(colonna, valori.slice(i, i + 150))
    out.push(...(data || []))
  }
  return out
}

function unisci(...liste: any[][]): any[] {
  const m = new Map<string, any>()
  for (const l of liste) for (const r of l) m.set(r.id, r)
  return [...m.values()]
}

// Lo stesso pacco puo' avere piu' righe (le gambe di un contratto condiviso, stesso tracking): e' un
// pacco solo. Due tracking diversi invece sono due pacchi: ambiguo.
const unPaccoSolo = (righe: any[]) => new Set(righe.map(r => r.tracking_number || r.numero)).size === 1

export type EsitoCodice = { righe: any[]; codice: string | null; ambiguo?: boolean }

export async function spedizioniDaCodici(admin: any, codici: string[], campi: string): Promise<EsitoCodice> {
  const tok = pezzi(codici)
  if (!tok.length) return { righe: [], codice: null }
  // `campi` deve contenere numero e tracking_number: servono per dire quale codice ha trovato il pacco.

  // 1. Il codice e' il numero o il tracking.
  const esatte = unisci(await perColonna(admin, campi, 'numero', tok), await perColonna(admin, campi, 'tracking_number', tok))
  if (esatte.length) {
    // Piu' codici nello stesso fotogramma possono indicare pacchi diversi (due etichette inquadrate
    // insieme): si tiene il pacco del primo codice che ne trova uno.
    for (const t of tok) {
      const sue = esatte.filter(r => String(r.numero || '').toUpperCase() === t || String(r.tracking_number || '').toUpperCase() === t)
      if (sue.length) {
        const trk = sue[0].tracking_number || sue[0].numero
        return { righe: esatte.filter(r => (r.tracking_number || r.numero) === trk), codice: t }
      }
    }
  }

  const dal = new Date(Date.now() - GIORNI_INDIETRO * 864e5).toISOString()

  // 2. Il numero sta DENTRO un codice piu' lungo (SDA multicollo, codici 2D, parcelID BRT del primo collo).
  // Pezzi da 11 caratteri in su: i numeri piu' corti che abbiamo (GLS, interni) ne hanno 11, e un pezzo
  // piu' corto rischierebbe di coincidere per caso con un'altra spedizione.
  const sotto = new Set<string>()
  for (const t of tok.filter(x => x.length >= 12)) {
    for (let len = Math.min(t.length - 1, 24); len >= 11; len--) {
      for (let i = 0; i + len <= t.length; i++) sotto.add(t.slice(i, i + len))
    }
  }
  if (sotto.size) {
    const lista = [...sotto].slice(0, 1500)
    const righe = unisci(await perColonna(admin, campi, 'tracking_number', lista), await perColonna(admin, campi, 'numero', lista))
    if (righe.length) {
      // Vince la corrispondenza piu' lunga: e' quella che dice di piu' sul pacco.
      const lungh = (r: any) => Math.max(sotto.has(String(r.tracking_number || '')) ? String(r.tracking_number).length : 0, sotto.has(String(r.numero || '')) ? String(r.numero).length : 0)
      const max = Math.max(...righe.map(lungh))
      const migliori = righe.filter(r => lungh(r) === max)
      return unPaccoSolo(migliori) ? { righe: migliori, codice: tok.find(t => t.length >= 12) || null } : { righe: [], codice: null, ambiguo: true }
    }
  }

  // 3. BRT diretto, colli dal secondo in poi: il codice e' il parcelID del collo (18 cifre) e non contiene
  // il numero della spedizione. Si cerca fra i parcelID salvati: nessun indice, quindi solo qui, dopo le
  // ricerche veloci, e nella finestra dei mesi recenti. (Il primo collo lo trova gia' il passo 2: il suo
  // parcelID comincia col numero.)
  for (const t of tok.filter(x => /^\d{14,18}$/.test(x))) {
    const { data } = await admin.from('spedizioni').select(campi).gte('created_at', dal).contains('raw_response', { parcelIDs: [t] }).limit(5)
    const righe = data || []
    if (righe.length) return unPaccoSolo(righe) ? { righe, codice: t } : { righe: [], codice: t, ambiguo: true }
  }

  // 4. GLS: le 9 cifre del collo senza la sigla della sede davanti ("NN669062651" -> 669062651), con o
  // senza una cifra di controllo in coda. Vale solo per numeri nella forma GLS (due lettere + 9 cifre):
  // un altro codice di sole cifre (il CAP di un'etichetta SDA e' "CAP+0000") non deve finire su un pacco.
  for (const t of tok.filter(x => /^\d{9,10}$/.test(x))) {
    const cifre = t.slice(0, 9)
    const { data } = await admin.from('spedizioni').select(campi).gte('created_at', dal).like('tracking_number', `%${cifre}`).limit(10)
    const righe = (data || []).filter((r: any) => new RegExp(`^[A-Z]{2}${cifre}$`).test(String(r.tracking_number || '').toUpperCase()))
    if (righe.length) return unPaccoSolo(righe) ? { righe, codice: t } : { righe: [], codice: t, ambiguo: true }
  }

  return { righe: [], codice: null }
}

// Per il registro: un codice non riconosciuto si scrive cosi' com'e' se e' corto; i DataMatrix lunghi
// portano nomi e indirizzi, e di quelli si scrive solo la lunghezza.
export function codiciPerRegistro(codici: string[]): string {
  return (codici || []).slice(0, 12).map(c => {
    const s = String(c || '').trim()
    return s.length <= 40 && /^[A-Za-z0-9-]+$/.test(s) ? s : `[${s.length} caratteri]`
  }).join(' | ')
}
