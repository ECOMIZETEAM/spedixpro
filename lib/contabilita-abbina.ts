// L'ABBINAMENTO fra i bonifici dell'estratto conto e le ricariche del portale (lib/contabilita-banca).
// Regole di Lorenzo (10/11/2026):
//  - si cercano in banca solo le ricariche pagate con bonifico (o di prima che esistesse il campo);
//  - un bonifico e' di un cliente SOLO se il nome corrisponde: un nome salvato in "Chi paga i bonifici"
//    (o il suo IBAN), oppure il nome del cliente stesso ("se ricarica Ecomize LL e arriva un bonifico
//    chiamato Ecomize LL allora ok"). "Non deve matchare i nomi che non corrispondono": niente nomi che si
//    somigliano, niente causale, niente importo e data da soli. Quando il nome corrisponde, si abbina da solo;
//  - gli altri bonifici restano senza cliente: il master sceglie di chi sono, e il nome con l'IBAN restano
//    fra i pagatori di quel cliente.
// Casi veri di ottobre: SALVATORE PELLE paga "ricarica conto Giulia Arioldi" (lo riconosce solo il pagatore
// salvato); LA MARCA SERVICES (sul bonifico "LA MARCA SERVICES DI LA MARCA CARMINE") fa un bonifico per tutte le ricariche del giorno, "Ricarica prepagato del
// 06/10/2026" = 4 ricariche da 50 €; il solo importo sbaglia (500 € di POSTA CENTRALE DI STALLONE sarebbero
// finiti sulla ricarica da 500 € di CAROVILLA dello stesso giorno); un nome simile sbaglia ("NS CONSULTING
// SRL" non e' "MD CONSULTING").

export type Target = { tipo: 'cliente' | 'master', id: string }
export type RicaricaAperta = { id: string, target_tipo: 'cliente' | 'master', target_id: string, importo: number, giorno: string }
export type PagatoreNoto = { target_tipo: 'cliente' | 'master', target_id: string, nome: string, iban: string | null }
export type Anagrafica = { tipo: 'cliente' | 'master', id: string, nome: string }
export type Entrata = { id: string, data: string, nome: string, causale: string, iban: string | null, importo: number }

// 'iban' / 'pagatore' = fra i nomi salvati del cliente; 'cliente' = e' il nome del cliente stesso.
// 'ignoto' con piu' clienti in `omonimi`: il nome corrisponde a piu' clienti (es. due anagrafiche
// "LA NUOVA POSTA SNC") e nessuna ricarica dice quale: lo sceglie il master.
export type Proposta =
  | { esito: 'sicuro', target: Target, ricariche: string[], perche: 'iban' | 'pagatore' | 'cliente' }
  | { esito: 'ignoto', omonimi: Target[] }

const GIORNO = 86400000
const g = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z') / GIORNO
const cent = (x: number) => Math.round(x * 100)

/** Il nome per confrontarlo: maiuscole, senza accenti e punteggiatura ("R.I.A.M." = "R I A M"). */
export function norma(s: string): string {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' E ').replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

// In coda al nome la banca scrive la forma societaria ("S.R.L.S.", "& C. S.A.S."), in testa a volte "DITTA":
// non fanno parte del nome. Si tolgono le parole di coda finche' sono di questo elenco.
const FORME = new Set('S R L SRL SRLS SNC SAS SPA SS C E SOCIETA A RESPONSABILITA RESPONSABILI LIMITATA SEMPLIFICATA SEMPLIFIC COOPERATIVA'.split(' '))
function nomeNudo(s: string): string {
  const p = norma(s).replace(/^DITTA /, '').split(' ')
  while (p.length > 1 && FORME.has(p[p.length - 1])) p.pop()
  return p.join(' ')
}

/** Il nome del bonifico CORRISPONDE a questo nome: uguali a meno di forma societaria, punteggiatura e ordine
 *  delle parole ("RULLO GIULIANA" = "Giuliana Rullo", "MAYLING S.R.L.S." = "MAYLING"). Nient'altro.
 *  Non basta che il bonifico cominci col nome del cliente: "POSTA CENTRALE DI MIRKO CALASSO" non e' il
 *  cliente "POSTA CENTRALE" (Calasso ha il suo, "Posta Centrale Calasso"); ottobre, 10 bonifici sbagliati. */
export function corrisponde(nome: string, nomeBonifico: string): boolean {
  const a = nomeNudo(nome), b = nomeNudo(nomeBonifico)
  if (a.length < 3 || !b) return false
  if (a === b) return true
  const ordinato = (x: string) => x.split(' ').sort().join(' ')
  return ordinato(a) === ordinato(b)
}

/** Le ricariche aperte del cliente pagate da questo bonifico, o null. Le ricariche arrivano in ordine di ora.
 *  0. se la causale scrive una data della finestra ("Ricarica prepagato del 01/10/2026") decide lei, e basta:
 *     una ricarica di quel giorno dello stesso importo, altrimenti le ricariche ancora da pagare consecutive
 *     che finiscono a quel giorno (o prima) e sommano l'importo. LA MARCA SERVICES paga cosi': 155 € "del
 *     20/10" = 50+50 del 19/10 e 15+40 del 20/10. Guardando solo quel giorno tre suoi bonifici di ottobre
 *     restavano senza ricarica, e quello "del 28/10" si prendeva la ricarica da 100 € del 27/10, che era
 *     dentro i 220 € "del 27/10". Se niente torna il bonifico resta del cliente senza ricarica, da guardare:
 *     ripiegare sul "piu' vicino" contraddirebbe la causale;
 *  1. una ricarica dello stesso importo, la piu' vicina (prima quelle fatte prima del bonifico);
 *  2. le ricariche di un giorno qualsiasi della finestra che sommano l'importo, il piu' vicino.
 *  La finestra va da 12 giorni prima del bonifico a 2 dopo (si ricarica anche quando il bonifico e' gia' arrivato). */
export function ricarichePagate(e: Entrata, aperte: RicaricaAperta[]): string[] | null {
  const dE = g(e.data)
  const nella = aperte.filter(r => { const dd = dE - g(r.giorno); return dd >= -2 && dd <= 12 })
  if (!nella.length) return null
  const perGiorno = new Map<string, RicaricaAperta[]>()
  for (const r of nella) { const k = r.giorno.slice(0, 10); if (!perGiorno.has(k)) perGiorno.set(k, []); perGiorno.get(k)!.push(r) }
  const somma = (l: RicaricaAperta[]) => l.reduce((t, r) => t + cent(r.importo), 0)
  const m = e.causale.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  const giornoCausale = m ? `${m[3]}-${m[2]}-${m[1]}` : ''
  if (giornoCausale && dE - g(giornoCausale) >= -2 && dE - g(giornoCausale) <= 12) {
    const una = (perGiorno.get(giornoCausale) || []).find(r => cent(r.importo) === cent(e.importo))
    if (una) return [una.id]
    // sort stabile: dentro lo stesso giorno resta l'ordine dell'ora
    const fino = nella.filter(r => r.giorno.slice(0, 10) <= giornoCausale).sort((a, b) => g(a.giorno) - g(b.giorno))
    for (let j = fino.length - 1; j >= 0; j--) {
      let t = 0
      for (let i = j; i >= 0; i--) {
        t += cent(fino[i].importo)
        if (t === cent(e.importo)) return fino.slice(i, j + 1).map(r => r.id)
        if (t > cent(e.importo)) break
      }
    }
    return null
  }
  const stesso = nella.filter(r => cent(r.importo) === cent(e.importo))
    .sort((a, b) => {
      const da = dE - g(a.giorno), db = dE - g(b.giorno)
      return (da < 0 ? 1 : 0) - (db < 0 ? 1 : 0) || Math.abs(da) - Math.abs(db)
    })
  if (stesso.length) return [stesso[0].id]
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
  const perIban = new Map<string, Set<string>>()
  for (const p of pagatori) if (p.iban) { if (!perIban.has(p.iban)) perIban.set(p.iban, new Set()); perIban.get(p.iban)!.add(chiaveDi(p)) }
  const daChiave = (t: string): Target => { const [tipo, id] = t.split(':'); return { tipo: tipo as Target['tipo'], id } }
  const esiti = new Map<string, Proposta>()
  for (const e of [...entrate].sort((a, b) => a.data.localeCompare(b.data))) {
    if (!(e.importo > 0) || !e.iban) continue
    // Chi puo' essere, in ordine: l'IBAN salvato, il nome salvato fra i pagatori, il nome del cliente.
    const dallIban = [...(perIban.get(e.iban) || [])]
    const dalPagatore = [...new Set(pagatori.filter(p => corrisponde(p.nome, e.nome)).map(chiaveDi))]
    const dalCliente = anagrafiche.filter(a => corrisponde(a.nome, e.nome)).map(chiaveAnag)
    const [candidati, perche] = dallIban.length ? [dallIban, 'iban' as const]
      : dalPagatore.length ? [dalPagatore, 'pagatore' as const]
      : [dalCliente, 'cliente' as const]
    if (!candidati.length) { esiti.set(e.id, { esito: 'ignoto', omonimi: [] }); continue }
    // Uno solo: e' lui. Piu' d'uno (stesso nome su due clienti): decide la ricarica pagata, se e' una sola.
    let t: string | null = candidati.length === 1 ? candidati[0] : null
    let ric: string[] | null = t ? ricarichePagate(e, apertePer(t)) : null
    if (!t) {
      const conRicarica = candidati.map(c => ({ c, r: ricarichePagate(e, apertePer(c)) })).filter(x => x.r)
      if (conRicarica.length === 1) { t = conRicarica[0].c; ric = conRicarica[0].r }
    }
    if (!t) { esiti.set(e.id, { esito: 'ignoto', omonimi: candidati.map(daChiave) }); continue }
    ;(ric || []).forEach(id => usate.add(id))
    esiti.set(e.id, { esito: 'sicuro', target: daChiave(t), ricariche: ric || [], perche })
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
