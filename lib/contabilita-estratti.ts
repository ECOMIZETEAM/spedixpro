// L'ESTRATTO CONTO NEL PORTALE: salvarlo, abbinarlo alle ricariche, raccontarlo al master.
// Le regole dell'abbinamento stanno in lib/contabilita-abbina (pure); qui solo il database.
// Tabelle (scripts/contabilita-banca.sql): estratti_conto, estratti_righe, abbinamenti_bonifici, uscite_voci,
// piu' pagatori_bonifico e ricariche_check del passo 1.
import { fetchAllStretto } from '@/lib/fetch-all'
import { ricordaPagatore, pulisciIban, sottoSulConto, type SottoSulConto } from '@/lib/contabilita-banca'
import { chiaveDi, norma, principale, proponi, ricarichePagate, voceUscita, type Anagrafica, type Entrata, type RicaricaAperta, type Target } from '@/lib/contabilita-abbina'
import type { Estratto } from '@/lib/estratto-finom'

const GIORNO = 86400000
const spostaGiorni = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * GIORNO).toISOString().slice(0, 10)
const r2 = (x: number) => Math.round(x * 100) / 100
const giornoRoma = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
// Un pagatore si riconosce dall'IBAN, se c'e', altrimenti dal nome.
const chiavePagatore = (r: { iban: string | null, nome: string }) => r.iban || 'N:' + norma(r.nome)

// IL CONTO E LA SUA RETE. Sul conto di Ecomize Solution arrivano anche i bonifici dei clienti di Ecomize LL e
// Dg Express (conti_condivisi): le loro ricariche si cercano insieme a quelle del master, e i loro clienti
// stanno nella tendina con accanto il sotto-master. Sono ricariche che il master NON ha fatto: si toccano solo
// per segnarle arrivate (quando un bonifico le paga) e per girarle al sotto-master.
type Rete = { ids: string[], sotto: SottoSulConto[] }
async function reteDi(admin: any, masterId: string): Promise<Rete> {
  const sotto = await sottoSulConto(admin, masterId)
  return { ids: [masterId, ...sotto.map(x => x.id)], sotto }
}
// Le tabelle del giro (passo 3) possono non esserci ancora: senza, nessun giro esiste.
const tabellaMancante = (e: any) => /giri_bonifici/.test(e?.message || '') && /does not exist|Could not find|schema cache/i.test(e?.message || '')

/** Per ogni IBAN salvato, i clienti che paga ("cliente:<id>", "master:<id>"). Piu' d'uno = profili dello
 *  stesso cliente pagati dallo stesso conto (lib/contabilita-abbina, proponi). */
function clientiPerIban(pagatori: { target_tipo: string, target_id: string, iban: string | null }[]) {
  const m = new Map<string, Set<string>>()
  for (const p of pagatori) if (p.iban) { if (!m.has(p.iban)) m.set(p.iban, new Set()); m.get(p.iban)!.add(chiaveDi(p)) }
  return m
}
/** I profili fra cui cercare le ricariche di un bonifico che ha gia' un cliente: quel cliente e, se il suo IBAN
 *  e' salvato anche su altri profili insieme a lui, anche quelli. */
function famigliaDi(r: { iban: string | null, target_tipo: string, target_id: string }, perIban: Map<string, Set<string>>): Set<string> {
  const k = chiaveDi(r), s = r.iban ? perIban.get(r.iban) : null
  return s && s.has(k) ? s : new Set([k])
}

/** Un movimento e' sempre lo stesso anche se arriva in due estratti che si sovrappongono: il saldo dopo
 *  il movimento lo distingue da un altro bonifico uguale dello stesso giorno. Non sempre: +100 da X, -100 a Y,
 *  +100 da X lasciano lo stesso saldo, e il secondo bonifico sarebbe scartato come doppione. Per questo i
 *  movimenti identici dello stesso file si numerano nell'ordine della banca (il primo resta senza numero,
 *  cosi' le impronte gia' salvate non cambiano). Lo stesso giorno in due estratti ha lo stesso ordine. */
const chiaveBase = (r: { data: string, importo: number, saldo: number, nome: string }) =>
  `${r.data}|${r.importo.toFixed(2)}|${r.saldo.toFixed(2)}|${norma(r.nome)}`
export function chiaviRighe(righe: { data: string, importo: number, saldo: number, nome: string }[]): string[] {
  const visti = new Map<string, number>()
  return righe.map(r => {
    const b = chiaveBase(r), n = (visti.get(b) || 0) + 1
    visti.set(b, n)
    return n === 1 ? b : `${b}#${n}`
  })
}

/** Salva l'estratto e i suoi movimenti; quelli gia' caricati con un estratto precedente si saltano. */
export async function salvaEstratto(admin: any, masterId: string, e: Estratto, nomeFile: string, userId: string) {
  const { data: est, error } = await admin.from('estratti_conto').insert({
    master_id: masterId, banca: e.banca, conto_iban: e.contoIban, intestatario: e.intestatario,
    dal: e.dal, al: e.al, saldo_iniziale: e.saldoIniziale, saldo_finale: e.saldoFinale,
    n_righe: e.righe.length, nome_file: nomeFile.slice(0, 200), caricato_da: userId,
  }).select('id').single()
  if (error) throw new Error(error.message)
  let nuove = 0
  const chiavi = chiaviRighe(e.righe)
  for (let i = 0; i < e.righe.length; i += 500) {
    const blocco = e.righe.slice(i, i + 500).map((r, k) => ({
      master_id: masterId, estratto_id: est.id, data: r.data, nome: r.nome, causale: r.causale,
      iban: pulisciIban(r.iban), importo: r.importo, saldo: r.saldo, chiave: chiavi[i + k],
    }))
    const { data, error: e2 } = await admin.from('estratti_righe')
      .upsert(blocco, { onConflict: 'master_id,chiave', ignoreDuplicates: true }).select('id')
    if (e2) throw new Error(e2.message)
    nuove += (data || []).length
  }
  // Lo stesso file caricato due volte: nessun movimento nuovo, quindi nessun estratto nuovo. Senza questo
  // l'elenco degli estratti si riempiva di doppioni vuoti (prova del 10/11). La riga e' appena nata e non
  // ha niente attaccato: toglierla annulla il caricamento, non cancella storia.
  if (nuove === 0) {
    await admin.from('estratti_conto').delete().eq('id', est.id).eq('master_id', masterId)
    return { estrattoId: null, righe: e.righe.length, nuove, giaPresenti: e.righe.length }
  }
  return { estrattoId: est.id as string, righe: e.righe.length, nuove, giaPresenti: e.righe.length - nuove }
}

/** Clienti e sotto-master diretti del master, e quelli dei sotto-master che pagano sul suo conto (con `di`):
 *  fra questi si cerca chi ha pagato. */
async function anagrafiche(admin: any, rete: Rete): Promise<Anagrafica[]> {
  const [cli, sub] = await Promise.all([
    fetchAllStretto(() => admin.from('clienti').select('id,ragione_sociale,master_id').in('master_id', rete.ids).order('id')),
    fetchAllStretto(() => admin.from('masters').select('id,nome,parent_master_id').in('parent_master_id', rete.ids).order('id')),
  ])
  const di = new Map(rete.sotto.map(x => [x.id, x.nome]))
  return [...cli.map((c: any) => ({ tipo: 'cliente' as const, id: c.id, nome: c.ragione_sociale || '', di: di.get(c.master_id) })),
    ...sub.map((m: any) => ({ tipo: 'master' as const, id: m.id, nome: m.nome || '', di: di.get(m.parent_master_id) }))]
}

/** Le ricariche che si aspettano un bonifico (bonifico, o di prima che esistesse il campo) intorno al periodo,
 *  con quelle gia' abbinate segnate. Le righe tolte dal Check Ricariche (nascosta_il: Ecomize ha ripulito
 *  l'elenco il 12/11) non si cercano piu' in banca, ma quelle gia' abbinate restano col loro bonifico: il
 *  lavoro fatto sull'estratto non si perde. */
async function ricariche(admin: any, rete: Rete, dal: string, al: string) {
  const tutte = await fetchAllStretto(() => admin.from('ricariche_check')
    .select('id,master_id,target_tipo,target_id,target_nome,importo,ricaricato_il,metodo,mittente,bonifico_effettuato_il,bonifico_arrivato_il,nascosta_il')
    .in('master_id', rete.ids).gte('ricaricato_il', spostaGiorni(dal, -15)).lte('ricaricato_il', spostaGiorni(al, 4))
    .or('metodo.is.null,metodo.eq.bonifico').order('ricaricato_il').order('id'))
  const ids = tutte.map((r: any) => r.id)
  const abbinate = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await admin.from('abbinamenti_bonifici').select('ricarica_id,riga_id').in('ricarica_id', ids.slice(i, i + 300))
    if (error) throw new Error(error.message)
    for (const a of data || []) abbinate.set(a.ricarica_id, a.riga_id)
  }
  return tutte.filter((r: any) => !r.nascosta_il || abbinate.has(r.id))
    .map((r: any) => ({ ...r, importo: Number(r.importo), giorno: giornoRoma(r.ricaricato_il), riga_id: abbinate.get(r.id) || null }))
}

async function movimenti(admin: any, masterId: string, dal: string, al: string) {
  const righe = await fetchAllStretto(() => admin.from('estratti_righe')
    .select('id,data,nome,causale,iban,importo,saldo,target_tipo,target_id,assegnato')
    .eq('master_id', masterId).gte('data', dal).lte('data', al).order('data').order('id'))
  return righe.map((r: any) => ({ ...r, importo: Number(r.importo), saldo: Number(r.saldo) }))
}

/** Lega i bonifici alle ricariche che pagano, e segna le ricariche "arrivate" nel Check Ricariche con la data
 *  della banca. Si ricorda cosa ha segnato lui, per poterlo togliere se l'abbinamento si annulla.
 *  Tutto a blocchi: una scrittura per riga faceva 700 viaggi al database e il caricamento di ottobre durava
 *  59 secondi, a un passo dal limite del server (60). */
async function abbinaTutti(admin: any, masterId: string, rete: Rete, legami: { riga: { id: string, data: string }, ric: any[] }[], userId: string | null): Promise<number> {
  const nuovi = legami.flatMap(l => l.ric.map(r => ({
    master_id: masterId, riga_id: l.riga.id, ricarica_id: r.id, modo: 'auto',
    segnato_effettuato: !r.bonifico_effettuato_il, segnato_arrivato: !r.bonifico_arrivato_il, creato_da: userId,
    _data: l.riga.data,
  })))
  const inseriti: typeof nuovi = []
  for (let i = 0; i < nuovi.length; i += 500) {
    const blocco = nuovi.slice(i, i + 500)
    // Una ricarica gia' abbinata (indice unico) si salta: vale l'abbinamento che c'era.
    const { data, error } = await admin.from('abbinamenti_bonifici')
      .upsert(blocco.map(({ _data, ...x }) => x), { onConflict: 'ricarica_id', ignoreDuplicates: true }).select('ricarica_id')
    if (error) throw new Error(error.message)
    const fatti = new Set((data || []).map((x: any) => x.ricarica_id))
    inseriti.push(...blocco.filter(x => fatti.has(x.ricarica_id)))
  }
  // Le ricariche si segnano per giorno del bonifico: un aggiornamento per giorno, non uno per ricarica.
  for (const campo of ['bonifico_effettuato_il', 'bonifico_arrivato_il'] as const) {
    const perGiorno = new Map<string, string[]>()
    for (const x of inseriti) {
      if (campo === 'bonifico_effettuato_il' ? !x.segnato_effettuato : !x.segnato_arrivato) continue
      if (!perGiorno.has(x._data)) perGiorno.set(x._data, []); perGiorno.get(x._data)!.push(x.ricarica_id)
    }
    for (const [giorno, ids] of perGiorno) {
      for (let i = 0; i < ids.length; i += 300) {
        // anche quelle dei sotto-master sul conto: nel loro Check Ricariche risultano arrivate
        const { error } = await admin.from('ricariche_check').update({ [campo]: giorno + 'T12:00:00Z' })
          .in('id', ids.slice(i, i + 300)).in('master_id', rete.ids).is(campo, null)
        if (error) throw new Error(error.message)
      }
    }
  }
  return inseriti.length
}

/** Aggiorna tante righe dell'estratto con gli stessi valori, a blocchi. */
async function aggiornaRighe(admin: any, masterId: string, ids: string[], valori: Record<string, any>, soloSenzaCliente: boolean) {
  for (let i = 0; i < ids.length; i += 300) {
    let q = admin.from('estratti_righe').update(valori).in('id', ids.slice(i, i + 300)).eq('master_id', masterId)
    if (soloSenzaCliente) q = q.is('target_id', null).is('assegnato', null)
    const { error } = await q
    if (error) throw new Error(error.message)
  }
}

/** Applica gli abbinamenti SICURI del periodo: bonifici di pagatori gia' noti, e bonifici gia' assegnati a un
 *  cliente che non hanno ancora trovato la loro ricarica (magari fatta dopo). Non chiede niente a nessuno. */
export async function applicaSicuri(admin: any, masterId: string, dal: string, al: string) {
  const rete = await reteDi(admin, masterId)
  const [righe, ric, anag, pag, giaEsclusi] = await Promise.all([
    movimenti(admin, masterId, dal, al), ricariche(admin, rete, dal, al), anagrafiche(admin, rete),
    fetchAllStretto(() => admin.from('pagatori_bonifico').select('target_tipo,target_id,nome,iban').eq('master_id', masterId).order('id')),
    // Pagatori segnati "non e' un cliente", in qualunque mese: i loro bonifici nuovi restano fuori come i vecchi.
    fetchAllStretto(() => admin.from('estratti_righe').select('nome,iban').eq('master_id', masterId).eq('assegnato', 'escluso').order('id')),
  ])
  const legate = new Set<string>()
  for (let i = 0; i < righe.length; i += 300) {
    const { data, error } = await admin.from('abbinamenti_bonifici').select('riga_id').in('riga_id', righe.slice(i, i + 300).map(r => r.id))
    if (error) throw new Error(error.message)
    for (const a of data || []) legate.add(a.riga_id)
  }
  const aperte = ric.filter((r: any) => !r.riga_id)
  const perId = new Map(aperte.map((r: any) => [r.id, r]))
  const esclusi = new Set(giaEsclusi.map((r: any) => chiavePagatore(r)))
  const libere = righe.filter(r => r.importo > 0 && r.iban && !r.target_id && !r.assegnato)
  await aggiornaRighe(admin, masterId, libere.filter(r => esclusi.has(chiavePagatore(r))).map(r => r.id), { assegnato: 'escluso' }, true)
  const daFare = libere.filter(r => !esclusi.has(chiavePagatore(r)))
  const proposte = proponi(daFare as Entrata[], aperte as RicaricaAperta[], pag as any, anag)
  const perCliente = new Map<string, string[]>()
  const legami: { riga: any, ric: any[] }[] = []
  const usate = new Set<string>()
  for (const r of daFare) {
    const p = proposte.get(r.id)
    if (p?.esito !== 'sicuro') continue
    const k = `${p.target.tipo}:${p.target.id}`
    if (!perCliente.has(k)) perCliente.set(k, []); perCliente.get(k)!.push(r.id)
    const lista = p.ricariche.map(id => perId.get(id)).filter(Boolean)
    lista.forEach((x: any) => usate.add(x.id))
    if (lista.length) legami.push({ riga: r, ric: lista })
  }
  for (const [k, ids] of perCliente) {
    const [tipo, id] = k.split(':')
    await aggiornaRighe(admin, masterId, ids, { target_tipo: tipo, target_id: id, assegnato: 'auto' }, true)
  }
  // Bonifici gia' di un cliente ma senza ricarica: si riprova con quelle aperte di quel cliente (e dei suoi
  // altri profili pagati dallo stesso IBAN).
  const perIban = clientiPerIban(pag as any)
  for (const r of righe.filter(x => x.importo > 0 && x.target_id && !legate.has(x.id)).sort((a, b) => a.data.localeCompare(b.data))) {
    const famiglia = famigliaDi(r, perIban)
    const sue = aperte.filter((a: any) => !usate.has(a.id) && famiglia.has(chiaveDi(a)))
    const ids = ricarichePagate(r as Entrata, sue as RicaricaAperta[])
    if (!ids) continue
    const lista = ids.map(id => perId.get(id)).filter(Boolean)
    lista.forEach((x: any) => usate.add(x.id))
    legami.push({ riga: r, ric: lista })
  }
  const abbinati = await abbinaTutti(admin, masterId, rete, legami, null)
  return { assegnati: [...perCliente.values()].reduce((t, l) => t + l.length, 0), abbinati }
}

/** "Questo pagatore e' quel cliente" (risposta al "di chi e'?"), o "e' di questi profili": un cliente con due
 *  anagrafiche che paga con un bonifico solo le ricariche di tutte e due (LA NUOVA POSTA S.N.C.: 1.000 € =
 *  500 + 500). Il nome e l'IBAN restano fra i pagatori di ognuno, poi i bonifici sicuri si applicano da soli,
 *  tutti quelli di quel pagatore nel periodo.
 *  La scelta e' l'elenco intero: un profilo che aveva questo IBAN dall'estratto e ora non e' fra quelli scelti
 *  non riceve piu' i suoi bonifici. Senza, scollegare un bonifico abbinato a due profili e riassegnarlo a uno
 *  solo lo rimetteva su tutti e due. Quelli gia' abbinati restano come sono; i nomi scritti a mano restano. */
export async function assegnaPagatore(admin: any, masterId: string, userId: string, p: { nome: string, iban: string | null, targets: Target[] }, periodo: { dal: string, al: string }) {
  for (const t of p.targets) {
    await ricordaPagatore(admin, { masterId, targetTipo: t.tipo, targetId: t.id, nome: p.nome, iban: p.iban, origine: 'estratto', createdBy: userId })
  }
  if (p.iban) {
    const tenere = new Set(p.targets.map(t => `${t.tipo}:${t.id}`))
    const { data: prima, error: e0 } = await admin.from('pagatori_bonifico').select('id,target_tipo,target_id')
      .eq('master_id', masterId).eq('origine', 'estratto').eq('iban', p.iban)
    if (e0) throw new Error(e0.message)
    const via = (prima || []).filter((x: any) => !tenere.has(chiaveDi(x))).map((x: any) => x.id)
    if (via.length) {
      const { error: e1 } = await admin.from('pagatori_bonifico').delete().in('id', via).eq('master_id', masterId)
      if (e1) throw new Error(e1.message)
    }
  }
  // I bonifici di questo pagatore scollegati a mano tornano liberi di abbinarsi: il master ha appena scelto.
  let q = admin.from('estratti_righe').update({ assegnato: null }).eq('master_id', masterId).eq('assegnato', 'libero')
    .gte('data', periodo.dal).lte('data', periodo.al)
  q = p.iban ? q.eq('iban', p.iban) : q.eq('nome', p.nome)
  const { error } = await q
  if (error) throw new Error(error.message)
  const esito = await applicaSicuri(admin, masterId, periodo.dal, periodo.al)
  // Cosa e' successo ai bonifici di QUESTO pagatore, per dirlo al master appena ha salvato.
  let q2 = admin.from('estratti_righe').select('id,target_id').eq('master_id', masterId).gt('importo', 0)
    .gte('data', periodo.dal).lte('data', periodo.al)
  q2 = p.iban ? q2.eq('iban', p.iban) : q2.eq('nome', p.nome)
  const { data: sue, error: e2 } = await q2
  if (e2) throw new Error(e2.message)
  const ids = (sue || []).map((x: any) => x.id)
  const abb: any[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error: e3 } = await admin.from('abbinamenti_bonifici').select('riga_id').in('riga_id', ids.slice(i, i + 300))
    if (e3) throw new Error(e3.message)
    abb.push(...(data || []))
  }
  const legate = new Set(abb.map((a: any) => a.riga_id))
  return { ...esito, pagatore: { bonifici: ids.length, conRicarica: legate.size, ricariche: abb.length,
    senzaRicarica: (sue || []).filter((x: any) => x.target_id && !legate.has(x.id)).length } }
}

/** "Non e' un cliente" (un rimborso, un giroconto): i bonifici di quel pagatore escono dai conti dei clienti. */
export async function escludiPagatore(admin: any, masterId: string, p: { nome: string, iban: string | null }) {
  let q = admin.from('estratti_righe').update({ assegnato: 'escluso' }).eq('master_id', masterId).gt('importo', 0).is('target_id', null).is('assegnato', null)
  q = p.iban ? q.eq('iban', p.iban) : q.eq('nome', p.nome)
  const { error } = await q
  if (error) throw new Error(error.message)
}

/** Annulla "non e' un cliente": i bonifici di quel pagatore, in tutti i mesi, tornano a cercare il loro cliente
 *  (da soli se il nome e' noto, altrimenti fra i "di chi e'?"). Un clic sbagliato non deve essere per sempre. */
export async function includiPagatore(admin: any, masterId: string, p: { nome: string, iban: string | null }) {
  let q = admin.from('estratti_righe').update({ assegnato: null }).eq('master_id', masterId).eq('assegnato', 'escluso')
  q = p.iban ? q.eq('iban', p.iban) : q.eq('nome', p.nome)
  const { error } = await q
  if (error) throw new Error(error.message)
}

/** Toglie un abbinamento: le ricariche tornano come erano prima e il bonifico resta 'libero', cioe' fra i
 *  "di chi e'?" finche' il master non sceglie: se tornasse senza stato, alla prossima apertura il nome
 *  (ancora noto) lo riabbinerebbe da solo allo stesso cliente. */
export async function scollegaRiga(admin: any, masterId: string, rigaId: string) {
  const rete = await reteDi(admin, masterId)
  // Un bonifico che paga ricariche gia' girate al sotto-master non si scollega: il sotto-master ha gia' avuto
  // quel credito. Prima si annulla il giro (lo blocca anche il database, trg_abbinamento_girato).
  const { data: gir, error: eg } = await admin.from('giri_bonifici_ricariche').select('giro_id').eq('riga_id', rigaId).eq('attivo', true).limit(1)
  if (eg && !tabellaMancante(eg)) throw new Error(eg.message)
  if (gir?.length) throw new Error('Questo bonifico è già stato girato al sotto-master: prima annulla il giro')
  const { data: abb, error } = await admin.from('abbinamenti_bonifici').select('id,ricarica_id,segnato_effettuato,segnato_arrivato').eq('riga_id', rigaId).eq('master_id', masterId)
  if (error) throw new Error(error.message)
  // I clienti delle ricariche che pagava, prima di toglierle: con due profili non e' solo quello della riga.
  const { data: ricPagate, error: e0 } = (abb || []).length
    ? await admin.from('ricariche_check').select('target_tipo,target_id').in('id', abb!.map((a: any) => a.ricarica_id)).in('master_id', rete.ids)
    : { data: [], error: null }
  if (e0) throw new Error(e0.message)
  for (const a of abb || []) {
    const torna: any = {}
    if (a.segnato_arrivato) torna.bonifico_arrivato_il = null
    if (a.segnato_effettuato) torna.bonifico_effettuato_il = null
    if (Object.keys(torna).length) await admin.from('ricariche_check').update(torna).eq('id', a.ricarica_id).in('master_id', rete.ids)
    await admin.from('abbinamenti_bonifici').delete().eq('id', a.id).eq('master_id', masterId)
  }
  const { data: prima } = await admin.from('estratti_righe').select('iban,target_tipo,target_id').eq('id', rigaId).eq('master_id', masterId).maybeSingle()
  const { error: e2 } = await admin.from('estratti_righe').update({ target_tipo: null, target_id: null, assegnato: 'libero' }).eq('id', rigaId).eq('master_id', masterId)
  if (e2) throw new Error(e2.message)
  // Il cliente era sbagliato? Se quell'IBAN gli era stato dato dall'estratto (un "di chi e'?" assegnato male) e
  // non gli resta nessun altro bonifico con quell'IBAN, l'IBAN si toglie dai suoi pagatori: altrimenti i
  // prossimi bonifici tornerebbero da lui. I nomi scritti a mano o nella ricarica restano.
  // Vale per ogni profilo toccato: quello della riga e quelli delle ricariche che pagava. "Gli resta un
  // bonifico" vuol dire un bonifico suo o uno che paga una sua ricarica: con due profili pagati insieme il
  // bonifico va a uno solo dei due, e contando solo quelli l'altro perdeva l'IBAN al primo scollega.
  if (prima?.iban) {
    const toccati = new Set<string>([...(prima.target_id ? [chiaveDi(prima)] : []), ...(ricPagate || []).map((x: any) => chiaveDi(x))])
    if (!toccati.size) return
    // Se una lettura non riesce l'IBAN resta dov'e': lo scollega e' gia' fatto, e togliere un IBAN che serve
    // farebbe perdere i prossimi bonifici di quel cliente senza che nessuno se ne accorga.
    let ancora: Set<string>
    try {
      const altre = await fetchAllStretto(() => admin.from('estratti_righe').select('id,target_tipo,target_id')
        .eq('master_id', masterId).eq('iban', prima.iban).neq('id', rigaId).order('id'))
      ancora = new Set<string>(altre.filter((x: any) => x.target_id).map((x: any) => chiaveDi(x)))
      const ids = altre.map((x: any) => x.id)
      for (let i = 0; i < ids.length; i += 300) {
        const { data: a2, error: e4 } = await admin.from('abbinamenti_bonifici').select('ricarica_id').in('riga_id', ids.slice(i, i + 300))
        if (e4) throw new Error(e4.message)
        const ricIds = (a2 || []).map((x: any) => x.ricarica_id)
        for (let j = 0; j < ricIds.length; j += 300) {
          const { data: r2, error: e5 } = await admin.from('ricariche_check').select('target_tipo,target_id').in('id', ricIds.slice(j, j + 300))
          if (e5) throw new Error(e5.message)
          for (const x of r2 || []) ancora.add(chiaveDi(x))
        }
      }
    } catch { return }
    for (const k of toccati) {
      if (ancora.has(k)) continue
      const [tipo, id] = k.split(':')
      await admin.from('pagatori_bonifico').delete().eq('master_id', masterId).eq('origine', 'estratto')
        .eq('target_tipo', tipo).eq('target_id', id).eq('iban', prima.iban)
    }
  }
}

/** IL GIRO AI SOTTO-MASTER: per ognuno, le ricariche dei suoi clienti pagate da un bonifico arrivato sul conto
 *  del master dal giorno di conti_condivisi, non ancora girate (quelle che il pulsante gira), e i giri fatti.
 *  Non dipende dal periodo guardato: il giro e' di tutto quello che e' arrivato e non e' stato girato.
 *  Una ricarica fatta prima del giorno del giro ma pagata da un bonifico arrivato dopo si gira: conta il giorno
 *  del bonifico, come nella funzione del database (gira_bonifici_sotto_master). */
async function situazioneGiri(admin: any, masterId: string, rete: Rete, nome: (t: string, id: string) => string) {
  if (!rete.sotto.length) return null
  const primo = rete.sotto.map(x => x.giroDal).sort()[0]
  const ricS = await fetchAllStretto(() => admin.from('ricariche_check')
    .select('id,master_id,target_tipo,target_id,target_nome,importo,ricaricato_il')
    .in('master_id', rete.sotto.map(x => x.id)).gte('ricaricato_il', spostaGiorni(primo, -15)).order('ricaricato_il').order('id'))
  const ids = ricS.map((r: any) => r.id)
  const rigaDi = new Map<string, string>()
  const girate = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const pezzo = ids.slice(i, i + 300)
    const [{ data: a, error: e1 }, { data: g, error: e2 }] = await Promise.all([
      admin.from('abbinamenti_bonifici').select('ricarica_id,riga_id').eq('master_id', masterId).in('ricarica_id', pezzo),
      admin.from('giri_bonifici_ricariche').select('ricarica_id').in('ricarica_id', pezzo).eq('attivo', true),
    ])
    if (e1) throw new Error(e1.message)
    if (e2 && !tabellaMancante(e2)) throw new Error(e2.message)
    for (const x of a || []) rigaDi.set(x.ricarica_id, x.riga_id)
    for (const x of g || []) girate.add(x.ricarica_id)
  }
  const righeIds = [...new Set(rigaDi.values())]
  const bonifico = new Map<string, any>()
  for (let i = 0; i < righeIds.length; i += 300) {
    const { data, error } = await admin.from('estratti_righe').select('id,data,nome,causale').eq('master_id', masterId).in('id', righeIds.slice(i, i + 300))
    if (error) throw new Error(error.message)
    for (const x of data || []) bonifico.set(x.id, x)
  }
  const { data: giri, error: e3 } = await admin.from('giri_bonifici')
    .select('id,sotto_master_id,importo,n_ricariche,bonifici_dal,bonifici_al,creato_il,annullato_il')
    .eq('master_id', masterId).order('creato_il', { ascending: false }).limit(30)
  if (e3 && !tabellaMancante(e3)) throw new Error(e3.message)
  const nomeSotto = new Map(rete.sotto.map(x => [x.id, x.nome]))
  return {
    sotto: rete.sotto.map(x => {
      const da = ricS.filter((r: any) => r.master_id === x.id && rigaDi.has(r.id) && !girate.has(r.id)
        && String(bonifico.get(rigaDi.get(r.id)!)?.data || '') >= x.giroDal)
        .map((r: any) => { const b = bonifico.get(rigaDi.get(r.id)!)
          return { id: r.id, giorno: giornoRoma(r.ricaricato_il), importo: Number(r.importo), cliente: nome(r.target_tipo, r.target_id) !== '—' ? nome(r.target_tipo, r.target_id) : (r.target_nome || '—'),
            bonifico: { data: b.data, nome: b.nome, causale: b.causale } } })
        .sort((a: any, b: any) => a.bonifico.data.localeCompare(b.bonifico.data) || a.giorno.localeCompare(b.giorno))
      return { id: x.id, nome: x.nome, giroDal: x.giroDal, daGirare: { n: da.length, totale: r2(da.reduce((t: number, r: any) => t + r.importo, 0)), righe: da } }
    }),
    giri: (giri || []).map((g: any) => ({ id: g.id, sotto: nomeSotto.get(g.sotto_master_id) || '—', importo: Number(g.importo), n: g.n_ricariche,
      dal: g.bonifici_dal, al: g.bonifici_al, il: giornoRoma(g.creato_il), annullato: g.annullato_il ? giornoRoma(g.annullato_il) : null })),
  }
}

/** Il racconto del periodo, a blocchi (come piace a Lorenzo: numero, frase, elenco da aprire). */
export async function resoconto(admin: any, masterId: string, dal: string, al: string) {
  const rete = await reteDi(admin, masterId)
  const [righe, ric, anag, pag, voci] = await Promise.all([
    movimenti(admin, masterId, dal, al), ricariche(admin, rete, dal, al), anagrafiche(admin, rete),
    fetchAllStretto(() => admin.from('pagatori_bonifico').select('target_tipo,target_id,nome,iban').eq('master_id', masterId).order('id')),
    fetchAllStretto(() => admin.from('uscite_voci').select('controparte,voce').eq('master_id', masterId).order('controparte')),
  ])
  // I clienti dei sotto-master si leggono con accanto il sotto-master: "ARIOLDI GIULIA · Ecomize LL". Ecomize
  // Solution vedeva gia' quel nome nelle rettifiche e lo credeva suo (Lorenzo, 10/11).
  const etichetta = (a: Anagrafica) => a.di ? `${a.nome} · ${a.di}` : a.nome
  const nomeDi = new Map(anag.map(a => [`${a.tipo}:${a.id}`, etichetta(a)]))
  for (const r of ric) if (!nomeDi.has(`${r.target_tipo}:${r.target_id}`)) nomeDi.set(`${r.target_tipo}:${r.target_id}`, r.target_nome || '—')
  const nome = (t: string, id: string) => nomeDi.get(`${t}:${id}`) || '—'
  const nomeK = (k: string) => nomeDi.get(k) || '—'
  const perIban = clientiPerIban(pag as any)
  const ricPerRiga = new Map<string, any[]>()
  for (const r of ric) if (r.riga_id) { if (!ricPerRiga.has(r.riga_id)) ricPerRiga.set(r.riga_id, []); ricPerRiga.get(r.riga_id)!.push(r) }
  // Il cliente di un bonifico come lo si legge: quelli delle ricariche che paga (due profili = "A + B"); senza
  // ricarica, il suo cliente, o i suoi profili se l'IBAN li paga tutti ("A / B").
  const clienteDi = (r: any) => {
    const sue = ricPerRiga.get(r.id)
    if (sue?.length) return [...new Set(sue.map((y: any) => nome(y.target_tipo, y.target_id)))].join(' + ')
    return [...famigliaDi(r, perIban)].map(nomeK).join(' / ')
  }
  const breve = (r: any) => ({ id: r.id, giorno: r.giorno, importo: r.importo, cliente: nome(r.target_tipo, r.target_id) })
  // Nella tendina del "di chi e'?" i clienti hanno "<id>" o "m:<id>".
  const perTendina = (k: string) => { const [tipo, id] = k.split(':'); return tipo === 'master' ? 'm:' + id : id }
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
  type Gruppo = { chiave: string, nome: string, iban: string | null, n: number, totale: number, causali: string[], omonimi: string[], senzaRicariche: boolean, noti: { target: string, nome: string }[], righe: any[] }
  const chiEe = () => {
    const m = new Map<string, Gruppo>()
    for (const r of libere) {
      // Gli scollegati a mano restano qui anche se il nome e' noto: li assegna il master.
      const p = proposte.get(r.id); if (!p || (p.esito !== 'ignoto' && r.assegnato !== 'libero')) continue
      const k = chiavePagatore(r)
      // `noti`: i profili a cui questo IBAN e' gia' salvato (uno scollegato da riassegnare): la tendina parte da
      // loro, cosi' il master vede la scelta di prima e la cambia invece di aggiungerne una sopra.
      if (!m.has(k)) m.set(k, { chiave: k, nome: r.nome, iban: r.iban, n: 0, totale: 0, causali: [], omonimi: p.esito === 'ignoto' ? p.omonimi.map(t => nome(t.tipo, t.id)) : [], senzaRicariche: p.esito === 'ignoto' && !!p.senzaRicariche,
        noti: r.iban ? [...(perIban.get(r.iban) || [])].map(t => ({ target: perTendina(t), nome: nomeK(t) })) : [], righe: [] })
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
  // Il pagato va al cliente di ogni ricarica pagata: un bonifico per due profili (500 + 500) e' 500 a testa, non
  // 1.000 all'uno e 0 all'altro. Senza ricarica va al cliente del bonifico. Quello che avanza (non dovrebbe: le
  // ricariche abbinate sommano sempre l'importo) resta al cliente del bonifico, cosi' il totale non cambia.
  for (const r of clienti) {
    if (!r.target_id && !ricPerRiga.has(r.id)) continue
    let resto = r.importo
    const toccati = new Set<string>()
    for (const y of ricPerRiga.get(r.id) || []) {
      const v = voce(y.target_tipo, y.target_id); v.pagato = r2(v.pagato + y.importo); resto = r2(resto - y.importo)
      if (!toccati.has(chiaveDi(y))) { toccati.add(chiaveDi(y)); v.bonifici++ }
    }
    if (Math.abs(resto) >= 0.005 && r.target_id) {
      const v = voce(r.target_tipo, r.target_id); v.pagato = r2(v.pagato + resto)
      if (!toccati.has(chiaveDi(r))) v.bonifici++
    }
  }

  const personalizzate = new Map(voci.map((v: any) => [v.controparte, v.voce]))
  const perVoce = new Map<string, { voce: string, n: number, totale: number, controparti: Set<string>, righe: any[] }>()
  for (const r of uscite) {
    const v = voceUscita(r, personalizzate)
    if (!perVoce.has(v)) perVoce.set(v, { voce: v, n: 0, totale: 0, controparti: new Set(), righe: [] })
    const x = perVoce.get(v)!; x.n++; x.totale = r2(x.totale + r.importo); x.controparti.add(r.nome); x.righe.push(riga(r))
  }
  const somma = (l: any[]) => r2(l.reduce((t, r) => t + r.importo, 0))
  const altri = await fetchAllStretto(() => admin.from('ricariche_check').select('id,master_id,importo,metodo,target_tipo,target_id,target_nome,ricaricato_il')
    .in('master_id', rete.ids).gte('ricaricato_il', spostaGiorni(dal, -1)).lte('ricaricato_il', spostaGiorni(al, 1)).not('metodo', 'is', null).neq('metodo', 'bonifico').is('nascosta_il', null).order('ricaricato_il').order('id'))
  const altriNel = altri.map((r: any) => ({ ...r, importo: Number(r.importo), giorno: giornoRoma(r.ricaricato_il) })).filter((r: any) => r.giorno >= dal && r.giorno <= al)
  // Una ricarica a un sotto-master sul conto, fatta dal master: si puo' segnare "giro dei bonifici dei suoi
  // clienti" (prima del pulsante il giro si faceva a mano: ottobre, 36.663 € a Ecomize LL).
  const sottoIds = new Set(rete.sotto.map(x => x.id))
  const giroPossibile = (r: any) => r.master_id === masterId && r.target_tipo === 'master' && sottoIds.has(r.target_id)
  const giri = await situazioneGiri(admin, masterId, rete, nome)
  // I bonifici che pagano ricariche gia' girate: niente Scollega, si annulla il giro.
  const girataDa = new Map<string, string>()
  if (giri) {
    const idsS = ric.filter(r => r.riga_id && sottoIds.has(r.master_id)).map(r => r.id)
    for (let i = 0; i < idsS.length; i += 300) {
      const { data, error } = await admin.from('giri_bonifici_ricariche').select('ricarica_id,giro_id').in('ricarica_id', idsS.slice(i, i + 300)).eq('attivo', true)
      if (error && !tabellaMancante(error)) throw new Error(error.message)
      for (const x of data || []) girataDa.set(x.ricarica_id, x.giro_id)
    }
  }
  const giroDi = new Map((giri?.giri || []).map((g: any) => [g.id, g]))
  const girato = (r: any) => {
    const y = (ricPerRiga.get(r.id) || []).find((z: any) => girataDa.has(z.id))
    if (!y) return null
    const g: any = giroDi.get(girataDa.get(y.id)!)
    return g ? `girato a ${g.sotto} il ${g.il.split('-').reverse().join('/')}` : 'girato al sotto-master'
  }

  // "Non e' un cliente", per pagatore: da qui si annulla.
  const esclusiPer = new Map<string, { nome: string, iban: string | null, n: number, totale: number }>()
  for (const r of clienti.filter(x => x.assegnato === 'escluso')) {
    const k = chiavePagatore(r)
    if (!esclusiPer.has(k)) esclusiPer.set(k, { nome: r.nome, iban: r.iban, n: 0, totale: 0 })
    const x = esclusiPer.get(k)!; x.n++; x.totale = r2(x.totale + r.importo)
  }

  return {
    periodo: { dal, al },
    totali: { entrate: somma(entrate), nEntrate: entrate.length, uscite: somma(uscite), nUscite: uscite.length },
    abbinati: { n: abbinati.length, totale: somma(abbinati), ricariche: abbinati.reduce((t, r) => t + (ricPerRiga.get(r.id)?.length || 0), 0),
      righe: abbinati.map(r => ({ ...riga(r), cliente: clienteDi(r), assegnato: r.assegnato, ricariche: ricPerRiga.get(r.id)!.map(breve), girato: girato(r) })) },
    pagatiSenzaRicarica: { n: soloCliente.length, totale: somma(soloCliente), righe: soloCliente.map(r => ({ ...riga(r), cliente: clienteDi(r) })) },
    chiEe: chiEe(),
    esclusi: { n: clienti.filter(r => r.assegnato === 'escluso').length, totale: somma(clienti.filter(r => r.assegnato === 'escluso')),
      pagatori: [...esclusiPer.values()].sort((a, b) => b.totale - a.totale) },
    altreEntrate: { n: entrate.length - clienti.length, totale: somma(entrate.filter(r => !r.iban)) },
    ricaricheSenzaBonifico: { n: senzaBonifico.length, totale: somma(senzaBonifico), dopoIl: ultimoUtile,
      // `aManoArrivata`: nella ricarica o nel Check Ricariche qualcuno l'ha segnata "arrivata", ma in banca non
      // c'e': o il bonifico ha un nome che il portale non conosce, o non e' arrivato davvero.
      righe: senzaBonifico.map(r => ({ ...breve(r), mittente: r.mittente, target: { tipo: r.target_tipo, id: r.target_id }, aManoArrivata: r.bonifico_arrivato_il ? giornoRoma(r.bonifico_arrivato_il) : null,
        giroPossibile: giroPossibile(r), delSotto: r.master_id !== masterId, di: r.master_id })) },
    ricaricheRecenti: { n: recenti.length, totale: somma(recenti) },
    altriMetodi: { n: altriNel.length, totale: somma(altriNel), righe: altriNel.map((r: any) => ({ ...breve(r), cliente: nome(r.target_tipo, r.target_id) !== '—' ? nome(r.target_tipo, r.target_id) : (r.target_nome || '—'), metodo: r.metodo, giroPossibile: giroPossibile(r) })) },
    giri,
    perCliente: [...perCliente.values()].map(v => ({ ...v, differenza: r2(v.pagato - v.ricaricato) }))
      .sort((a, b) => Math.abs(b.differenza) - Math.abs(a.differenza)),
    uscite: [...perVoce.values()].map(v => ({ voce: v.voce, n: v.n, totale: v.totale, controparti: [...v.controparti].slice(0, 5), righe: v.righe }))
      .sort((a, b) => a.totale - b.totale),
    anagrafiche: anag.map(a => ({ target: `${a.tipo === 'master' ? 'm:' : ''}${a.id}`, nome: etichetta(a) })).sort((a, b) => a.nome.localeCompare(b.nome)),
  }
}
