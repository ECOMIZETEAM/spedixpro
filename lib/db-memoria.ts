/* LETTURE CON MEMORIA, PER LA DURATA DI UNA RICHIESTA. E DI SOLA LETTURA.
 *
 * PERCHE' ESISTE. Prezzare UNA spedizione costa centinaia di letture: il motore rilegge listino,
 * fasce, supplementi, zone e catena dei master a ogni chiamata (misurato sui dati di produzione il
 * 13/10/2026, 200 spedizioni: mediana 265 letture per un solo preventivo, fino a 788, e circa sei
 * secondi). Per una spedizione va bene. Per l'anteprima di un
 * import — venti, cento righe dello STESSO cliente — vorrebbe dire rileggere cento volte le stesse
 * righe del listino.
 *
 * La strada facile sarebbe riscrivere il calcolo "a blocchi", coi dati caricati una volta sola. Ma
 * sarebbe un'altra copia della regola dei prezzi, ed e' proprio cosi' che un prezzo mostrato smette
 * di coincidere con quello addebitato (in lib/pricing.ts un calcolatore a blocchi c'e' gia', e il
 * suo stesso commento avverte che da' solo un "prezzo di ripiego"). Qui il calcolo resta QUELLO,
 * riga per riga, con le stesse identiche funzioni dell'addebito: cambia solo che la stessa lettura,
 * dentro la stessa richiesta, si fa una volta e poi si riusa.
 *
 * COME. Avvolge un client Supabase: ogni catena `from(...).select(...).eq(...)` viene registrata
 * passo per passo e parte davvero solo quando la si attende. La chiave della memoria e' la catena
 * stessa (tabella, colonne, filtri, ordinamento, intervallo): due letture identiche condividono la
 * risposta, due letture diverse anche di una virgola no.
 *
 * OGNI CHIAMANTE RICEVE UNA COPIA dei dati, non lo stesso oggetto: se una funzione ritocca le righe
 * che ha letto (un ordinamento sul posto, un campo sovrascritto), un'altra non deve trovarsele
 * cambiate. E' il comportamento di due letture vere, che e' cio' che il resto del codice si aspetta.
 * La copia si fa dal TESTO della risposta, messo da parte una volta sola quando arriva (i dati di
 * PostgREST sono JSON puro): cosi' nasce da cio' che il database ha risposto, non da un oggetto che
 * il primo chiamante puo' nel frattempo aver ritoccato. Il costo e' trascurabile — profilato il
 * 13/10/2026 su un blocco di 13 righe: 0,07 secondi di copie su 10 secondi, il resto e' attesa di
 * rete. Quello che conta e' il numero di letture vere: da 265 a riga (mediana, motore del
 * preventivo da solo) a 16-45 a riga dentro un blocco dello stesso cliente.
 *
 * SOLA LETTURA. Il client avvolto sa fare UNA cosa: from(...) seguito da letture. insert, update,
 * upsert, delete sollevano un errore, e cosi' ogni altra porta del client vero (rpc, schema,
 * storage, functions, auth...): non c'e' un elenco di cose vietate da tenere aggiornato, c'e' un
 * elenco di cose ammesse, lungo una riga. Un'anteprima non deve poter scrivere, nemmeno per sbaglio
 * e nemmeno fra un anno, quando qualcuno aggiungera' una riga a una funzione che oggi legge
 * soltanto: se succede, l'anteprima si rompe con un messaggio chiaro invece di muovere credito in
 * silenzio.
 * LIMITE: la garanzia vale per chi usa il client che RICEVE. Una funzione che se ne crea uno suo
 * (createAdminSupabase() chiamato dentro, come fa lib/cap-speciali.ts) ne resta fuori.
 *
 * SI COMPORTA COME IL COSTRUTTORE VERO. In supabase-js `from(t).select(...)` apre una query, e da
 * li' ogni filtro MODIFICA quella query e la restituisce: `const q = ...select(); q.eq(...); await q`
 * filtra anche senza riassegnare. Qui e' uguale, di proposito — le funzioni dei prezzi sono le
 * stesse dell'addebito, e una differenza nel modo di comporre la query darebbe la creazione giusta
 * e l'anteprima sbagliata senza nessun errore. Gli argomenti si fissano quando il filtro viene
 * scritto (una lista di id ritoccata dopo non cambia la lettura), come fa il client vero.
 *
 * LETTURE FALLITE. Una lettura che torna `error` non si tiene in memoria, e chi la stava aspettando
 * insieme a chi l'ha fatta NON riceve quell'errore: rilegge per conto suo, come sarebbe successo
 * senza memoria. Altrimenti un inciampo solo falserebbe tutte le righe in lavorazione in quel
 * momento. Con `erroreComeEccezione` l'errore viene SOLLEVATO invece che restituito: le funzioni
 * dei prezzi guardano quasi tutte solo `data` e su un errore ripiegano in silenzio (listino non
 * letto = peso volumetrico di default), che per un'anteprima vuol dire mostrare un numero falso.
 * Meglio nessun numero. Fa eccezione "nessuna riga" di single()/maybeSingle() (PGRST116), che per
 * il codice e' una risposta normale.
 * OGGI NESSUNO LA ACCENDE: prima va misurato in produzione che nessuna lettura fallisca sempre per
 * qualche cliente (gli si toglierebbero i prezzi). La rotta dell'anteprima scrive nei log le
 * letture tornate con errore, contate qui in `errori`.
 *
 * NON VA TENUTO FRA UNA RICHIESTA E L'ALTRA: la memoria non scade. Si crea, si usa per un calcolo,
 * si butta. */

type Passo = [string, any[]]

const SCRITTURE = new Set(['insert', 'update', 'upsert', 'delete'])

// `errori`: quante letture VERE sono tornate con `error`, per tabella e codice. Serve a misurare
// prima di decidere (vedi erroreComeEccezione): si riempie solo se qualcosa va storto.
export type ContatoreLetture = { letture: number; riusi: number; errori?: Record<string, number> }

export type OpzioniMemoria = {
  // true = una lettura che torna `error` solleva un'eccezione invece di restituirlo (tranne
  // PGRST116, "nessuna riga"). Chi chiama deve avere un try/catch che la trasformi in "non calcolato".
  erroreComeEccezione?: boolean
}

// La chiave deve distinguere davvero due letture diverse. JSON.stringify da solo confonde
// `undefined`, NaN e Infinity con `null` dentro gli argomenti (diventano tutti "null"), e per
// PostgREST sono filtri diversi. Funzioni e oggetti che non sono dati semplici (Map, Set, segnali di
// annullamento, istanze di classe) non hanno una forma stabile: in quel caso niente memoria.
function chiaveDi(passi: Passo[]): string | null {
  try {
    return JSON.stringify(passi, (_k, v) => {
      if (v === undefined) return '\u0000undefined'
      if (typeof v === 'number' && !Number.isFinite(v)) return '\u0000' + String(v)
      if (typeof v === 'function') throw new Error('non serializzabile')
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const proto = Object.getPrototypeOf(v)
        if (proto !== Object.prototype && proto !== null) throw new Error('non serializzabile')
      }
      return v
    })
  } catch { return null }
}

// Un argomento si FISSA quando il filtro viene scritto: se chi chiama ritocca dopo la sua lista di
// id, la lettura non deve cambiare (il client vero li ha gia' trasformati in testo a quel punto).
function fissa(v: any): any {
  if (v === null || typeof v !== 'object') return v
  try { return structuredClone(v) } catch { return v }
}

// Cio' che si tiene di una lettura: la risposta e, a parte, il TESTO dei suoi dati. Il testo si
// prende appena la risposta arriva, prima di consegnarla a chiunque: cosi' le copie successive
// nascono da li' e non da un oggetto che il primo chiamante puo' nel frattempo aver ritoccato.
type Ricordo = { risposta: any; testo: string | null }

function ricorda(risposta: any): Ricordo {
  const dati = risposta && typeof risposta === 'object' ? risposta.data : undefined
  return { risposta, testo: dati == null ? null : JSON.stringify(dati) }
}

// Per chi RIUSA una lettura gia' fatta: stessa risposta, dati riletti dal testo (una copia sua).
function copiaDi(r: Ricordo): any {
  if (r.testo == null) return r.risposta
  return { ...r.risposta, data: JSON.parse(r.testo) }
}

const NESSUNA_RIGA = 'PGRST116'

export function conMemoria<T = any>(
  client: any,
  contatore: ContatoreLetture = { letture: 0, riusi: 0 },
  opzioni: OpzioniMemoria = {},
): T {
  const memoria = new Map<string, Promise<Ricordo>>()
  const tabellaDi = (passi: Passo[]): string => String(passi[0]?.[1]?.[0] ?? '?')

  const annota = (passi: Passo[], errore: any) => {
    const voce = tabellaDi(passi) + ' ' + (errore?.code || 'senza codice')
    const errori = (contatore.errori = contatore.errori || {})
    errori[voce] = (errori[voce] || 0) + 1
  }

  const leggi = (passi: Passo[]): Promise<any> => {
    const chiave = chiaveDi(passi)
    if (chiave != null) {
      const gia = memoria.get(chiave)
      // Se la lettura che si stava aspettando e' fallita, non si eredita il suo errore: si rilegge.
      // (A questo punto la voce e' gia' stata tolta dalla memoria, quindi parte una lettura vera.)
      if (gia) { contatore.riusi++; return gia.then(r => (r.risposta?.error ? leggi(passi) : copiaDi(r))) }
    }
    contatore.letture++
    let q: any = client
    for (const [metodo, args] of passi) q = q[metodo](...args)
    if (chiave == null) {
      // Lettura senza chiave stabile: niente memoria.
      return Promise.resolve(q).then((r: any) => { if (r?.error) annota(passi, r.error); return r })
    }
    const attesa: Promise<Ricordo> = Promise.resolve(q).then(ricorda)
    memoria.set(chiave, attesa)
    // Una lettura FALLITA non si tiene: e' quasi sempre un inciampo momentaneo, e ricordarla
    // vorrebbe dire dare lo stesso errore a tutte le righe che vengono dopo.
    attesa.then(
      r => { if (r.risposta?.error) { memoria.delete(chiave); annota(passi, r.risposta.error) } },
      () => { memoria.delete(chiave) },
    )
    // Chi fa la lettura per primo riceve la risposta cosi' com'e', come senza memoria.
    return attesa.then(r => r.risposta)
  }

  // `passi` e' una fotografia: la catena da cui nasce puo' ancora essere allungata da chi la tiene.
  const esegui = (passi: Passo[]): Promise<any> => {
    const esito = leggi(passi.slice())
    if (!opzioni.erroreComeEccezione) return esito
    return esito.then((r: any) => {
      if (r?.error && r.error.code !== NESSUNA_RIGA) {
        throw new Error(`[db-memoria] lettura fallita su ${tabellaDi(passi)}: ${r.error.message || r.error.code || 'errore'}`)
      }
      return r
    })
  }

  const catena = (passi: Passo[]): any => {
    const io: any = new Proxy(function () {}, {
      get(_bersaglio, nome) {
        if (typeof nome === 'symbol') return undefined
        // from('tabella') da solo NON si attende, come nel client vero: se rispondesse a `then`, un
        // `await db.from('t')` (o una funzione async che lo restituisce) eseguirebbe il passo sul
        // client vero e consegnerebbe il suo costruttore — da li' una scrittura partirebbe.
        if (passi.length < 2 && (nome === 'then' || nome === 'catch' || nome === 'finally')) return undefined
        if (nome === 'then') return (ok: any, ko: any) => esegui(passi).then(ok, ko)
        if (nome === 'catch') return (ko: any) => esegui(passi).catch(ko)
        if (nome === 'finally') return (f: any) => esegui(passi).finally(f)
        if (SCRITTURE.has(nome)) {
          return () => { throw new Error(`[db-memoria] scrittura non ammessa (${nome} su ${tabellaDi(passi)}): questo client e' di sola lettura`) }
        }
        return (...args: any[]) => {
          const passo: Passo = [nome, args.map(fissa)]
          // from('tabella') e' solo il punto di partenza: ogni select() su di esso apre una query
          // NUOVA, anche nel client vero. E' da li' in poi che la query modifica se stessa.
          if (passi.length < 2) return catena([...passi, passo])
          passi.push(passo)
          return io
        }
      },
    })
    return io
  }

  const vietato = (cosa: string): never => {
    throw new Error(`[db-memoria] ${cosa} non disponibile: questo client e' di sola lettura e sa fare solo from(...)`)
  }
  return new Proxy(client, {
    get(_bersaglio, nome) {
      if (nome === 'from') return (tabella: string) => catena([['from', [tabella]]])
      // `then` e i simboli devono rispondere "non c'e'": JS li cerca su qualunque oggetto che passa
      // da un await o da una funzione async, e un errore qui romperebbe anche chi il client se lo
      // passa soltanto di mano.
      if (typeof nome === 'symbol' || nome === 'then') return undefined
      return vietato(String(nome))
    },
    set(_bersaglio, nome) { return vietato('scrivere ' + String(nome)) },
    defineProperty(_bersaglio, nome) { return vietato('definire ' + String(nome)) },
    deleteProperty(_bersaglio, nome) { return vietato('togliere ' + String(nome)) },
  }) as T
}
