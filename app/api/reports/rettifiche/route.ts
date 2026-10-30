import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'
import { eDiscendente } from '@/lib/rete-masters'
import { fetchAllStretto } from '@/lib/fetch-all'
import { confineGiornoRoma, giornoRoma } from '@/lib/date-roma'
import { vettoreFisico } from '@/lib/vettore'
import { senzaNomiFornitori } from '@/lib/corriere-logo'

export const dynamic = 'force-dynamic'
// Un mese di "Tutti i clienti" di MULTIEXPRESS sono ~22.000 spedizioni in un centinaio di blocchi:
// con 60 s un trimestre non ci stava (stessa durata delle altre rotte pesanti del portale).
export const maxDuration = 300

// REPORT RETTIFICHE: quanto e' stato davvero addebitato (o restituito) per rettifiche a un cliente,
// a un sotto-master o a un master collegato "(ingrosso)", nel periodo. Si legge dai MOVIMENTI, la
// fonte unica dei soldi, per data del MOVIMENTO.
//
// Prima si partiva dalla tabella `rettifiche` e si filtrava per data della SPEDIZIONE. Sui dati veri
// dell'1-14/10/2026 voleva dire:
// - report VUOTO per 18 clienti e sotto-master (MULTI→QUICK, →GTS, →Velox, FEDEL FARMA, FUTURAL...):
//   si leggevano le prime 1.000 rettifiche (le piu' VECCHIE) e poi `.in('id', ...)` con fino a 1.000
//   uuid, che PostgREST respinge (400) oltre ~637; l'errore non si guardava. 3.401 rettifiche per
//   6.547,25 € sparite;
// - una rettifica arriva in mediana 5,9 giorni dopo la spedizione: il periodo "oggi" non trovava niente;
// - dentro c'erano 263 rettifiche MAI addebitate (−2.008,70 €, ancora "da rettificare"), e fuori
//   restavano i supplementi (penale BRT, fuori sagoma, appuntamento) e le "Correzione peso/misure", che
//   sono soldi addebitati senza una riga di `rettifiche` (50 movimenti, −219,61 €);
// - un master collegato "(ingrosso)" usciva sempre vuoto: la sua rettifica sta sul cliente-ledger;
// - per l'operatore era vuoto sui clienti: la RLS di `rettifiche` ammette solo master e admin.
// Ora: righe = movimenti 'rettifica' con spedizione ADDEBITATI al soggetto scelto, netto per
// spedizione; la riga di `rettifiche` serve solo a spiegare pesi e costi, mai a decidere la cifra.

const SEL_MOV = 'id,master_id,cliente_id,master_target_id,importo,riferimento,descrizione,spedizione_id,created_at'
const BLOCCO = 200      // id per richiesta: oltre ~25 KB di URL PostgREST risponde 400
const PARALLELO = 6     // blocchi letti insieme: MULTI "Tutti" a settembre sono 22.123 spedizioni, 111 blocchi

const r2 = (n: number) => Math.round(n * 100) / 100
// RIP-<spedizione>-<destinatario>: la chiave con cui la conferma di una riga di `rettifiche` scrive il
// movimento (app/api/rettifiche). Il destinatario e' target_master_id || cliente_id della riga: per un
// master collegato il movimento sta sul ledger ma la riga ha target_master_id, ed e' da qui che si ritrova.
const RE_RIP = /^RIP-([0-9a-f-]{36})-([0-9a-f-]{36})$/i

async function aBlocchi<T>(ids: string[], leggi: (blocco: string[]) => Promise<T[]>): Promise<T[]> {
  const blocchi: string[][] = []
  for (let i = 0; i < ids.length; i += BLOCCO) blocchi.push(ids.slice(i, i + BLOCCO))
  const out: T[] = []
  for (let i = 0; i < blocchi.length; i += PARALLELO) {
    const parti = await Promise.all(blocchi.slice(i, i + PARALLELO).map(leggi))
    for (const p of parti) out.push(...p)
  }
  return out
}

type Soggetti = { clienti: string[]; masters: string[] }

async function righeRettifiche(admin: any, viewerId: string, sogg: Soggetti, dal: string | null, al: string | null, vettore: string, nomi: Map<string, string>) {
  const periodo = (q: any) => {
    q = q.eq('tipo', 'rettifica').not('spedizione_id', 'is', null)
    if (dal) q = q.gte('created_at', dal)
    if (al) q = q.lte('created_at', al)
    // Ordine stabile: si legge a pagine da 1.000, e righe con lo stesso istante cambiavano pagina.
    return q.order('created_at', { ascending: true }).order('id', { ascending: true })
  }
  // Sotto-master: il suo conto RETE. Sul conto 'proprio' stanno i costi dei SUOI contratti, che la
  // rete sopra non gli ha addebitato.
  const movSub: any[] = await aBlocchi(sogg.masters, (b) => fetchAllStretto(() => periodo(admin.from('movimenti').select(SEL_MOV)
    .in('master_target_id', b).is('cliente_id', null).or('conto.is.null,conto.neq.proprio'))))
  // Il movimento che il sotto-master scrive su SE STESSO (master_id = master_target_id) e' un addebito
  // verso di me solo se io sto nella catena di quella spedizione: stessa regola dei report di margine
  // (il padre ricava dal "proprio" del figlio solo se ha un suo costo 'spedizione' su quel pacco). Senza
  // la regola, scegliendo MULTI dalla piattaforma entravano i 18.085 addebiti del suo fornitore (da
  // meta' agosto, −47.334 €), che con la rete sopra non c'entrano; scartandoli tutti, invece, si perdevano
  // i pochi veri (Ecomize Solution, GTS, spedizioni 2000: 6 movimenti, tutti con il padre in catena).
  // "Sto nella catena" vale anche quando il pacco lo pago sul mio conto "(ingrosso)" presso chi mi vende
  // il contratto (SDA EXPRESS L: MULTIEXPRESS paga Wave sul ledger, non ha un movimento a se stessa):
  // senza, su quei pacchi i movimenti veri del sotto-master sparivano. I miei ledger d'acquisto sono
  // quelli dei legami in cui il compratore sono io.
  const spedSelf = Array.from(new Set(movSub.filter((m) => m.master_id === m.master_target_id).map((m) => m.spedizione_id as string)))
  const inCatena = new Set<string>()
  if (spedSelf.length) {
    const { data: legami, error: eLeg } = await admin.from('corrieri_condivisi').select('cliente_ledger_id')
      .eq('master_id', viewerId).eq('stato', 'attiva')
    if (eLeg) throw new Error('legami: ' + eLeg.message)
    const mieiLedger = Array.from(new Set((legami || []).map((l: any) => l.cliente_ledger_id).filter(Boolean))) as string[]
    const condizione = `and(tipo.eq.spedizione,master_target_id.eq.${viewerId})` + (mieiLedger.length ? `,cliente_id.in.(${mieiLedger.join(',')})` : '')
    const mie = await aBlocchi(spedSelf, (b) => fetchAllStretto(() => admin.from('movimenti').select('id,spedizione_id')
      .in('spedizione_id', b).or(condizione).order('spedizione_id', { ascending: true }).order('id', { ascending: true })))
    for (const m of mie as any[]) inCatena.add(m.spedizione_id)
  }
  const movimenti: any[] = [
    // Cliente diretto o master collegato: il conto e' il cliente (per il collegato, il suo ledger), e
    // l'addebito e' quello scritto da ME. Sulla stessa spedizione condivisa possono esserci anche
    // movimenti di altri master sui loro conti: non sono miei e non vanno nel mio report.
    ...(await aBlocchi(sogg.clienti, (b) => fetchAllStretto(() => periodo(admin.from('movimenti').select(SEL_MOV).in('cliente_id', b)))))
      .filter((m: any) => m.master_id === viewerId),
    // Sotto-master: gli addebiti scritti da ME verso di lui, o da lui su se stesso quando sto nella catena.
    // Mai quelli di un terzo: LOGIXIA che addebita a Wave 0,57 € (282343J006009, 13/10/2026) e' un debito
    // di Wave verso LOGIXIA, e finiva nel report di MULTIEXPRESS "verso Wave"; e scegliendo a mano un
    // sotto-master di secondo livello uscivano gli addebiti del SUO padre, non i miei.
    ...movSub.filter((m: any) => m.master_id === viewerId || (m.master_id === m.master_target_id && inCatena.has(m.spedizione_id))),
  ]
  if (!movimenti.length) return []

  // NETTO PER SPEDIZIONE E DESTINATARIO: una ripesatura, il suo supplemento e una correzione successiva
  // sono tre movimenti dello stesso pacco, e al cliente si dice quanto ha pagato in tutto.
  const soggettoDi = (m: any) => m.cliente_id || ('m:' + m.master_target_id)
  const gruppi = new Map<string, { sped: string; sogg: string; mov: any[] }>()
  for (const m of movimenti) {
    const k = m.spedizione_id + '|' + soggettoDi(m)
    if (!gruppi.has(k)) gruppi.set(k, { sped: m.spedizione_id, sogg: soggettoDi(m), mov: [] })
    gruppi.get(k)!.mov.push(m)
  }
  const spedIds = Array.from(new Set(movimenti.map((m) => m.spedizione_id as string)))

  const [rimborsi, rett, speds] = await Promise.all([
    // Rettifica STORNATA: la spedizione e' stata annullata e lib/annullaSpedizione ha restituito allo
    // stesso destinatario ogni addebito, rettifica compresa. Non e' piu' dovuta: in un report da girare
    // al cliente farebbe pagare un importo gia' restituito.
    aBlocchi(spedIds, (b) => fetchAllStretto(() => admin.from('movimenti')
      .select('id,spedizione_id,cliente_id,master_target_id').eq('tipo', 'rimborso').in('spedizione_id', b).order('spedizione_id', { ascending: true }).order('id', { ascending: true }))),
    // Righe di `rettifiche` CONFERMATE (quelle aperte non hanno mosso un euro). Mai costo_fornitore: e'
    // il costo a monte, non quello del destinatario.
    aBlocchi(spedIds, (b) => fetchAllStretto(() => admin.from('rettifiche')
      .select('id,spedizione_id,master_id,cliente_id,target_master_id,peso_iniziale,peso_volume_iniziale,peso_reale,peso_volume_reale,costo_iniziale,costo_finale,differenza,fuori_sagoma,supplementi_nomi,created_at')
      .eq('confermata', true).in('spedizione_id', b).order('created_at', { ascending: true }).order('id', { ascending: true }))),
    // Numero e contratto della spedizione (MAI colli_dettaglio: contiene le etichette in base64).
    aBlocchi(spedIds, async (b) => {
      const { data, error } = await admin.from('spedizioni').select('id,numero,stato,corrieri(tipo,nome_contratto)').in('id', b)
      if (error) throw new Error('spedizioni: ' + error.message)
      return (data || []) as any[]
    }),
  ])
  const stornate = new Set(rimborsi.map((r: any) => r.spedizione_id + '|' + soggettoDi(r)))
  const rettPerSped = new Map<string, any[]>()
  for (const r of rett as any[]) {
    if (!rettPerSped.has(r.spedizione_id)) rettPerSped.set(r.spedizione_id, [])
    rettPerSped.get(r.spedizione_id)!.push(r)
  }
  const spedById = new Map<string, any>(speds.map((s: any) => [s.id, s]))

  const righe: any[] = []
  for (const g of gruppi.values()) {
    const s = spedById.get(g.sped)
    // Stornata solo se la spedizione e' ANNULLATA: l'annullo restituisce ogni addebito, rettifica
    // compresa. Un rimborso qualsiasi non basta: lo storno di un reso (4UW1UHA029794, Giga 0,73 e Wind
    // Rose 0,81) faceva sparire una rettifica che resta dovuta.
    if (s?.stato === 'annullata' && stornate.has(g.sped + '|' + g.sogg)) continue
    const netto = r2(g.mov.reduce((s, m) => s + (Number(m.importo) || 0), 0))
    if (Math.abs(netto) < 0.005) continue   // addebito e storno nello stesso periodo: niente da dire
    const c: any = Array.isArray(s?.corrieri) ? s.corrieri[0] : s?.corrieri
    const vf = c ? vettoreFisico({ tipo: c.tipo, nome_contratto: c.nome_contratto }) : ''
    if (vettore && vf !== vettore) continue

    // La riga di `rettifiche` che ha generato il movimento RIP- (stesso pacco, stesso master che addebita,
    // stesso destinatario). Se ce n'e' piu' d'una confermata, quella il cui importo e' proprio il movimento.
    let dett: any = null
    let movDett: any = null
    for (const m of g.mov) {
      const rip = RE_RIP.exec(String(m.riferimento || ''))
      if (!rip) continue
      const cand = (rettPerSped.get(g.sped) || []).filter((r: any) =>
        r.master_id === m.master_id && (r.target_master_id || r.cliente_id) === rip[2])
      if (!cand.length) continue
      dett = cand.find((r: any) => Math.abs(r2((Number(r.differenza) || 0) - (Number(r.fuori_sagoma) || 0)) - Number(m.importo)) < 0.005)
        || cand[cand.length - 1]
      movDett = m
      break
    }
    // Causale: quello che i pesi non spiegano. Senza riga di `rettifiche` (supplementi, correzioni di
    // peso/misure, POD) e' la descrizione del movimento; con la riga, il supplemento fuori sagoma e gli
    // eventuali altri movimenti dello stesso pacco. Senza nomi dei fornitori tecnici: il file va al cliente.
    const causali: string[] = []
    if (dett && Number(dett.fuori_sagoma) > 0) {
      const n = String(dett.supplementi_nomi || '').trim()
      causali.push(`Supplemento${n ? ' ' + n : ''} € ${Number(dett.fuori_sagoma).toFixed(2)}`)
    }
    for (const m of g.mov) if (m !== movDett) causali.push(String(m.descrizione || '').trim())

    const num = (v: any) => (dett ? Number(v) || 0 : null)
    righe.push({
      numero: s?.numero || '',
      data: giornoRoma(new Date(g.mov[0].created_at)),
      cliente: nomi.get(g.sogg) || '—',
      vettore: vf,
      pesoDichiarato: num(dett?.peso_iniziale),
      pesoVolDichiarato: num(dett?.peso_volume_iniziale),
      pesoReale: num(dett?.peso_reale),
      pesoVolReale: num(dett?.peso_volume_reale),
      costoIniziale: num(dett?.costo_iniziale),
      costoFinale: num(dett?.costo_finale),
      causale: senzaNomiFornitori(causali.filter(Boolean).join(' + ')),
      // POSITIVA = addebito, negativa = accredito. Prima era costo_iniziale − costo_finale, e un addebito
      // usciva col meno davanti.
      differenza: r2(-netto),
    })
  }
  righe.sort((a, b) => a.data.localeCompare(b.data) || String(a.cliente).localeCompare(String(b.cliente)) || String(a.numero).localeCompare(String(b.numero)))
  return righe
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const masterId = utente?.master_id
  const agente = isAgente(utente)
  // Da qui in giu' si legge con la chiave di servizio (cosi' funziona anche per l'operatore, che la RLS
  // di `rettifiche` lasciava a mani vuote): il perimetro va controllato a mano. Lo staff del master vede
  // la sua rete, l'agente solo i suoi clienti; cliente e autista niente.
  if (!masterId || (!agente && !vedeLaRete(utente))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const p = req.nextUrl.searchParams
  let clienteIdRaw = p.get('clienteId') || ''                     // vuoto = tutti
  if (clienteIdRaw.includes('%')) { try { clienteIdRaw = decodeURIComponent(clienteIdRaw) } catch {} }
  const dal = confineGiornoRoma(p.get('dal'), 'dal')
  const al = confineGiornoRoma(p.get('al'), 'al')
  const vettore = (p.get('vettore') || '').trim().toUpperCase()

  const admin = createAdminSupabase()
  try {
    const { data: master, error: eM } = await admin.from('masters')
      .select('nome,logo_url,indirizzo,cap,citta,provincia,email,email_sede,piva,partita_iva')
      .eq('id', masterId).maybeSingle()
    if (eM) throw new Error('master: ' + eM.message)

    // I MIEI clienti, ledger "(ingrosso)" compresi: sono clienti del mio master come gli altri.
    let mieiClienti = await fetchAllStretto<any>(() => admin.from('clienti').select('id,ragione_sociale')
      .eq('master_id', masterId).order('id', { ascending: true }))
    if (agente) {
      const miei = new Set(await clientiAgente(supabase, utente))
      mieiClienti = mieiClienti.filter((c: any) => miei.has(c.id))
    }
    const nomi = new Map<string, string>(mieiClienti.map((c: any) => [c.id, c.ragione_sociale || '—']))

    let sogg: Soggetti
    let intestazione = 'Tutti i clienti'
    if (clienteIdRaw.startsWith('m:')) {
      // Sotto-master: solo lo staff, e solo se sta sotto di me (a qualunque livello).
      if (agente) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
      const subId = clienteIdRaw.slice(2)
      if (!(await eDiscendente(admin, subId, masterId))) return NextResponse.json({ error: 'Il sotto-master non e\' della tua rete' }, { status: 403 })
      const { data: sub, error: eS } = await admin.from('masters').select('nome').eq('id', subId).maybeSingle()
      if (eS) throw new Error('sotto-master: ' + eS.message)
      intestazione = sub?.nome || 'Sotto-master'
      nomi.set('m:' + subId, intestazione)
      sogg = { clienti: [], masters: [subId] }
    } else if (clienteIdRaw) {
      if (!nomi.has(clienteIdRaw)) return NextResponse.json({ error: 'Il cliente non e\' tuo' }, { status: 403 })
      intestazione = nomi.get(clienteIdRaw) || 'Cliente'
      sogg = { clienti: [clienteIdRaw], masters: [] }
    } else {
      // Tutti: i miei clienti diretti (ledger compresi) e i sotto-master di PRIMA linea, cioe' chi paga
      // a me. Quelli piu' sotto li paga il loro master, non io.
      let figli: any[] = []
      if (!agente) {
        const { data, error } = await admin.from('masters').select('id,nome').eq('parent_master_id', masterId)
        if (error) throw new Error('sotto-master: ' + error.message)
        figli = data || []
      }
      for (const f of figli) nomi.set('m:' + f.id, f.nome || '—')
      sogg = { clienti: mieiClienti.map((c: any) => c.id), masters: figli.map((f: any) => f.id) }
    }

    const righe = await righeRettifiche(admin, masterId, sogg, dal, al, vettore, nomi)
    const totale = r2(righe.reduce((s, r) => s + r.differenza, 0))
    return NextResponse.json({
      righe, totale, master: master || {},
      cliente: { ragione_sociale: intestazione },
      tuttiClienti: !clienteIdRaw,
    })
  } catch (e: any) {
    console.error('[REPORT RETTIFICHE]', e?.message || e)
    return NextResponse.json({ error: 'Lettura delle rettifiche non riuscita: ' + (e?.message || 'errore') }, { status: 500 })
  }
}
