// L'ABBINAMENTO fra i bonifici dell'estratto conto e le ricariche del portale (lib/contabilita-banca).
// Regole decise con Lorenzo il 10/11/2026:
//  - si cercano in banca solo le ricariche pagate con bonifico (o di prima che esistesse il campo);
//  - abbinamento SICURO (chi paga e' gia' noto: stesso IBAN o stesso nome fra i pagatori del cliente) = da solo;
//  - abbinamento PROBABILE (il nome del cliente si legge nel bonifico) = lo conferma il master con un clic;
//  - bonifico di cui non si sa chi sia = si mostra e basta, il master sceglie il cliente;
//  - quando il master conferma, il nome e l'IBAN del bonifico restano fra i pagatori del cliente.
// Casi veri di ottobre su cui e' tarato: SALVATORE PELLE paga "ricarica conto Giulia Arioldi" (il nome del
// cliente non c'entra: serve il pagatore salvato); LA MARCA SERVICES fa un bonifico per tutte le ricariche
// del giorno, "Ricarica prepagato del 06/10/2026" = 4 ricariche da 50 €; il solo importo non basta (500 € di
// POSTA CENTRALE DI STALLONE sarebbero finiti sulla ricarica da 500 € di CAROVILLA dello stesso giorno).

export type Target = { tipo: 'cliente' | 'master', id: string }
export type RicaricaAperta = { id: string, target_tipo: 'cliente' | 'master', target_id: string, importo: number, giorno: string }
export type PagatoreNoto = { target_tipo: 'cliente' | 'master', target_id: string, nome: string, iban: string | null }
export type Anagrafica = { tipo: 'cliente' | 'master', id: string, nome: string }
export type Entrata = { id: string, data: string, nome: string, causale: string, iban: string | null, importo: number }

export type Proposta =
  | { esito: 'sicuro', target: Target, ricariche: string[], perche: 'iban' | 'nome' }
  | { esito: 'probabile', target: Target, ricariche: string[] }
  | { esito: 'ignoto', suggerimento: { target: Target, ricarica: string } | null }

const GIORNO = 86400000
const g = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z') / GIORNO
const cent = (x: number) => Math.round(x * 100)

/** Il nome per confrontarlo: maiuscole, senza accenti e punteggiatura ("R.I.A.M." = "R I A M"). */
export function norma(s: string): string {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' E ').replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

// Parole che non dicono chi e': forme societarie, articoli, e quelle che hanno in tanti
// ("POSTA CENTRALE" sono decine di clienti di Ecomize).
const VUOTE = new Set(('SRL SRLS SNC SAS SPA SS DI DE DEL DELLA DELLE E C A IL LA LE LO GLI SOCIETA RESPONSABILITA LIMITATA ' +
  'SEMPLIFICATA SEMPLIFIC RESPONSABILI COOPERATIVA DITTA SERVICE SERVICES POSTA POSTE CENTRALE RICARICA CONTO CREDITO ' +
  'SPEDIZIONI SPEDIZIONE PLAFOND PIATTAFORMA EXPRESS LOGISTICA SERVIZI').split(' '))
const parole = (s: string) => norma(s).split(' ').filter(w => w.length >= 3 && !VUOTE.has(w))

// Forme societarie in coda e "DITTA" in testa non fanno parte del nome ("R.I.A.M. LOGISTICA S.R.L.S.").
const CODA = /( (S R L S|S R L|SRLS|SRL|S N C|SNC|S A S|SAS|S P A|SPA|S S|SOCIETA A RESPONSABILITA LIMITATA( SEMPLIFICATA)?))+$/
const nomeNudo = (s: string) => norma(s).replace(/^DITTA /, '').replace(CODA, '').trim()

/** Il nome del cliente si legge nel bonifico (nome o causale). Vale se il nome compare per intero
 *  ("LA MARCA SERVICES" dentro "LA MARCA SERVICES DI LA MARCA CARMINE"), oppure se ci sono tutte le sue
 *  parole distintive e sono almeno due. Una parola sola non basta: "NS CONSULTING SRL" non e' "MD CONSULTING".
 *  E ci vuole almeno una parola che non hanno in tanti: "POSTA CENTRALE" da solo non dice chi e'. */
function nomeClienteNelBonifico(cliente: string, e: Entrata): boolean {
  const p = parole(cliente)
  if (!p.some(w => w.length >= 4)) return false
  const testo = ` ${norma(e.nome + ' ' + e.causale)} `
  const intero = nomeNudo(cliente)
  if (intero.length >= 5 && testo.includes(` ${intero} `)) return true
  const presenti = new Set(parole(e.nome + ' ' + e.causale))
  return p.length >= 2 && p.every(w => presenti.has(w))
}

/** Le ricariche aperte del cliente pagate da questo bonifico, o null.
 *  1. una ricarica dello stesso importo, la piu' vicina (prima quelle fatte prima del bonifico);
 *  2. le ricariche del giorno scritto in causale ("Ricarica prepagato del 06/10/2026") che sommano l'importo;
 *  3. le ricariche di un giorno qualsiasi della finestra che sommano l'importo, il piu' vicino.
 *  La finestra va da 12 giorni prima del bonifico a 2 dopo (si ricarica anche quando il bonifico e' gia' arrivato). */
export function ricarichePagate(e: Entrata, aperte: RicaricaAperta[]): string[] | null {
  const dE = g(e.data)
  const nella = aperte.filter(r => { const dd = dE - g(r.giorno); return dd >= -2 && dd <= 12 })
  if (!nella.length) return null
  const stesso = nella.filter(r => cent(r.importo) === cent(e.importo))
    .sort((a, b) => {
      const da = dE - g(a.giorno), db = dE - g(b.giorno)
      return (da < 0 ? 1 : 0) - (db < 0 ? 1 : 0) || Math.abs(da) - Math.abs(db)
    })
  if (stesso.length) return [stesso[0].id]
  const perGiorno = new Map<string, RicaricaAperta[]>()
  for (const r of nella) { const k = r.giorno.slice(0, 10); if (!perGiorno.has(k)) perGiorno.set(k, []); perGiorno.get(k)!.push(r) }
  const somma = (l: RicaricaAperta[]) => l.reduce((t, r) => t + cent(r.importo), 0)
  const m = e.causale.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) {
    const l = perGiorno.get(`${m[3]}-${m[2]}-${m[1]}`)
    if (l && l.length > 1 && somma(l) === cent(e.importo)) return l.map(r => r.id)
  }
  const giorni = [...perGiorno.keys()].sort((a, b) => Math.abs(dE - g(a)) - Math.abs(dE - g(b)))
  for (const k of giorni) {
    const l = perGiorno.get(k)!
    if (l.length > 1 && somma(l) === cent(e.importo)) return l.map(r => r.id)
  }
  return null
}

// Chi e' ricaricato o paga, come "cliente:<id>" o "master:<id>". Le ricariche e i pagatori lo hanno in
// target_tipo/target_id; le anagrafiche in tipo/id. Tenute separate: una ricarica ha anche un suo id.
const chiaveDi = (x: { target_tipo: string, target_id: string }) => `${x.target_tipo}:${x.target_id}`
const chiaveAnag = (a: Anagrafica) => `${a.tipo}:${a.id}`

/** Le proposte per i bonifici in entrata ancora senza cliente, dal piu' vecchio. Le ricariche usate da una
 *  proposta non si propongono per un altro bonifico. Le entrate senza IBAN (rimborsi della carta) non sono
 *  pagamenti di clienti e restano fuori. */
export function proponi(entrate: Entrata[], aperte: RicaricaAperta[], pagatori: PagatoreNoto[], anagrafiche: Anagrafica[]): Map<string, Proposta> {
  const usate = new Set<string>()
  const apertePer = (t: string) => aperte.filter(r => !usate.has(r.id) && chiaveDi(r) === t)
  const perIban = new Map<string, Set<string>>(), perNome = new Map<string, Set<string>>()
  for (const p of pagatori) {
    const t = chiaveDi(p)
    if (p.iban) { if (!perIban.has(p.iban)) perIban.set(p.iban, new Set()); perIban.get(p.iban)!.add(t) }
    const n = norma(p.nome); if (!perNome.has(n)) perNome.set(n, new Set()); perNome.get(n)!.add(t)
  }
  const daChiave = (t: string): Target => { const [tipo, id] = t.split(':'); return { tipo: tipo as Target['tipo'], id } }
  const esiti = new Map<string, Proposta>()
  for (const e of [...entrate].sort((a, b) => a.data.localeCompare(b.data))) {
    if (!(e.importo > 0) || !e.iban) continue
    // 1. chi paga e' gia' noto: stesso IBAN, oppure stesso nome, fra i pagatori di UN solo cliente
    const dallIban = e.iban ? perIban.get(e.iban) : undefined
    const dalNome = perNome.get(norma(e.nome))
    const noti = dallIban?.size === 1 ? dallIban : dalNome?.size === 1 ? dalNome : null
    if (noti) {
      const t = [...noti][0]
      const ric = ricarichePagate(e, apertePer(t)) || []
      ric.forEach(id => usate.add(id))
      esiti.set(e.id, { esito: 'sicuro', target: daChiave(t), ricariche: ric, perche: dallIban?.size === 1 ? 'iban' : 'nome' })
      continue
    }
    // 2. il nome del cliente si legge nel bonifico: va confermato. Se i clienti possibili sono piu'
    //    d'uno vince quello che ha una ricarica pagata da questo bonifico, altrimenti non si propone.
    const possibili = anagrafiche.filter(a => nomeClienteNelBonifico(a.nome, e))
    const conRicarica = possibili.map(a => ({ a, ric: ricarichePagate(e, apertePer(chiaveAnag(a))) })).filter(x => x.ric)
    const scelto = possibili.length === 1 ? { a: possibili[0], ric: conRicarica[0]?.ric || null } : conRicarica.length === 1 ? conRicarica[0] : null
    if (scelto) {
      const ric = scelto.ric || []
      ric.forEach(id => usate.add(id))
      esiti.set(e.id, { esito: 'probabile', target: { tipo: scelto.a.tipo, id: scelto.a.id }, ricariche: ric })
      continue
    }
    // 3. non si sa di chi e'. Se c'e' una sola ricarica aperta dello stesso importo nei giorni vicini la si
    //    suggerisce, ma non si propone di confermarla con un clic: col solo importo si sbaglia spesso.
    const uguali = aperte.filter(r => !usate.has(r.id) && cent(r.importo) === cent(e.importo) && Math.abs(g(e.data) - g(r.giorno)) <= 3)
    esiti.set(e.id, { esito: 'ignoto', suggerimento: uguali.length === 1 ? { target: daChiave(chiaveDi(uguali[0])), ricarica: uguali[0].id } : null })
  }
  return esiti
}

// LE USCITE PER VOCE. Le regole coprono quello che si riconosce dal testo; il resto va sotto il nome di chi
// ha ricevuto i soldi (E.M EXPRESS LTD, 48.000 € a ottobre), e il master puo' dargli una voce sua
// (tabella uscite_voci), che vale per tutti i suoi bonifici.
const REGOLE: [RegExp, string][] = [
  [/CONTRASSEGN/, 'Contrassegni pagati ai clienti'],
  [/RIMBORSO PACCO|RIMBORSO SPEDIZION/, 'Rimborsi ai clienti'],
  [/\bF24\b|AGENZIA ENTRATE|AGENZIA DELLE ENTRATE|\bINPS\b|\bINAIL\b/, 'Tasse e contributi'],
  [/STIPENDI|RETRIBUZION|SALARIO/, 'Stipendi'],
  [/VERCEL|SUPABASE|ANTHROPIC|RESEND|OPENAI|OPENCODE|APPLE COM|GOOGLE|MICROSOFT|NETFLIX|ARUBA|SHOPIFY/, 'Software e abbonamenti'],
  [/AMAZON|EBAY|TIKTOK/, 'Acquisti online'],
  [/PNL FINTECH|FINOM|COMMISSION/, 'Commissioni della banca'],
]
export function voceUscita(r: { nome: string, causale: string, iban: string | null }, personalizzate: Map<string, string>): string {
  const controparte = norma(r.nome)
  const mia = personalizzate.get(controparte)
  if (mia) return mia
  const testo = norma(r.nome + ' ' + r.causale)
  for (const [re, voce] of REGOLE) if (re.test(testo)) return voce
  return r.iban ? `Bonifici a ${r.nome || 'senza nome'}` : 'Spese con carta'
}
