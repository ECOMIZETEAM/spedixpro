// L'ESTRATTO CONTO NEL PORTALE: salvarlo, abbinarlo alle ricariche, raccontarlo al master.
// Le regole dell'abbinamento stanno in lib/contabilita-abbina (pure); qui solo il database.
// Tabelle (scripts/contabilita-banca.sql): estratti_conto, estratti_righe, abbinamenti_bonifici, uscite_voci,
// piu' pagatori_bonifico e ricariche_check del passo 1.
import { fetchAllStretto } from '@/lib/fetch-all'
import { ricordaPagatore, pulisciIban } from '@/lib/contabilita-banca'
import { norma, proponi, ricarichePagate, voceUscita, type Anagrafica, type Entrata, type RicaricaAperta, type Target } from '@/lib/contabilita-abbina'
import type { Estratto } from '@/lib/estratto-finom'

const GIORNO = 86400000
const spostaGiorni = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * GIORNO).toISOString().slice(0, 10)
const r2 = (x: number) => Math.round(x * 100) / 100
const giornoRoma = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
// Un pagatore si riconosce dall'IBAN, se c'e', altrimenti dal nome.
const chiavePagatore = (r: { iban: string | null, nome: string }) => r.iban || 'N:' + norma(r.nome)

/** Un movimento e' sempre lo stesso anche se arriva in due estratti che si sovrappongono: il saldo dopo
 *  il movimento lo distingue da un altro bonifico uguale dello stesso giorno. */
const chiaveRiga = (r: { data: string, importo: number, saldo: number, nome: string }) =>
  `${r.data}|${r.importo.toFixed(2)}|${r.saldo.toFixed(2)}|${norma(r.nome)}`

/** Salva l'estratto e i suoi movimenti; quelli gia' caricati con un estratto precedente si saltano. */
export async function salvaEstratto(admin: any, masterId: string, e: Estratto, nomeFile: string, userId: string) {
  const { data: est, error } = await admin.from('estratti_conto').insert({
    master_id: masterId, banca: e.banca, conto_iban: e.contoIban, intestatario: e.intestatario,
    dal: e.dal, al: e.al, saldo_iniziale: e.saldoIniziale, saldo_finale: e.saldoFinale,
    n_righe: e.righe.length, nome_file: nomeFile.slice(0, 200), caricato_da: userId,
  }).select('id').single()
  if (error) throw new Error(error.message)
  let nuove = 0
  for (let i = 0; i < e.righe.length; i += 500) {
    const blocco = e.righe.slice(i, i + 500).map(r => ({
      master_id: masterId, estratto_id: est.id, data: r.data, nome: r.nome, causale: r.causale,
      iban: pulisciIban(r.iban), importo: r.importo, saldo: r.saldo, chiave: chiaveRiga(r),
    }))
    const { data, error: e2 } = await admin.from('estratti_righe')
      .upsert(blocco, { onConflict: 'master_id,chiave', ignoreDuplicates: true }).select('id')
    if (e2) throw new Error(e2.message)
    nuove += (data || []).length
  }
  return { estrattoId: est.id as string, righe: e.righe.length, nuove, giaPresenti: e.righe.length - nuove }
}

/** Clienti e sotto-master diretti del master: fra questi si cerca chi ha pagato. */
async function anagrafiche(admin: any, masterId: string): Promise<Anagrafica[]> {
  const [cli, sub] = await Promise.all([
    fetchAllStretto(() => admin.from('clienti').select('id,ragione_sociale').eq('master_id', masterId).order('id')),
    fetchAllStretto(() => admin.from('masters').select('id,nome').eq('parent_master_id', masterId).order('id')),
  ])
  return [...cli.map((c: any) => ({ tipo: 'cliente' as const, id: c.id, nome: c.ragione_sociale || '' })),
    ...sub.map((m: any) => ({ tipo: 'master' as const, id: m.id, nome: m.nome || '' }))]
}

/** Le ricariche che si aspettano un bonifico (bonifico, o di prima che esistesse il campo) intorno al periodo,
 *  con quelle gia' abbinate segnate. */
async function ricariche(admin: any, masterId: string, dal: string, al: string) {
  const righe = await fetchAllStretto(() => admin.from('ricariche_check')
    .select('id,target_tipo,target_id,target_nome,importo,ricaricato_il,metodo,mittente,bonifico_effettuato_il,bonifico_arrivato_il')
    .eq('master_id', masterId).gte('ricaricato_il', spostaGiorni(dal, -15)).lte('ricaricato_il', spostaGiorni(al, 4))
    .or('metodo.is.null,metodo.eq.bonifico').order('ricaricato_il').order('id'))
  const ids = righe.map((r: any) => r.id)
  const abbinate = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await admin.from('abbinamenti_bonifici').select('ricarica_id,riga_id').in('ricarica_id', ids.slice(i, i + 300))
    if (error) throw new Error(error.message)
    for (const a of data || []) abbinate.set(a.ricarica_id, a.riga_id)
  }
  return righe.map((r: any) => ({ ...r, importo: Number(r.importo), giorno: giornoRoma(r.ricaricato_il), riga_id: abbinate.get(r.id) || null }))
}

async function movimenti(admin: any, masterId: string, dal: string, al: string) {
  const righe = await fetchAllStretto(() => admin.from('estratti_righe')
    .select('id,data,nome,causale,iban,importo,saldo,target_tipo,target_id,assegnato')
    .eq('master_id', masterId).gte('data', dal).lte('data', al).order('data').order('id'))
  return righe.map((r: any) => ({ ...r, importo: Number(r.importo), saldo: Number(r.saldo) }))
}

/** Lega un bonifico alle ricariche che paga, e le segna "arrivate" nel Check Ricariche con la data della
 *  banca. Si ricorda cosa ha segnato lui, per poterlo togliere se l'abbinamento si annulla. */
async function abbina(admin: any, masterId: string, riga: { id: string, data: string }, ric: any[], modo: 'auto' | 'confermato', userId: string | null) {
  for (const r of ric) {
    const segnaEff = !r.bonifico_effettuato_il, segnaArr = !r.bonifico_arrivato_il
    const { error } = await admin.from('abbinamenti_bonifici').insert({
      master_id: masterId, riga_id: riga.id, ricarica_id: r.id, modo,
      segnato_effettuato: segnaEff, segnato_arrivato: segnaArr, creato_da: userId,
    })
    if (error) { if (/duplicate key|23505/.test(error.message)) continue; throw new Error(error.message) }
    const quando = riga.data + 'T12:00:00Z'
    if (segnaEff) await admin.from('ricariche_check').update({ bonifico_effettuato_il: quando }).eq('id', r.id).eq('master_id', masterId).is('bonifico_effettuato_il', null)
    if (segnaArr) await admin.from('ricariche_check').update({ bonifico_arrivato_il: quando }).eq('id', r.id).eq('master_id', masterId).is('bonifico_arrivato_il', null)
  }
}

/** Applica gli abbinamenti SICURI del periodo: bonifici di pagatori gia' noti, e bonifici gia' assegnati a un
 *  cliente che non hanno ancora trovato la loro ricarica (magari fatta dopo). Non chiede niente a nessuno. */
export async function applicaSicuri(admin: any, masterId: string, dal: string, al: string) {
  const [righe, ric, anag, pag] = await Promise.all([
    movimenti(admin, masterId, dal, al), ricariche(admin, masterId, dal, al), anagrafiche(admin, masterId),
    fetchAllStretto(() => admin.from('pagatori_bonifico').select('target_tipo,target_id,nome,iban').eq('master_id', masterId).order('id')),
  ])
  const legate = new Set<string>()
  for (let i = 0; i < righe.length; i += 300) {
    const { data, error } = await admin.from('abbinamenti_bonifici').select('riga_id').in('riga_id', righe.slice(i, i + 300).map(r => r.id))
    if (error) throw new Error(error.message)
    for (const a of data || []) legate.add(a.riga_id)
  }
  const aperte = ric.filter((r: any) => !r.riga_id)
  const perId = new Map(aperte.map((r: any) => [r.id, r]))
  // Pagatori segnati "non e' un cliente", in qualunque mese: i loro bonifici nuovi restano fuori come i vecchi.
  const giaEsclusi = await fetchAllStretto(() => admin.from('estratti_righe').select('nome,iban').eq('master_id', masterId).eq('assegnato', 'escluso').order('id'))
  const esclusi = new Set(giaEsclusi.map((r: any) => chiavePagatore(r)))
  let abbinati = 0, assegnati = 0
  const usate = new Set<string>()
  const daFare = righe.filter(r => r.importo > 0 && r.iban && !r.target_id && !r.assegnato)
  for (const r of daFare) {
    if (!esclusi.has(chiavePagatore(r))) continue
    await admin.from('estratti_righe').update({ assegnato: 'escluso' }).eq('id', r.id).eq('master_id', masterId).is('assegnato', null)
  }
  const proposte = proponi(daFare.filter(r => !esclusi.has(chiavePagatore(r))) as Entrata[], aperte as RicaricaAperta[], pag as any, anag)
  for (const r of daFare) {
    const p = proposte.get(r.id)
    if (p?.esito !== 'sicuro') continue
    await admin.from('estratti_righe').update({ target_tipo: p.target.tipo, target_id: p.target.id, assegnato: 'auto' })
      .eq('id', r.id).eq('master_id', masterId).is('target_id', null)
    assegnati++
    const lista = p.ricariche.map(id => perId.get(id)).filter(Boolean)
    lista.forEach((x: any) => usate.add(x.id))
    if (lista.length) { await abbina(admin, masterId, r, lista, 'auto', null); abbinati += lista.length }
  }
  // Bonifici gia' di un cliente ma senza ricarica: si riprova con quelle aperte di quel cliente.
  for (const r of righe.filter(x => x.importo > 0 && x.target_id && !legate.has(x.id))) {
    const sue = aperte.filter((a: any) => !usate.has(a.id) && a.target_tipo === r.target_tipo && a.target_id === r.target_id)
    const ids = ricarichePagate(r as Entrata, sue as RicaricaAperta[])
    if (!ids) continue
    const lista = ids.map(id => perId.get(id)).filter(Boolean)
    lista.forEach((x: any) => usate.add(x.id))
    await abbina(admin, masterId, r, lista, 'auto', null); abbinati += lista.length
  }
  return { assegnati, abbinati }
}

/** "Questo pagatore e' quel cliente" (risposta al "di chi e'?"): il nome e l'IBAN restano fra i suoi
 *  pagatori, poi i bonifici sicuri si applicano da soli, tutti quelli di quel pagatore nel periodo. */
export async function assegnaPagatore(admin: any, masterId: string, userId: string, p: { nome: string, iban: string | null, target: Target }, periodo: { dal: string, al: string }) {
  await ricordaPagatore(admin, { masterId, targetTipo: p.target.tipo, targetId: p.target.id, nome: p.nome, iban: p.iban, origine: 'estratto', createdBy: userId })
  // I bonifici di questo pagatore scollegati a mano tornano liberi di abbinarsi: il master ha appena scelto.
  let q = admin.from('estratti_righe').update({ assegnato: null }).eq('master_id', masterId).eq('assegnato', 'libero')
    .gte('data', periodo.dal).lte('data', periodo.al)
  q = p.iban ? q.eq('iban', p.iban) : q.eq('nome', p.nome)
  const { error } = await q
  if (error) throw new Error(error.message)
  return applicaSicuri(admin, masterId, periodo.dal, periodo.al)
}

/** "Non e' un cliente" (un rimborso, un giroconto): i bonifici di quel pagatore escono dai conti dei clienti. */
export async function escludiPagatore(admin: any, masterId: string, p: { nome: string, iban: string | null }) {
  let q = admin.from('estratti_righe').update({ assegnato: 'escluso' }).eq('master_id', masterId).gt('importo', 0).is('target_id', null).is('assegnato', null)
  q = p.iban ? q.eq('iban', p.iban) : q.eq('nome', p.nome)
  const { error } = await q
  if (error) throw new Error(error.message)
}

/** Toglie un abbinamento: le ricariche tornano come erano prima e il bonifico resta 'libero', cioe' fra i
 *  "di chi e'?" finche' il master non sceglie: se tornasse senza stato, alla prossima apertura il nome
 *  (ancora noto) lo riabbinerebbe da solo allo stesso cliente. */
export async function scollegaRiga(admin: any, masterId: string, rigaId: string) {
  const { data: abb, error } = await admin.from('abbinamenti_bonifici').select('id,ricarica_id,segnato_effettuato,segnato_arrivato').eq('riga_id', rigaId).eq('master_id', masterId)
  if (error) throw new Error(error.message)
  for (const a of abb || []) {
    const torna: any = {}
    if (a.segnato_arrivato) torna.bonifico_arrivato_il = null
    if (a.segnato_effettuato) torna.bonifico_effettuato_il = null
    if (Object.keys(torna).length) await admin.from('ricariche_check').update(torna).eq('id', a.ricarica_id).eq('master_id', masterId)
    await admin.from('abbinamenti_bonifici').delete().eq('id', a.id).eq('master_id', masterId)
  }
  const { error: e2 } = await admin.from('estratti_righe').update({ target_tipo: null, target_id: null, assegnato: 'libero' }).eq('id', rigaId).eq('master_id', masterId)
  if (e2) throw new Error(e2.message)
}

/** Il racconto del periodo, a blocchi (come piace a Lorenzo: numero, frase, elenco da aprire). */
export async function resoconto(admin: any, masterId: string, dal: string, al: string) {
  const [righe, ric, anag, pag, voci] = await Promise.all([
    movimenti(admin, masterId, dal, al), ricariche(admin, masterId, dal, al), anagrafiche(admin, masterId),
    fetchAllStretto(() => admin.from('pagatori_bonifico').select('target_tipo,target_id,nome,iban').eq('master_id', masterId).order('id')),
    fetchAllStretto(() => admin.from('uscite_voci').select('controparte,voce').eq('master_id', masterId).order('controparte')),
  ])
  const nomeDi = new Map(anag.map(a => [`${a.tipo}:${a.id}`, a.nome]))
  for (const r of ric) if (!nomeDi.has(`${r.target_tipo}:${r.target_id}`)) nomeDi.set(`${r.target_tipo}:${r.target_id}`, r.target_nome || '—')
  const nome = (t: string, id: string) => nomeDi.get(`${t}:${id}`) || '—'
  const ricPerRiga = new Map<string, any[]>()
  for (const r of ric) if (r.riga_id) { if (!ricPerRiga.has(r.riga_id)) ricPerRiga.set(r.riga_id, []); ricPerRiga.get(r.riga_id)!.push(r) }
  const breve = (r: any) => ({ id: r.id, giorno: r.giorno, importo: r.importo, cliente: nome(r.target_tipo, r.target_id) })
  const riga = (r: any) => ({ id: r.id, data: r.data, nome: r.nome, causale: r.causale, iban: r.iban, importo: r.importo })

  const entrate = righe.filter(r => r.importo > 0), uscite = righe.filter(r => r.importo < 0)
  const clienti = entrate.filter(r => r.iban)
  // Quelle ancora senza cliente (le sicure le ha gia' applicate applicaSicuri prima del resoconto)
  const libere = clienti.filter(r => !r.target_id && (!r.assegnato || r.assegnato === 'libero'))
  const aperte = ric.filter(r => !r.riga_id)
  const proposte = proponi(libere as Entrata[], aperte as RicaricaAperta[], pag as any, anag)
  const ricPerId = new Map(ric.map(r => [r.id, r]))

  // Raggruppate per pagatore: un clic sistema tutti i suoi bonifici.
  // Il master li assegna una volta per pagatore. `omonimi`: il nome corrisponde a piu' clienti.
  type Gruppo = { chiave: string, nome: string, iban: string | null, n: number, totale: number, causali: string[], omonimi: string[], righe: any[] }
  const chiEe = () => {
    const m = new Map<string, Gruppo>()
    for (const r of libere) {
      // Gli scollegati a mano restano qui anche se il nome e' noto: li assegna il master.
      const p = proposte.get(r.id); if (!p || (p.esito !== 'ignoto' && r.assegnato !== 'libero')) continue
      const k = chiavePagatore(r)
      if (!m.has(k)) m.set(k, { chiave: k, nome: r.nome, iban: r.iban, n: 0, totale: 0, causali: [], omonimi: p.esito === 'ignoto' ? p.omonimi.map(t => nome(t.tipo, t.id)) : [], righe: [] })
      const gg = m.get(k)!
      gg.n++; gg.totale = r2(gg.totale + r.importo); gg.righe.push(riga(r))
      if (r.causale && !gg.causali.includes(r.causale) && gg.causali.length < 3) gg.causali.push(r.causale)
    }
    return [...m.values()].sort((a, b) => b.totale - a.totale)
  }

  const abbinati = clienti.filter(r => ricPerRiga.has(r.id))
  const soloCliente = clienti.filter(r => r.target_id && !ricPerRiga.has(r.id))
  const ultimoUtile = spostaGiorni(al, -3)
  const senzaBonifico = ric.filter(r => !r.riga_id && r.giorno >= dal && r.giorno <= ultimoUtile)
  const recenti = ric.filter(r => !r.riga_id && r.giorno > ultimoUtile && r.giorno <= al)

  // Per cliente: ricaricato (con bonifico) e pagato nel periodo.
  const perCliente = new Map<string, { target: Target, nome: string, ricaricato: number, pagato: number, ricariche: number, bonifici: number }>()
  const voce = (tipo: any, id: string) => {
    const k = `${tipo}:${id}`
    if (!perCliente.has(k)) perCliente.set(k, { target: { tipo, id }, nome: nome(tipo, id), ricaricato: 0, pagato: 0, ricariche: 0, bonifici: 0 })
    return perCliente.get(k)!
  }
  for (const r of ric) if (r.giorno >= dal && r.giorno <= al) { const v = voce(r.target_tipo, r.target_id); v.ricaricato = r2(v.ricaricato + r.importo); v.ricariche++ }
  for (const r of clienti) if (r.target_id) { const v = voce(r.target_tipo, r.target_id); v.pagato = r2(v.pagato + r.importo); v.bonifici++ }

  const personalizzate = new Map(voci.map((v: any) => [v.controparte, v.voce]))
  const perVoce = new Map<string, { voce: string, n: number, totale: number, controparti: Set<string>, righe: any[] }>()
  for (const r of uscite) {
    const v = voceUscita(r, personalizzate)
    if (!perVoce.has(v)) perVoce.set(v, { voce: v, n: 0, totale: 0, controparti: new Set(), righe: [] })
    const x = perVoce.get(v)!; x.n++; x.totale = r2(x.totale + r.importo); x.controparti.add(r.nome); x.righe.push(riga(r))
  }
  const somma = (l: any[]) => r2(l.reduce((t, r) => t + r.importo, 0))
  const { data: altri } = await admin.from('ricariche_check').select('importo,metodo')
    .eq('master_id', masterId).gte('ricaricato_il', dal).lte('ricaricato_il', al + 'T23:59:59').not('metodo', 'is', null).neq('metodo', 'bonifico')

  return {
    periodo: { dal, al },
    totali: { entrate: somma(entrate), nEntrate: entrate.length, uscite: somma(uscite), nUscite: uscite.length },
    abbinati: { n: abbinati.length, totale: somma(abbinati), ricariche: abbinati.reduce((t, r) => t + (ricPerRiga.get(r.id)?.length || 0), 0),
      righe: abbinati.map(r => ({ ...riga(r), cliente: nome(r.target_tipo, r.target_id), assegnato: r.assegnato, ricariche: ricPerRiga.get(r.id)!.map(breve) })) },
    pagatiSenzaRicarica: { n: soloCliente.length, totale: somma(soloCliente), righe: soloCliente.map(r => ({ ...riga(r), cliente: nome(r.target_tipo, r.target_id) })) },
    chiEe: chiEe(),
    esclusi: { n: clienti.filter(r => r.assegnato === 'escluso').length, totale: somma(clienti.filter(r => r.assegnato === 'escluso')) },
    altreEntrate: { n: entrate.length - clienti.length, totale: somma(entrate.filter(r => !r.iban)) },
    ricaricheSenzaBonifico: { n: senzaBonifico.length, totale: somma(senzaBonifico), dopoIl: ultimoUtile,
      righe: senzaBonifico.map(r => ({ ...breve(r), mittente: r.mittente, target: { tipo: r.target_tipo, id: r.target_id } })) },
    ricaricheRecenti: { n: recenti.length, totale: somma(recenti) },
    altriMetodi: { n: (altri || []).length, totale: r2((altri || []).reduce((t: number, r: any) => t + Number(r.importo), 0)) },
    perCliente: [...perCliente.values()].map(v => ({ ...v, differenza: r2(v.pagato - v.ricaricato) }))
      .sort((a, b) => Math.abs(b.differenza) - Math.abs(a.differenza)),
    uscite: [...perVoce.values()].map(v => ({ voce: v.voce, n: v.n, totale: v.totale, controparti: [...v.controparti].slice(0, 5), righe: v.righe }))
      .sort((a, b) => a.totale - b.totale),
    anagrafiche: anag.map(a => ({ target: `${a.tipo === 'master' ? 'm:' : ''}${a.id}`, nome: a.nome })).sort((a, b) => a.nome.localeCompare(b.nome)),
  }
}
