import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { gestisceLaRete } from '@/lib/ruoli'
import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { contabilitaAttiva, metodoValido, pulisciNome, ricordaPagatore, type MetodoPagamento } from '@/lib/contabilita-banca'
import { NON_E_UNA_RICARICA, chiedeBonifico, chiedeCosto, chiedeRicaricaDaStornare, costoLetto, descrizioneMovimento, erroreVoce, euro, metodoNelCheck, numeroFatturaDaConfermare, numeroSpedizionePulito, pulisciTesto, testoDelloStorno, tipoDiVoce, voceManuale, type RicaricaDaStornare, type VoceManuale } from '@/lib/movimento-manuale'
import { chiudiRigaDellaRicarica } from '@/lib/ricarica-stornata'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import type { SupabaseClient } from '@supabase/supabase-js'

type Spedizione = { id: string; numero: string | null; tracking_number: string | null; master_id: string | null; cliente_id: string | null; dest_nome: string | null }

// I MOVIMENTI SCRITTI A MANO dalla scheda cliente e dalla scheda sotto-master. Che cos'e' il movimento lo dice la
// voce scelta da chi lo scrive (lib/movimento-manuale), non piu' il segno dell'importo. Senza voce non si
// registra: una pagina aperta da prima del rilascio la manda ancora senza, e va solo ricaricata.

type Pagamento = { metodo: MetodoPagamento; mittente: string | null } | null

// Come ha pagato la ricarica (per tutti dal 24/11/2026: contanti o una compensazione non aspettano un bonifico) e chi
// ha fatto il bonifico, che serve solo a ritrovarlo sull'estratto conto: quello dove la contabilita' e' accesa.
// Senza metodo (l'assistente Moovy, una pagina vecchia) vale bonifico, come prima.
function pagamentoDa(body: any, masterId: string): Pagamento {
  const metodo: MetodoPagamento = metodoValido(body?.metodo) ? body.metodo : 'bonifico'
  return { metodo, mittente: metodo === 'bonifico' && contabilitaAttiva(masterId) ? (pulisciNome(body?.mittente) || null) : null }
}

// CHECK RICARICHE: ogni credito aggiunto a mano senza una spedizione lascia una riga di controllo
// (contabilita' + anti-truffa). Aspetta un bonifico solo la ricarica o il saldo di una fattura; le altre voci
// (contrassegni compensati, trasferimenti, correzioni, bonus...) entrano col loro metodo e con la descrizione
// nella nota, cosi' restano visibili ma non risultano mai «in attesa di bonifico». Best-effort: non deve mai far
// fallire il movimento, che a questo punto e' gia' scritto. Le ricariche Stripe/carta non passano di qui.
async function tracciaRicarica(admin: any, d: { masterId: string; targetTipo: 'cliente' | 'master'; targetId: string; targetNome: string | null; importo: number; createdBy: string; bonificoEffettuato?: boolean; bonificoArrivato?: boolean; pagamento?: Pagamento; nota?: string | null }) {
  try {
    // Il master dice a che punto e' il bonifico mentre ricarica: "fatto" fa nascere la riga a "bonifico
    // effettuato" (resta da confermare l'incasso), "gia' arrivato" la chiude subito (bonifico istantaneo:
    // prima andava aperto il Check Ricariche solo per segnarlo). Arrivato vuol dire anche effettuato, come
    // vuole la sequenza del Check Ricariche. Contanti o contrassegni compensati non sono un bonifico: niente.
    const bonifico = !d.pagamento || d.pagamento.metodo === 'bonifico'
    const ora = new Date().toISOString()
    const arrivato = bonifico && d.bonificoArrivato === true
    const { error } = await admin.from('ricariche_check').insert({
      master_id: d.masterId, target_tipo: d.targetTipo, target_id: d.targetId,
      target_nome: d.targetNome, importo: Math.abs(d.importo), created_by: d.createdBy,
      bonifico_effettuato_il: bonifico && (d.bonificoEffettuato || arrivato) ? ora : null,
      bonifico_arrivato_il: arrivato ? ora : null,
      ...(d.pagamento ? { metodo: d.pagamento.metodo, mittente: d.pagamento.mittente } : {}),
      ...(d.nota ? { note: d.nota } : {}),
    })
    if (error) console.error('[ricariche-check] tracciamento fallito', error.message)
  } catch (e) { console.error('[ricariche-check] tracciamento fallito', e) }
  // Il nome scritto nella ricarica entra fra i pagatori del cliente: la prossima volta e' gia' proposto.
  if (d.pagamento?.mittente) {
    try {
      await ricordaPagatore(admin, { masterId: d.masterId, targetTipo: d.targetTipo, targetId: d.targetId, nome: d.pagamento.mittente, origine: 'ricarica', createdBy: d.createdBy, usato: true })
    } catch (e) { console.error('[pagatori] salvataggio fallito', e) }
  }
}

// Le due cose che la voce chiede al Check Ricariche: il metodo e la nota.
function perIlCheck(voce: VoceManuale, importo: number, body: { metodo?: unknown; mittente?: unknown }, masterId: string, descrizione: string): { pagamento: Pagamento; nota: string | null } {
  if (chiedeBonifico(voce, importo)) return { pagamento: pagamentoDa(body, masterId), nota: null }
  return { pagamento: { metodo: metodoNelCheck(voce), mittente: null }, nota: descrizione }
}

// Il pacco su cui si scrive deve essere di chi paga: una spedizione del cliente presso questo master, o una
// della rete del sotto-master. Un numero di qualcun altro si rifiuta senza dire di chi e'. Due letture per
// uguaglianza, una sul numero e una sul tracking: il master scrive quello che ha sotto mano.
async function trovaSpedizione(admin: SupabaseClient, numero: string, va: (s: Spedizione) => boolean, preferita: (s: Spedizione) => boolean = () => true) {
  const trovate: Spedizione[] = []
  for (const campo of ['numero', 'tracking_number']) {
    const { data, error } = await admin.from('spedizioni').select('id,numero,tracking_number,master_id,cliente_id,dest_nome').eq(campo, numero).limit(50)
    if (error) throw new Error(error.message)
    for (const s of (data || []) as Spedizione[]) if (!trovate.some((x) => x.id === s.id)) trovate.push(s)
  }
  const buone = trovate.filter(va)
  return buone.find(preferita) || buone[0] || null
}

// Un reso si addebita una volta per pacco e per chi paga (indici uniq_mov_reso_* e trigger
// fn_reso_una_volta_per_pacco): il secondo lo rifiuta il database, qui si dice cosa fare.
function messaggioErrore(e: unknown, ripiego: string): string {
  const m = String((e as Error | null)?.message || '')
  if (/uniq_mov_reso|gia'? addebitato/i.test(m)) return 'Il reso di questa spedizione è già addebitato: per cambiarne l\'importo usa «Rimborso» sulla stessa spedizione.'
  return m || ripiego
}

// Sulla spedizione: la voce del pacco la vuole del cliente o della sua rete. Fuori dal portale: se il numero
// e' invece una spedizione del portale, si dice di usare la voce della spedizione, cosi' il movimento finisce
// nel suo report invece che fra i costi senza pacco.
async function spedizioneDellaVoce(admin: SupabaseClient, voce: VoceManuale, numero: string, va: (s: Spedizione) => boolean, preferita?: (s: Spedizione) => boolean): Promise<{ spedizione: Spedizione | null; errore: string | null }> {
  if (voce.famiglia === 'pacco') {
    const s = await trovaSpedizione(admin, numero, va, preferita)
    return s ? { spedizione: s, errore: null } : { spedizione: null, errore: `La spedizione ${numero} non risulta fra le sue: controlla il numero.` }
  }
  if (voce.id === 'fuori_portale' && numero) {
    const n = numeroSpedizionePulito(numero)
    if (n && await trovaSpedizione(admin, n, va)) {
      return { spedizione: null, errore: `La spedizione ${n} è sul portale: scegli Giacenza, Rettifica, Reso o Rimborso.` }
    }
  }
  return { spedizione: null, errore: null }
}

// A chi va il movimento: un cliente di questo master o un sotto-master della sua rete.
type Bersaglio = { clienteId: string } | { sottoMasterId: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// STORNO DI UNA RICARICA: quella scelta deve essere un accredito a mano senza pacco scritto da questo master a
// questo stesso destinatario, e lo storno non puo' togliere piu' di quanto era stato caricato.
async function ricaricaScelta(admin: SupabaseClient, storna: unknown, masterId: string, b: Bersaglio, importo: number): Promise<{ ricarica: RicaricaDaStornare | null, errore: string | null }> {
  const s = String(storna ?? '').trim()
  if (!s || s === NON_E_UNA_RICARICA) return { ricarica: null, errore: null }
  if (!UUID.test(s)) return { ricarica: null, errore: 'La ricarica scelta non è valida: ricarica la pagina e sceglila di nuovo.' }
  const { data: m, error } = await admin.from('movimenti')
    .select('id,master_id,cliente_id,master_target_id,tipo,importo,spedizione_id,voce,descrizione,created_at').eq('id', s).maybeSingle()
  if (error) throw new Error(error.message)
  const delDestinatario = !!m && ('clienteId' in b ? m.cliente_id === b.clienteId : (m.master_target_id === b.sottoMasterId && !m.cliente_id))
  if (!m || !delDestinatario || m.master_id !== masterId || m.tipo !== 'ricarica' || !(Number(m.importo) > 0) || m.spedizione_id) {
    return { ricarica: null, errore: 'La ricarica scelta non è fra le sue: ricarica la pagina e sceglila di nuovo.' }
  }
  if (Math.abs(importo) > Number(m.importo) + 0.005) {
    return { ricarica: null, errore: `Lo storno (${euro(Math.abs(importo))} €) è più grande della ricarica scelta (${euro(Number(m.importo))} €).` }
  }
  return { ricarica: { id: m.id, quando: m.created_at, importo: Number(m.importo), voce: m.voce, descrizione: m.descrizione }, errore: null }
}

// SPEDIZIONE FUORI DAL PORTALE: il costo pagato dal master sta in costi_fuori_portale (solo il server la legge: i
// clienti non vedono quanto ha speso il loro master). Si controlla che la tabella risponda PRIMA di scrivere il
// movimento: senza costo l'addebito entrerebbe nel guadagno per intero.
async function costiPronti(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from('costi_fuori_portale').select('movimento_id', { head: true, count: 'exact' }).limit(1)
  return !error
}
// La funzione del database restituisce solo il saldo: il movimento appena scritto si ritrova fra gli ultimi di chi
// l'ha scritto, con la stessa voce, lo stesso importo e lo stesso destinatario (il primo senza costo).
async function salvaCosto(admin: SupabaseClient, d: { masterId: string, b: Bersaglio, importo: number, costo: number, userId: string }): Promise<boolean> {
  let q = admin.from('movimenti').select('id').eq('master_id', d.masterId).eq('created_by', d.userId)
    .eq('voce', 'fuori_portale').eq('importo', d.importo).gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
  q = 'clienteId' in d.b ? q.eq('cliente_id', d.b.clienteId) : q.eq('master_target_id', d.b.sottoMasterId).is('cliente_id', null)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(5)
  if (error) throw new Error(error.message)
  for (const m of (data || []) as { id: string }[]) {
    const { error: e } = await admin.from('costi_fuori_portale').insert({ movimento_id: m.id, master_id: d.masterId, costo: d.costo, created_by: d.userId })
    if (!e) return true
    if (e.code !== '23505') throw new Error(e.message)   // 23505: quel movimento ha gia' il suo costo, si prova il precedente
  }
  return false
}

// Cosa dire dopo, oltre alla riga registrata.
function avvisoDopo(esitoCheck: string | null, costoSalvato: boolean | null): string | null {
  const parti: string[] = []
  if (esitoCheck === 'tolta') parti.push('La ricarica corretta è uscita dal Check Ricariche.')
  if (esitoCheck === 'ridotta') parti.push('Nel Check Ricariche la ricarica corretta è stata ridotta.')
  if (esitoCheck === 'nota') parti.push('Il bonifico della ricarica corretta risultava già arrivato: nel Check Ricariche c\'è la nota.')
  if (esitoCheck === 'errore') parti.push('Il Check Ricariche non si è aggiornato: togli a mano la riga della ricarica corretta.')
  if (costoSalvato === false) parti.push('ATTENZIONE: il costo che hai pagato non è stato salvato, quindi il guadagno conta l\'addebito per intero. Avvisa l\'assistenza.')
  return parti.length ? parti.join(' ') : null
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, master_id').eq('id', user.id).single()

  // Solo il master può registrare movimenti manuali (ricariche, resi, rettifiche)
  if (!utente?.master_id || !gestisceLaRete(utente)) {   // muove credito: solo master/admin/operatore, non agente/autista/cliente
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const body = await req.json()
  const { clienteId } = body
  const importo = Number(body.importo)

  if (!clienteId) return NextResponse.json({ error: 'clienteId mancante' }, { status: 400 })
  const voce = voceManuale(body.voce)
  if (!voce) {
    return NextResponse.json({ error: body.voce ? 'Voce del movimento non valida' : 'Ricarica la pagina: ora si sceglie che movimento è.' }, { status: 400 })
  }
  const testo = pulisciTesto(body.testo)
  const numeroScritto = String(body.numero ?? '').trim()
  const extra = { storna: body.storna, costo: body.costo, numeroConfermato: body.numeroConfermato === true }
  const errVoce = erroreVoce(voce, importo, numeroScritto, testo, extra)
  if (errVoce) {
    // Una pagina aperta da prima di questo rilascio non ha i campi nuovi: si dice di ricaricarla.
    const vecchia = (chiedeRicaricaDaStornare(voce, importo) && body.storna === undefined) || (chiedeCosto(voce, importo) && body.costo === undefined)
      || (numeroFatturaDaConfermare(voce, numeroScritto) && body.numeroConfermato === undefined)
    return NextResponse.json({ error: vecchia ? `${errVoce} Se non vedi il campo, ricarica la pagina.` : errVoce }, { status: 400 })
  }
  const numero = voce.campo?.chiave === 'spedizione' ? numeroSpedizionePulito(numeroScritto)! : numeroScritto
  const tipo = tipoDiVoce(voce, importo)
  const costo = chiedeCosto(voce, importo) ? costoLetto(body.costo) : null
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  if (costo !== null && !(await costiPronti(admin))) {
    return NextResponse.json({ error: 'Il costo delle spedizioni fuori dal portale non si può ancora salvare: il movimento non è stato registrato. Riprova tra poco.' }, { status: 503 })
  }

  // Lo storno e il costo, dopo che il movimento e' scritto: tutti e due best-effort, il movimento resta.
  const dopo = async (b: Bersaglio, ricarica: RicaricaDaStornare | null, descrizione: string) => {
    const esitoCheck = ricarica
      ? await chiudiRigaDellaRicarica(admin, { masterId: utente.master_id, targetId: 'clienteId' in b ? b.clienteId : b.sottoMasterId, ricarica, storno: importo, descrizione, userId: user.id })
      : null
    let costoSalvato: boolean | null = null
    if (costo !== null) {
      try { costoSalvato = await salvaCosto(admin, { masterId: utente.master_id, b, importo, costo, userId: user.id }) }
      catch (e) { console.error('[fuori-portale] costo non salvato', e); costoSalvato = false }
      if (!costoSalvato) console.error('[fuori-portale] costo non salvato: movimento non ritrovato', { master: utente.master_id, importo })
    }
    return avvisoDopo(esitoCheck, costoSalvato)
  }

  // Stessa scrittura per il sotto-master, che arrivi col prefisso m: o senza (vedi sotto).
  const alSottoMaster = async (targetMasterId: string, nome: string | null) => {
    try {
      const b: Bersaglio = { sottoMasterId: targetMasterId }
      const rete = await sottoAlberoMasterIds(admin, targetMasterId)
      const { spedizione, errore } = await spedizioneDellaVoce(admin, voce, numero, (x) => !!x.master_id && rete.includes(x.master_id), (x) => x.master_id === targetMasterId)
      if (errore) return NextResponse.json({ error: errore.replace('fra le sue', `nella rete di ${nome || 'questo master'}`) }, { status: 400 })
      const { ricarica, errore: errStorno } = chiedeRicaricaDaStornare(voce, importo) ? await ricaricaScelta(admin, body.storna, utente.master_id, b, importo) : { ricarica: null, errore: null }
      if (errStorno) return NextResponse.json({ error: errStorno }, { status: 400 })
      const numeroVisto = spedizione ? (spedizione.tracking_number || spedizione.numero || numero) : numero
      const descrizione = descrizioneMovimento(voce, numeroVisto, ricarica ? testoDelloStorno(ricarica, testo) : testo)
      const { saldo } = await registraMovimentoMaster(admin, {
        masterOwnerId: utente.master_id, masterTargetId: targetMasterId,
        tipo, descrizione, riferimento: spedizione?.numero || null,
        importo, spedizioneId: spedizione?.id || null, createdBy: user.id, voce: voce.id,
      })
      if (importo > 0 && voce.famiglia !== 'pacco') {
        await tracciaRicarica(admin, { masterId: utente.master_id, targetTipo: 'master', targetId: targetMasterId, targetNome: nome, importo, createdBy: user.id, bonificoEffettuato: body.bonificoEffettuato === true, bonificoArrivato: body.bonificoArrivato === true, ...perIlCheck(voce, importo, body, utente.master_id, descrizione) })
      }
      return NextResponse.json({ ok: true, saldo, descrizione, avviso: await dopo(b, ricarica, descrizione) })
    } catch (e) {
      return NextResponse.json({ error: messaggioErrore(e, 'Errore movimento sotto-master') }, { status: 500 })
    }
  }

  // Autorizzato se il mio master è un ANTENATO del sotto-master (figlio diretto o più in basso
  // nella rete), coerente con accesso/impersona che risalgono la catena parent_master_id.
  const sottoMasterMio = async (targetId: string) => {
    const { data: sub } = await admin.from('masters').select('id,parent_master_id,nome').eq('id', targetId).maybeSingle()
    let cur: string | null = sub?.parent_master_id || null
    for (let i = 0; i < 20 && cur; i++) {
      if (cur === utente.master_id) return sub
      const { data: p } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
      cur = p?.parent_master_id || null
    }
    return null
  }

  // Credito di un SOTTO-MASTER agganciato (id = "m:<masterId>")
  if (typeof clienteId === 'string' && clienteId.startsWith('m:')) {
    const sub = await sottoMasterMio(clienteId.slice(2))
    if (!sub) return NextResponse.json({ error: 'Sotto-master non trovato o non autorizzato' }, { status: 403 })
    return alSottoMaster(sub.id, sub.nome || null)
  }

  // Verifica che il cliente appartenga a questo master
  const { data: cli } = await supabase
    .from('clienti').select('id, master_id, ragione_sociale').eq('id', clienteId).single()
  if (!cli || cli.master_id !== utente.master_id) {
    // Fallback robusto: l'id potrebbe essere quello di un SOTTO-MASTER della rete inviato
    // SENZA il prefisso m: (bug frontend). Se è un master discendente, lo tratto come sotto-master.
    const sub = await sottoMasterMio(clienteId)
    if (sub) return alSottoMaster(sub.id, sub.nome || null)
    return NextResponse.json({ error: 'Cliente non trovato o non autorizzato' }, { status: 403 })
  }

  try {
    const b: Bersaglio = { clienteId }
    const { spedizione, errore } = await spedizioneDellaVoce(admin, voce, numero, (x) => x.cliente_id === clienteId)
    if (errore) return NextResponse.json({ error: errore.replace('fra le sue', `fra le spedizioni di ${cli.ragione_sociale || 'questo cliente'}`) }, { status: 400 })
    const { ricarica, errore: errStorno } = chiedeRicaricaDaStornare(voce, importo) ? await ricaricaScelta(admin, body.storna, utente.master_id, b, importo) : { ricarica: null, errore: null }
    if (errStorno) return NextResponse.json({ error: errStorno }, { status: 400 })
    const numeroVisto = spedizione ? (spedizione.tracking_number || spedizione.numero || numero) : numero
    const descrizione = descrizioneMovimento(voce, numeroVisto, ricarica ? testoDelloStorno(ricarica, testo) : testo)
    const { saldo } = await registraMovimento(supabase, {
      masterId: utente.master_id,
      clienteId,
      tipo,
      descrizione,
      riferimento: spedizione?.numero || null,
      importo,
      spedizioneId: spedizione?.id || null,
      createdBy: user.id,
      voce: voce.id,
    })
    if (importo > 0 && voce.famiglia !== 'pacco') {
      await tracciaRicarica(admin, { masterId: utente.master_id, targetTipo: 'cliente', targetId: clienteId, targetNome: cli.ragione_sociale || null, importo, createdBy: user.id, bonificoEffettuato: body.bonificoEffettuato === true, bonificoArrivato: body.bonificoArrivato === true, ...perIlCheck(voce, importo, body, utente.master_id, descrizione) })
    }
    return NextResponse.json({ ok: true, saldo, descrizione, avviso: await dopo(b, ricarica, descrizione) })
  } catch (e) {
    return NextResponse.json({ error: messaggioErrore(e, 'Errore registrazione movimento') }, { status: 500 })
  }
}
