import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { contrattiDelDetentore, gruppiGls, utenteDetentore } from '@/lib/controllo-fattura-accesso'
import { analizzaFatturaBrt } from '@/lib/controllo-fattura'
import { analizzaFatturaGls } from '@/lib/controllo-fattura-gls'
import { eGls, type RigaFatturaGls } from '@/lib/fattura-gls'
import { costruisciCatena } from '@/lib/cascata'
import { riepilogaFattura, fatturaConAzioni, type EsitoPagina } from '@/lib/controllo-fattura-riepilogo'
import type { RigaFatturaBrt } from '@/lib/fattura-brt'
import { addebitiFuoriPortale, fuoriAltrove, rifiutoStatoFuori } from '@/lib/controllo-fattura-fuori'

// Mille e più righe, ognuna col listino rifatto dalla funzione dell'addebito: serve più del minuto standard.
export const maxDuration = 300

// CONTROLLO FATTURA CORRIERE. La fattura la legge il browser (lib/fattura-brt, la stessa lettura qui e là);
// qui arrivano le righe a pacchetti, si confrontano col costo registrato al detentore e si salvano nello
// storico (fatture_corriere + righe), così la fattura si riapre senza il file. Il costo in Moove non si
// tocca: l'addebito ai clienti lo fa la Rettifica, la pagina le manda le differenze di peso come "solo pesi".
// Chi può usarla: solo il detentore del contratto (lib/controllo-fattura-accesso).
// GLS (dal 24/11): le righe arrivano dal PDF letto da /api/fatture-corriere/gls e si confrontano con
// lib/controllo-fattura-gls; storico, chiusura e Rettifica sono gli stessi di BRT.

// I contratti che si possono controllare: BRT uno per uno, GLS uno per conto (più contratti Moove sullo
// stesso contratto GLS stanno nello stesso PDF).
async function contrattiControllabili(admin: any, masterId: string) {
  const tutti = await contrattiDelDetentore(admin, masterId, ['brt', 'gls'])
  const brt = tutti.filter((c: any) => c.tipo === 'brt').map((c: any) => ({ id: c.id, nome: c.nome_contratto, nome_contratto: c.nome_contratto, attivo: c.attivo, tipo: 'brt' as const, ids: [c.id] }))
  const gls = gruppiGls(tutti).map(g => ({
    id: g.rappresentante.id, tipo: 'gls' as const, ids: g.ids,
    attivo: tutti.some((c: any) => g.ids.includes(c.id) && c.attivo),
    nome: g.ids.length > 1 ? `GLS ${g.codice || ''} (${g.nomi.join(', ')})`.replace('GLS  (', 'GLS (') : g.nomi[0],
    nome_contratto: g.ids.length > 1 ? `GLS ${g.codice || g.nomi[0]}` : g.nomi[0],
  }))
  return [...brt, ...gls]
}

// LA TARIFFA DEI RESI DEL CONTRATTO (Wave, 27/11: 3,50 € fino a 3 kg, poi +0,10 € al kg, più il carburante): nelle
// impostazioni del contratto (corrieri.settings.tariffa_resi), perché il listino di Moove il reso lo dice solo come
// percentuale del nolo. Per un gruppo GLS vale la prima che c'è fra i suoi contratti. Una tariffa scritta male non
// vale: meglio nessuna (il controllo la ricava dal documento) che un numero sbagliato.
function tariffaResiValida(x: any): { base: number; finoKg: number; perKg: number } | null {
  const n = (v: any) => (v === '' || v == null ? NaN : Number(v))
  const t = { base: n(x?.base), finoKg: n(x?.fino_kg ?? x?.finoKg), perKg: n(x?.per_kg ?? x?.perKg) }
  return t.base > 0 && t.base < 1000 && t.finoKg >= 0 && t.finoKg < 1000 && t.perKg >= 0 && t.perKg < 100 ? t : null
}

export async function GET() {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const admin = createAdminSupabase()
  const contratti = await contrattiControllabili(admin, u.masterId)
  const ids = contratti.filter(c => c.tipo === 'gls').flatMap(c => c.ids)
  const tariffe = new Map<string, any>()
  const nomi = new Map<string, string>()
  if (ids.length) {
    const { data, error } = await admin.from('corrieri').select('id,nome_contratto,tariffa:settings->tariffa_resi').in('id', ids)
    if (error) console.warn('[controllo-fattura] tariffa resi non letta', error.message)
    for (const c of data || []) { if ((c as any).tariffa) tariffe.set(c.id, (c as any).tariffa); nomi.set(c.id, String((c as any).nome_contratto || '')) }
  }
  // I listini dei contratti del gruppo (per GLS più contratti Moove sullo stesso contratto GLS): la pagina apre quello
  // da correggere col suo nome, come lo scrive «Cosa allineare nel listino».
  return NextResponse.json({ contratti: contratti.map(c => {
    const t = c.ids.map((id: string) => tariffaResiValida(tariffe.get(id))).find(Boolean) || null
    const listini = c.ids.filter((id: string) => nomi.has(id)).map((id: string) => ({ id, nome: nomi.get(id)! }))
    return { id: c.id, nome: c.nome, attivo: c.attivo, tipo: c.tipo, ...(t ? { tariffaResi: t } : {}), ...(listini.length ? { listini } : {}) }
  }) })
}

type Corpo = {
  contrattoId?: string
  righe?: RigaFatturaBrt[]
  fatturaId?: string
  testata?: { numeroFattura?: string; dataFattura?: string | null; nomeFile?: string; legenda?: Record<string, string>; gls?: any }
  chiudi?: boolean
  rifai?: boolean                    // rifare con le regole di oggi una fattura già controllata, tenendo le azioni
  perche?: { id: string; peso: number }[]   // spedizioni da girare rimaste senza rettifica: perché
  statoVoce?: { chiave: string; stato: string | null; nota?: string; importo?: number; numero?: string; listino?: { id: string; nome?: string; di?: string }
    cliente?: { id?: string; nome?: string }; addebito?: 'in_corso' | 'fatto' | 'stornato'; incassato?: boolean | null; avviso?: string
    daMovimento?: boolean      // 'fatto' perché l'addebito c'è già fra i movimenti (lo cerca e lo legge la rotta)
    confermaDopoPagata?: boolean }   // addebito di una spedizione che era stata segnata pagata e poi annullata: confermato
  esterno?: { nome: string; formato?: string; righeFile?: number; abbinate?: string[]; andate?: number; corriereAndate?: number; prezzoClienti?: number; rientri?: number; rettifiche?: number }   // l'export di un altro gestionale abbinato
  rettificheFileId?: string
  fileEsterno?: { nome?: string; righe?: number }
  legenda?: Record<string, string>   // il PDF aggiunto dopo, a fattura già controllata
}

// La legenda arriva dal browser: si tengono solo coppie sigla di un carattere → nome corto.
const pulisciLegenda = (l: any): Record<string, string> | null => {
  if (!l || typeof l !== 'object') return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(l).slice(0, 40)) if (/^\S$/.test(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 20)
  return Object.keys(out).length ? out : null
}

// LE RETTIFICHE FATTE FUORI DAL PULSANTE. Le differenze si possono girare anche caricando un proprio file nella
// pagina Rettifica: il 24/11 Wave ha girato così le 25 della BRT 74855 (file del suo altro gestionale), la fattura
// non lo sapeva, risultava "senza azioni" e il 25/11 il caricamento dell'allegato GLS l'ha tolta dallo storico.
// Per ogni fattura: le rettifiche del detentore, non annullate, sulle spedizioni abbinate. Una lettura non
// riuscita torna null: chi decide se togliere una fattura, nel dubbio la tiene.
// IL RIEPILOGO DELLA FATTURA SI CAMBIA SUL VALORE DI ADESSO, E SOLO SE NESSUNO L'HA CAMBIATO NEL FRATTEMPO. Ogni
// ramo di questa rotta riscriveva tutto il riepilogo da una copia letta all'inizio della richiesta, anche secondi
// prima (la chiusura legge tutte le righe, il collegamento della Rettifica legge le rettifiche): uno stato salvato in
// mezzo, per esempio l'addebito di una spedizione fuori da tutto appena fatto, spariva senza un avviso, e il conto
// perdeva l'incasso (revisione del 27/11, prima del rilascio). Qui si rilegge, si cambia, e si scrive solo se il
// contatore `rev` del riepilogo è ancora quello letto; altrimenti si rilegge e si rifà. `cambia` può rispondere con
// un rifiuto (NextResponse): i controlli sullo stato si fanno sul valore appena letto.
async function cambiaRiepilogo(admin: any, id: string, cambia: (r: Record<string, any>) => Record<string, any> | null | NextResponse,
  altreColonne: Record<string, any> = {}): Promise<{ riepilogo: Record<string, any> | null } | { risposta: NextResponse }> {
  for (let i = 0; i < 6; i++) {
    const { data, error } = await admin.from('fatture_corriere').select('riepilogo').eq('id', id).maybeSingle()
    if (error) return { risposta: NextResponse.json({ error: 'Lettura fattura non riuscita: ' + error.message }, { status: 500 }) }
    const prima = (data?.riepilogo || {}) as Record<string, any>
    const fatto = cambia(prima)
    if (fatto instanceof NextResponse) return { risposta: fatto }
    const rev = Number(prima.rev) || 0
    const nuovo = fatto == null ? null : { ...fatto, rev: rev + 1 }
    let q = admin.from('fatture_corriere').update({ ...altreColonne, riepilogo: nuovo }).eq('id', id)
    q = prima.rev == null ? q.is('riepilogo->>rev', null) : q.eq('riepilogo->>rev', String(prima.rev))
    const { data: scritte, error: e2 } = await q.select('id')
    if (e2) return { risposta: NextResponse.json({ error: 'Salvataggio non riuscito: ' + e2.message }, { status: 500 }) }
    if (scritte?.length) return { riepilogo: nuovo }
    await new Promise(ok => setTimeout(ok, 60 + Math.random() * 120))
  }
  return { risposta: NextResponse.json({ error: 'La fattura è stata cambiata da un\'altra parte mentre salvavo: riprova.' }, { status: 409 }) }
}

async function rettificheSulleSpedizioni(admin: any, masterId: string, fattureIds: string[]): Promise<Map<string, string[]> | null> {
  const out = new Map<string, string[]>()
  for (const fid of fattureIds) {
    const sped = new Set<string>()
    for (let da = 0; ; da += 1000) {
      const { data, error } = await admin.from('fatture_corriere_righe').select('spedizione_id').eq('fattura_id', fid).not('spedizione_id', 'is', null).order('id').range(da, da + 999)
      if (error) return null
      for (const r of data || []) sped.add(r.spedizione_id)
      if ((data || []).length < 1000) break
    }
    const ids = Array.from(sped), trovate: string[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin.from('rettifiche').select('id').eq('master_id', masterId).in('spedizione_id', ids.slice(i, i + 200))
        .or('propagazione.is.null,propagazione.neq.annullata').limit(1000)
      if (error || (data || []).length >= 1000) return null
      trovate.push(...(data || []).map((r: any) => r.id))
    }
    if (trovate.length) out.set(fid, trovate)
  }
  return out
}

// Quello che la pagina sa del documento GLS (tracciato, periodo, carburante per contratto): si salva con la
// fattura, così riaprendola dallo storico l'avviso sul carburante c'è ancora. Arriva dal browser: si tengono
// solo numeri e testi corti.
const pulisciGls = (g: any) => {
  if (!g || typeof g !== 'object') return null
  const n = (v: any) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  const d = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  return {
    tracciato: g.tracciato === 'allegato' ? 'allegato' : 'bordero',
    titolo: String(g.titolo || '').slice(0, 120), dal: d(g.dal), al: d(g.al),
    totaleCliente: n(g.totaleCliente), carburanteListino: n(g.carburanteListino),
    contratti: (Array.isArray(g.contratti) ? g.contratti : []).slice(0, 10).map((c: any) => ({
      codice: String(c?.codice || '').slice(0, 12), righe: n(c?.righe) ?? 0, nolo: n(c?.nolo) ?? 0,
      carburante: n(c?.carburante), percentuale: n(c?.percentuale), quadra: !!c?.quadra,
    })),
  }
}

export async function POST(req: NextRequest) {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const admin = createAdminSupabase()
  const corpo = await req.json() as Corpo
  const contratti = await contrattiControllabili(admin, u.masterId)

  // Una fattura già aperta si tocca solo se è del master e di un suo contratto BRT o GLS.
  let fattura: any = null
  if (corpo.fatturaId) {
    const { data } = await admin.from('fatture_corriere').select('id,master_id,corriere_id,stato,riepilogo,rettifiche_file_id').eq('id', corpo.fatturaId).maybeSingle()
    if (!data || data.master_id !== u.masterId) return NextResponse.json({ error: 'Fattura non trovata.' }, { status: 404 })
    fattura = data
  }

  // ── COLLEGA LA RETTIFICA: le differenze di peso sono state mandate, si ricorda in quale file ──
  if (corpo.rettificheFileId && fattura) {
    const { data: f } = await admin.from('rettifiche_files').select('id,master_id').eq('id', corpo.rettificheFileId).maybeSingle()
    if (!f || f.master_id !== u.masterId) return NextResponse.json({ error: 'File di rettifiche non tuo.' }, { status: 403 })
    // Rimandate (le "non girate" dopo aver sistemato il listino), il file nuovo prende il posto del vecchio: le
    // rettifiche del primo invio restano contate fra quelle sulle spedizioni della fattura.
    const esterne = (await rettificheSulleSpedizioni(admin, u.masterId, [fattura.id]))?.get(fattura.id)
    if (esterne?.length) {
      const x = await cambiaRiepilogo(admin, fattura.id, r => ({ ...r, rettificheEsterne: { ids: esterne } }), { rettifiche_file_id: f.id })
      if ('risposta' in x) return x.risposta
    } else await admin.from('fatture_corriere').update({ rettifiche_file_id: f.id }).eq('id', fattura.id)
    return NextResponse.json({ ok: true })
  }

  // ── A CHE PUNTO È UNA VOCE DI "COSA FARE" ──
  // Lorenzo, 25/11: "ci deve stare un bottone che dice ok contestato, ok GLS mi ha fatto la nota di credito e via
  // dicendo". Ogni voce ha il suo stato (contestata → nota di credito o respinta; chiesta a GLS → risposta; fatto),
  // con la data, chi l'ha segnato e i passaggi di prima. Si salva con la fattura (riepilogo.stati), così resta
  // nello storico, e le note di credito tornano nel conto di quello che resta a carico. `stato: null` = annulla.
  if (corpo.statoVoce && fattura) {
    const sv = corpo.statoVoce
    const chiave = String(sv.chiave || '').trim().slice(0, 160)
    // Gli esiti finali: 'assorbito' (resta a te), 'girato' (girato ai clienti con la Rettifica), 'fatturato' (una
    // spedizione fuori da tutto, fatta pagare a qualcuno: importo e a chi).
    // 'tentato': mandata alla Rettifica ma non creata, col perché (e il listino da correggere, se è quello).
    const STATI = ['contestato', 'accreditato', 'respinto', 'chiesto', 'risposto', 'fatto', 'girato', 'assorbito', 'fatturato', 'tentato']
    if (!chiave) return NextResponse.json({ error: 'Voce mancante.' }, { status: 400 })
    if (sv.stato != null && !STATI.includes(sv.stato)) return NextResponse.json({ error: 'Stato non valido.' }, { status: 400 })
    const importo = sv.importo == null || (sv.importo as any) === '' ? null : Number(sv.importo)
    if (importo != null && !(Number.isFinite(importo) && importo >= 0 && importo <= 1000000)) return NextResponse.json({ error: 'Importo non valido.' }, { status: 400 })
    // UNA SPEDIZIONE FUORI DA TUTTO FATTA PAGARE (Lorenzo, 27/11). A un cliente o sotto-master di Moove si può
    // addebitarla in Moove, oppure dire che l'ha già pagata fuori da Moove («magari l'ha pagata fuori da Moove»); a uno
    // che non è in Moove si scrive, e poi si dice se ha pagato. Per l'addebito la pagina prenota ('in_corso') prima di
    // chiamare la porta dei movimenti a mano, e segna 'fatto' dopo. Un addebito partito non si toglie da qui, perché il
    // movimento resta: si storna dalla scheda del cliente e qui si segna 'stornato'. Da 'in_corso' si passa solo a
    // 'fatto' o si toglie (l'addebito non è partito).
    const addebito = sv.addebito === 'in_corso' || sv.addebito === 'fatto' || sv.addebito === 'stornato' ? sv.addebito : null
    // Il cliente: l'id solo se è un cliente o un sotto-master ('m:…') di Moove; la porta dei movimenti verifica che sia di
    // chi addebita, qui si conserva per mostrarlo. Un addebito senza un id così non si salva: la guardia qui sotto si
    // perderebbe in silenzio mentre la pagina addebita lo stesso.
    let idCliente = typeof sv.cliente?.id === 'string' && /^(m:)?[0-9a-f-]{36}$/i.test(sv.cliente.id) ? sv.cliente.id : null
    let nomeCliente = String(sv.cliente?.nome ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const fuoriTrov = chiave.startsWith('fuori:') ? chiave.slice(6) : null
    // GIÀ ADDEBITATA DA UN'ALTRA PORTA (la scheda cliente, o rifatta lì dopo uno storno): la pagina non ha niente da
    // dire su chi e quanto, lo legge la rotta dal movimento. Senza movimento non si segna niente.
    let trovato = false, importoTrovato: number | null = null
    if (sv.daMovimento === true && addebito === 'fatto' && fuoriTrov) {
      let mov: Awaited<ReturnType<typeof addebitiFuoriPortale>> = []
      try { mov = await addebitiFuoriPortale(admin, u.masterId, fuoriTrov) }
      catch (e: any) { return NextResponse.json({ error: 'Non riesco a leggere i movimenti: ' + String(e?.message || e) + '. Riprova.' }, { status: 500 }) }
      // Dopo uno storno conta solo un addebito fatto DOPO lo storno: quello vecchio resta negativo anche se restituito
      // (lo storno ha un'altra voce), e la voce tornava «addebitata» a un cliente rimborsato (terza revisione, 27/11).
      const { data: fNow } = await admin.from('fatture_corriere').select('riepilogo').eq('id', fattura.id).maybeSingle()
      const primaOra = (fNow?.riepilogo?.stati || {})[chiave]
      const dal = primaOra?.addebito === 'stornato' ? String(primaOra.il || '') : ''
      const m = mov.find(x => x.importo < 0 && x.chi && (!dal || x.il > dal))
      if (!m && dal) return NextResponse.json({ error: `Dopo lo storno del ${new Date(dal).toLocaleDateString('it-IT')} fra i tuoi movimenti non c'è un nuovo addebito «Spedizione fatta fuori dal portale ${fuoriTrov}»: fallo dalla scheda del cliente, poi riprova.` }, { status: 409 })
      if (!m) return NextResponse.json({ error: `Fra i tuoi movimenti non c'è nessuna «Spedizione fatta fuori dal portale ${fuoriTrov}» addebitata a un cliente: falla pagare da qui.` }, { status: 409 })
      idCliente = m.chi; nomeCliente = (m.nome || 'cliente').slice(0, 120); importoTrovato = Math.abs(m.importo); trovato = true
    }
    if (addebito && !idCliente) return NextResponse.json({ error: 'Per un addebito in Moove serve un cliente di Moove: ricarica la pagina e sceglilo di nuovo.' }, { status: 400 })
    const fuori = chiave.startsWith('fuori:') ? chiave.slice(6) : null
    // Prima di prenotare, la stessa spedizione già fatta pagare: con un movimento «Spedizione fatta fuori dal portale»
    // (da qualunque porta, anche dalla scheda cliente), o in un altro documento (il borderò è cumulativo: lo stesso
    // arrivo torna in tutti i borderò del mese e nell'allegato).
    if (fuori && addebito === 'in_corso') {
      try {
        const mov = await addebitiFuoriPortale(admin, u.masterId, fuori)
        if (mov.length) return NextResponse.json({ error: `La ${fuori} è già stata fatta pagare: «${mov[0].descrizione}», ${Math.abs(mov[0].importo).toFixed(2).replace('.', ',')} € il ${new Date(mov[0].il).toLocaleDateString('it-IT')}. Se va rifatta, falla dalla scheda del cliente.` }, { status: 409 })
        // Decisa in un altro documento in qualunque modo (addebitata, incassata fuori da Moove, assorbita): si decide là.
        const altrove = (await fuoriAltrove(admin, u.masterId, fattura.id))[fuori]
        if (altrove && altrove.addebito !== 'stornato')
          return NextResponse.json({ error: `La ${fuori} è già decisa nel documento «${altrove.documento}» (${altrove.stato === 'fatturato' ? `fatta pagare a ${altrove.cliente?.nome || altrove.nota || 'un cliente'}` : 'assorbita'}): aprila là.` }, { status: 409 })
      } catch (e: any) {
        return NextResponse.json({ error: 'Non riesco a controllare se è già stata fatta pagare: ' + String(e?.message || e) + '. Riprova.' }, { status: 500 })
      }
    }
    // «Già incassati» o «Da incassare» su una spedizione che in Moove è già addebitata (dalla scheda cliente): la voce
    // direbbe «pagata fuori da Moove» con un movimento in Moove, e un doppio pagamento non si vedrebbe.
    if (fuori && sv.stato === 'fatturato' && !addebito && !trovato) {
      try {
        const mov = (await addebitiFuoriPortale(admin, u.masterId, fuori)).filter(x => x.importo < 0)
        if (mov.length) return NextResponse.json({ error: `In Moove la ${fuori} è già addebitata: «${mov[0].descrizione}», ${Math.abs(mov[0].importo).toFixed(2).replace('.', ',')} € il ${new Date(mov[0].il).toLocaleDateString('it-IT')}. Usa «È già addebitata».` }, { status: 409 })
      } catch (e: any) {
        return NextResponse.json({ error: 'Non riesco a controllare se è già addebitata in Moove: ' + String(e?.message || e) + '. Riprova.' }, { status: 500 })
      }
    }
    const avviso = String(sv.avviso ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    const esito = await cambiaRiepilogo(admin, fattura.id, riepilogo => {
      const stati: Record<string, any> = { ...(riepilogo.stati || {}) }
      const prima = stati[chiave]
      if (fuori) {
        // Due clic o due schede: la seconda prenotazione trova la prima (sul valore appena letto, e la scrittura
        // passa solo se nel frattempo nessuno ha cambiato il riepilogo).
        const no = rifiutoStatoFuori(prima, { stato: sv.stato, addebito, trovato })
        if (no) return NextResponse.json({ error: no }, { status: 409 })
        // Segnata pagata fuori da Moove, annullata, e ora addebitata in Moove: due gesti voluti, ma il cliente potrebbe
        // pagarla due volte. Si chiede di confermarlo, dicendo cosa c'era (terza revisione, 27/11).
        const pagataPrima = addebito === 'in_corso' && !prima ? (riepilogo.annullati?.[chiave] || []).filter((x: any) => x?.stato === 'fatturato' && !x.addebito).pop() : null
        if (pagataPrima && sv.confermaDopoPagata !== true)
          return NextResponse.json({ chiediConferma: true, error: `Il ${new Date(pagataPrima.il).toLocaleDateString('it-IT')} questa spedizione era segnata ${pagataPrima.incassato === true ? 'incassata' : 'fatta pagare'} da ${pagataPrima.cliente?.nome || pagataPrima.nota || '?'} (${Number(pagataPrima.importo || 0).toFixed(2).replace('.', ',')} €), poi annullata. Se te l'ha già pagata fuori da Moove, addebitandola la paga due volte. La addebito lo stesso?` }, { status: 409 })
      }
      // Una voce tolta non sparisce: resta fra le annullate, così un addebito dopo sa cosa c'era.
      const annullati: Record<string, any[]> = { ...(riepilogo.annullati || {}) }
      if (sv.stato == null && fuori && prima) annullati[chiave] = [...(annullati[chiave] || []), { ...prima, storia: undefined, annullata_il: new Date().toISOString(), annullata_da: u.userId }].slice(-5)
      if (sv.stato == null) delete stati[chiave]
      else {
        const storia = [...(prima?.storia || []), ...(prima ? [{ stato: prima.stato, il: prima.il, ...(prima.addebito ? { addebito: prima.addebito } : {}) }] : [])].slice(-10)
        const nota = trovato ? nomeCliente : String(sv.nota ?? '').trim().slice(0, 500), numero = String(sv.numero ?? '').trim().slice(0, 60)
        const imp = trovato ? importoTrovato : importo
        stati[chiave] = { stato: sv.stato, il: new Date().toISOString(), da: u.userId,
          ...(nota ? { nota } : {}), ...(imp != null ? { importo: Math.round(imp * 100) / 100 } : {}), ...(numero ? { numero } : {}), ...(storia.length ? { storia } : {}),
          ...(sv.listino && typeof sv.listino.id === 'string' && /^[0-9a-f-]{36}$/.test(sv.listino.id) ? { listino: { id: sv.listino.id, nome: String(sv.listino.nome || '').slice(0, 80), di: String(sv.listino.di || '').slice(0, 80) } } : {}),
          ...(nomeCliente ? { cliente: { ...(idCliente ? { id: idCliente } : {}), nome: nomeCliente } } : {}),
          ...(addebito ? { addebito } : {}),
          // «Incassati»: anche un cliente di Moove che ha pagato fuori da Moove (Lorenzo, 27/11); non su un addebito, che si
          // incassa dal credito.
          ...(typeof sv.incassato === 'boolean' && !addebito ? { incassato: sv.incassato } : {}),
          // L'avviso sul costo resta finché la voce resta addebitata: una scheda vecchia che risegna «fatto» non lo cancella.
          ...(avviso ? { avviso } : addebito === 'fatto' && prima?.addebito === 'fatto' && prima?.avviso ? { avviso: prima.avviso } : {}),
          ...(trovato ? { daMovimento: true } : {}) }
      }
      return { ...riepilogo, stati, ...(Object.keys(annullati).length ? { annullati } : {}) }
    })
    if ('risposta' in esito) return esito.risposta
    return NextResponse.json({ ok: true, stati: esito.riepilogo?.stati || {} })
  }

  // ── L'EXPORT DI UN ALTRO GESTIONALE, ABBINATO ──
  // Il file l'abbina la pagina e non si salva; qui si salva cosa ne è uscito (quali righe della fattura hanno
  // trovato la spedizione, quanto hanno pagato i clienti di quel gestionale), così riaprendo la fattura il conto
  // del documento c'è ancora senza ricaricarlo (Lorenzo, 25/11: alla fine deve sapere quanto ha speso e incassato).
  if (corpo.esterno && fattura) {
    const x = corpo.esterno
    const nome = String(x.nome || '').trim().slice(0, 200)
    if (!nome) return NextResponse.json({ error: 'Nome del file mancante.' }, { status: 400 })
    const n = (v: any) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0)
    const voce = { nome, formato: String(x.formato || '').slice(0, 60), il: new Date().toISOString(), righeFile: Math.max(0, Math.round(n(x.righeFile))),
      abbinate: (Array.isArray(x.abbinate) ? x.abbinate : []).map(t => String(t).slice(0, 40)).slice(0, 20000),
      andate: Math.max(0, Math.round(n(x.andate))), corriereAndate: n(x.corriereAndate), prezzoClienti: n(x.prezzoClienti), rientri: n(x.rientri), rettifiche: Math.max(0, Math.round(n(x.rettifiche))) }
    const salvato = await cambiaRiepilogo(admin, fattura.id, r => ({ ...r, esterni: { ...(r.esterni || {}), [nome]: voce } }))
    if ('risposta' in salvato) return salvato.risposta
    return NextResponse.json({ ok: true, esterni: salvato.riepilogo?.esterni || {} })
  }

  // ── PERCHÉ NON È DIVENTATA UNA RETTIFICA ──
  // La Rettifica dice quante spedizioni ha scartato, non quali né perché: il 25/11 Wave vedeva "1 non è diventata
  // una rettifica" e in Rettifica Costi non c'era niente da cercare. Era la NI665520237: Moove 50 kg, GLS 130, e il
  // listino che Wave fa al sotto-master Spedire semplice arriva a 50 kg. Qui, per le spedizioni della fattura
  // senza rettifica: se ce n'è già una da un altro file, o se la catena dei prezzi si ferma a quel peso (stessa
  // funzione dell'addebito e della Rettifica, lib/cascata). Solo lettura.
  if (corpo.perche && fattura) {
    const richieste = (Array.isArray(corpo.perche) ? corpo.perche : []).slice(0, 50)
    const ids = richieste.map(p => String(p?.id || '')).filter(Boolean)
    const { data: dellaFattura, error: errR } = await admin.from('fatture_corriere_righe').select('spedizione_id').eq('fattura_id', fattura.id).in('spedizione_id', ids)
    if (errR) return NextResponse.json({ error: 'Lettura righe non riuscita: ' + errR.message }, { status: 500 })
    const ammesse = new Set((dellaFattura || []).map((r: any) => r.spedizione_id))
    const kg = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
    const out: { id: string; motivo: string; listino: boolean; listinoDaCorreggere?: { id: string; nome: string; di: string } }[] = []
    for (const p of richieste) {
      const peso = Number(p?.peso)
      if (!ammesse.has(p?.id) || !(peso > 0)) continue
      const { data: gia, error: errG } = await admin.from('rettifiche').select('confermata').eq('master_id', u.masterId).eq('spedizione_id', p.id)
        .or('propagazione.is.null,propagazione.neq.annullata').limit(5)
      if (errG) return NextResponse.json({ error: 'Lettura rettifiche non riuscita: ' + errG.message }, { status: 500 })
      if (gia?.length) {
        out.push({ id: p.id, listino: false, motivo: gia.some((r: any) => r.confermata) ? 'Già rettificata e confermata con un altro file: è in Rettifica Costi fra le confermate.' : 'Già rettificata con un altro file, da confermare in Rettifica Costi.' })
        continue
      }
      const { data: s, error: errS } = await admin.from('spedizioni').select('master_id,corriere_id,dest_provincia,dest_cap,dest_citta,dest_paese,contrassegno,assicurazione,mitt_cap,mitt_provincia').eq('id', p.id).maybeSingle()
      const { data: corr, error: errC } = s ? await admin.from('corrieri').select('master_id,nome_contratto').eq('id', s.corriere_id).maybeSingle() : { data: null, error: null }
      if (errS || errC || !s || !corr) { out.push({ id: p.id, listino: false, motivo: 'Non riesco a rileggere la spedizione: riprova fra poco.' }); continue }
      const { errore } = await costruisciCatena(admin, {
        masterDirettoId: s.master_id, corriereOwnerId: corr.master_id, costoSpedizione: 0, provincia: String(s.dest_provincia || '').toUpperCase(),
        packages: [{ weight: peso, length: 0, width: 0, height: 0 }], cap: s.dest_cap || '', citta: s.dest_citta || '', paese: s.dest_paese || 'IT',
        corriereNome: corr.nome_contratto, contrassegno: Number(s.contrassegno || 0), assicurazione: Number(s.assicurazione || 0),
        mittCap: s.mitt_cap || '', mittProvincia: s.mitt_provincia || '', mittPaese: 'IT',
        // La catena del PACCO, come il ricalcolo vero della rettifica (lib/ripesature-calcolo.ts): con un contratto
        // staccato e ricomprato altrove, la spiegazione deve parlare del fornitore di allora.
        corrierePacco: s.corriere_id,
      })
      // Quale listino correggere: quello che il padre ha assegnato al master dove la catena si ferma (lib/cascata,
      // parent_listino_id). Si cerca risalendo dal master della spedizione, per nome come lo dice l'errore.
      let daCorreggere: { id: string; nome: string; di: string } | null = null
      const chi = errore?.match(/listino del master "([^"]+)"/)?.[1]
      if (chi) {
        let cur: string | null = s.master_id
        for (let i = 0; i < 12 && cur; i++) {
          const { data: m } = await admin.from('masters').select('id,nome,parent_master_id,parent_listino_id').eq('id', cur).maybeSingle()
          if (!m) break
          if (m.nome === chi && m.parent_listino_id) {
            const { data: l } = await admin.from('listini_clienti').select('id,nome').eq('id', m.parent_listino_id).maybeSingle()
            if (l) daCorreggere = { id: l.id, nome: l.nome || 'listino', di: m.nome }
            break
          }
          cur = m.parent_master_id
        }
      }
      out.push(errore
        ? { id: p.id, listino: true, ...(daCorreggere ? { listinoDaCorreggere: daCorreggere } : {}), motivo: `A ${kg(peso)} kg la catena dei prezzi si ferma: ${errore.trim().replace(/\.$/, '')}. Di solito manca quella fascia di peso nel listino di chi sta sotto: aggiungila, poi rimandala alla Rettifica. Finché non la giri, la differenza la paghi tu.` }
        : { id: p.id, listino: false, motivo: `A ${kg(peso)} kg i prezzi della catena ci sono: la Rettifica non ci ha trovato niente da chiedere a chi ha spedito. Puoi rimandarla per riprovare.` })
    }
    return NextResponse.json({ perche: out })
  }

  // ── FILE DI RETTIFICHE SCARICATO PER UN ALTRO GESTIONALE: è un'azione, la fattura resta nello storico ──
  if (corpo.fileEsterno && fattura) {
    const voce = { nome: String(corpo.fileEsterno.nome || '').slice(0, 200), righe: Math.max(0, Math.round(Number(corpo.fileEsterno.righe) || 0)), il: new Date().toISOString() }
    const x = await cambiaRiepilogo(admin, fattura.id, r => ({ ...r, fileEsterni: [...(r.fileEsterni || []), voce] }))
    if ('risposta' in x) return x.risposta
    return NextResponse.json({ ok: true })
  }

  // ── IL PDF DELLA FATTURA AGGIUNTO DOPO: la sua legenda si salva con la fattura ──
  if (corpo.legenda && fattura && !corpo.righe) {
    const legenda = pulisciLegenda(corpo.legenda)
    if (!legenda) return NextResponse.json({ error: 'Legenda vuota.' }, { status: 400 })
    const x = await cambiaRiepilogo(admin, fattura.id, r => ({ ...r, legenda }))
    if ('risposta' in x) return x.risposta
    return NextResponse.json({ ok: true })
  }

  // ── CHIUSURA: i totali si rifanno qui dalle righe salvate, non si prendono dal browser ──
  if (corpo.chiudi && fattura) {
    const righe: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await admin.from('fatture_corriere_righe').select('esito').eq('fattura_id', fattura.id).order('id').range(da, da + 999)
      if (error) return NextResponse.json({ error: 'Lettura righe non riuscita: ' + error.message }, { status: 500 })
      righe.push(...(data || []).map((r: any) => r.esito)); if ((data || []).length < 1000) break
    }
    const t = riepilogaFattura(righe as EsitoPagina[])
    // Spedizioni già rettificate da un file della pagina Rettifica (la fattura ricaricata dopo averle girate):
    // l'azione c'è già, e lo storico la conta fra il girato.
    const esterne = (await rettificheSulleSpedizioni(admin, u.masterId, [fattura.id]))?.get(fattura.id)
    const x = await cambiaRiepilogo(admin, fattura.id,
      r => ({ ...r, perMotivo: t.perMotivo, perVoce: t.perVoce, totaleRientri: t.totaleRientri, ...(esterne?.length ? { rettificheEsterne: { ids: esterne } } : {}) }), {
        stato: 'completa', completata_at: new Date().toISOString(),
        righe: t.righe, andate: t.andate, rientri: t.rientri,
        totale_corriere: t.totaleCorriere, totale_trovate: t.totaleTrovate, costo_moove: t.costoMoove, differenza: t.differenza,
        non_trovate: t.nonTrovate, totale_non_trovate: t.totaleNonTrovate, da_girare: t.daGirare, euro_da_girare: t.euroDaGirare,
      })
    if ('risposta' in x) return x.risposta
    // Le spedizioni fuori da tutto già gestite negli altri documenti (borderò cumulativi, allegato del mese): la pagina
    // le mostra come fatte e non le propone di nuovo. Se la lettura non riesce, la pagina le propone come da fare, e la
    // rotta rifiuta comunque un secondo addebito (statoVoce).
    const altrove = await fuoriAltrove(admin, u.masterId, fattura.id).catch(() => null)
    // La pagina deve sapere se le differenze sono già nella Rettifica (fattura rifatta, o già girate da un file).
    return NextResponse.json({ ok: true, rettificheInviate: !!fattura.rettifiche_file_id || !!esterne?.length, stati: x.riepilogo?.stati || {}, esterni: x.riepilogo?.esterni || {},
      ...(altrove ? { fuoriAltrove: altrove } : {}) })
  }

  // ── UN PACCHETTO DI RIGHE ──
  const contrattoId = fattura?.corriere_id || corpo.contrattoId
  const contratto = contratti.find(c => c.ids.includes(contrattoId))
  if (!contratto) return NextResponse.json({ error: 'Contratto non tuo: la fattura del corriere la controlla solo chi detiene il contratto.' }, { status: 403 })
  const righe = corpo.righe
  if (!Array.isArray(righe) || !righe.length) return NextResponse.json({ error: 'Nessuna riga da controllare.' }, { status: 400 })
  if (righe.length > 1000) return NextResponse.json({ error: 'Troppe righe in una volta.' }, { status: 400 })
  // Righe GLS su un contratto GLS, righe BRT su un contratto BRT: lette con l'altro controllo darebbero
  // numeri senza senso, senza nessun errore.
  if (righe.some(r => eGls(r) !== (contratto.tipo === 'gls'))) return NextResponse.json({ error: `Questo documento non è di ${contratto.tipo === 'gls' ? 'GLS' : 'BRT'}: scegli il contratto giusto.` }, { status: 400 })
  if (fattura && fattura.stato !== 'in_corso') return NextResponse.json({ error: 'Questa fattura è già stata controllata.' }, { status: 409 })

  // Primo pacchetto: si apre la fattura nello storico. La stessa fattura caricata due volte non si rifà se ci
  // si è già fatto qualcosa: si dice quando è stata caricata e la pagina la riapre. Una senza azioni, o
  // interrotta a metà, si rifà da capo (con le regole di oggi).
  if (!fattura) {
    const numero = String(corpo.testata?.numeroFattura || righe[0]?.numeroFattura || '').trim()
    const legendaTestata = pulisciLegenda(corpo.testata?.legenda)
    if (!numero) return NextResponse.json({ error: 'Nel file manca il numero della fattura.' }, { status: 400 })
    // Le fatture del master caricate e lasciate lì senza azioni non restano: le toglie il caricamento dopo.
    // Quelle in corso solo se ferme da più di un giorno (un'altra scheda potrebbe starne caricando una).
    const glsTestata = contratto.tipo === 'gls' ? pulisciGls(corpo.testata?.gls) : null
    const riepilogoIniziale = legendaTestata || glsTestata ? { ...(legendaTestata ? { legenda: legendaTestata } : {}), ...(glsTestata ? { gls: glsTestata } : {}) } : null
    const { data: sue } = await admin.from('fatture_corriere').select('id,numero_fattura,corriere_id,stato,created_at,rettifiche_file_id,riepilogo,etichetta').eq('master_id', u.masterId)
    const ieri = Date.now() - 86400000
    const candidate = (sue || []).filter((f: any) => !(f.numero_fattura === numero && f.corriere_id === contratto.id) && !fatturaConAzioni(f)
      && (f.stato === 'completa' || new Date(f.created_at).getTime() < ieri))
    // Prima di togliere una fattura "senza azioni": se le sue spedizioni sono state rettificate da un file della
    // pagina Rettifica, l'azione c'è. Si segna sulla fattura, che resta. Se la lettura non riesce, non si toglie niente.
    const esterne = candidate.length ? await rettificheSulleSpedizioni(admin, u.masterId, candidate.map((f: any) => f.id)) : new Map<string, string[]>()
    if (esterne) {
      for (const [fid, ids] of esterne) {
        await cambiaRiepilogo(admin, fid, r => ({ ...r, rettificheEsterne: { ids } }))
      }
      const daTogliere = candidate.filter((f: any) => !esterne.has(f.id)).map((f: any) => f.id)
      // Si cancellano solo se sono ANCORA senza azioni: la decisione viene da una lettura di qualche secondo fa, e nel
      // frattempo in un'altra scheda ci si può essere segnato uno stato. Il controllo sta
      // nella stessa istruzione della cancellazione.
      if (daTogliere.length) await admin.from('fatture_corriere').delete().in('id', daTogliere).is('rettifiche_file_id', null)
        .is('riepilogo->stati', null).is('riepilogo->esterni', null).is('riepilogo->fileEsterni', null).is('riepilogo->rettificheEsterne', null)
    }
    const esistente = (sue || []).find((f: any) => f.numero_fattura === numero && f.corriere_id === contratto.id)
    // RIFATTA CON LE REGOLE DI OGGI (`rifai`, chiesto dalla pagina dopo "già controllata"): una fattura su cui si
    // è già fatto qualcosa si rifà, e quello che c'è stato fatto resta. Il 25/11 Wave aveva l'allegato GLS di
    // ottobre salvato prima delle correzioni del giorno (carburante, listini) e non poteva rifarlo: ricaricando il
    // PDF la pagina riapriva sempre la copia vecchia. Restano il file delle rettifiche mandate (rettifiche_file_id,
    // non si tocca), i file scaricati per gli altri gestionali, le rettifiche fatte dalla pagina Rettifica e il nome.
    const rifai = corpo.rifai === true && !!esistente && fatturaConAzioni(esistente)
    if (esistente?.stato === 'completa' && fatturaConAzioni(esistente) && !rifai) return NextResponse.json({ giaCaricata: { id: esistente.id, il: esistente.created_at } })
    if (esistente) {
      // Le azioni restano sempre, anche se il rifacimento si era interrotto a metà e si riprende senza `rifai`.
      const conAzioni = fatturaConAzioni(esistente)
      await admin.from('fatture_corriere_righe').delete().eq('fattura_id', esistente.id)
      // Le azioni che restano si prendono dal riepilogo di adesso, non da quello letto sopra.
      const x = await cambiaRiepilogo(admin, esistente.id, r => {
        const conAzioniOra = conAzioni || fatturaConAzioni({ rettifiche_file_id: esistente.rettifiche_file_id, riepilogo: r })
        const tenuti = conAzioniOra ? Object.fromEntries(['fileEsterni', 'rettificheEsterne', 'stati', 'esterni'].filter(k => r[k]).map(k => [k, r[k]])) : {}
        return riepilogoIniziale || Object.keys(tenuti).length ? { ...(riepilogoIniziale || {}), ...tenuti } : null
      }, { stato: 'in_corso', etichetta: conAzioni ? esistente.etichetta ?? null : null, completata_at: null,
        nome_file: corpo.testata?.nomeFile || null, caricata_da: u.userId, created_at: new Date().toISOString() })
      if ('risposta' in x) return x.risposta
      fattura = { id: esistente.id, stato: 'in_corso' }
    } else {
      const { data: nuova, error } = await admin.from('fatture_corriere').insert({
        master_id: u.masterId, corriere_id: contratto.id, nome_contratto: contratto.nome_contratto,
        numero_fattura: numero, data_fattura: corpo.testata?.dataFattura || righe[0]?.dataFattura || null,
        nome_file: corpo.testata?.nomeFile || null, caricata_da: u.userId,
        ...(riepilogoIniziale ? { riepilogo: riepilogoIniziale } : {}),
      }).select('id').single()
      if (error || !nuova) return NextResponse.json({ error: 'Non riesco ad aprire la fattura nello storico: ' + (error?.message || '') }, { status: 500 })
      fattura = { id: nuova.id, stato: 'in_corso' }
    }
  }

  let esiti
  try {
    // La legenda del PDF, se c'è: col primo pacchetto arriva nella testata, poi sta nella fattura salvata.
    const legenda = pulisciLegenda(corpo.testata?.legenda) || fattura.riepilogo?.legenda || null
    esiti = contratto.tipo === 'gls'
      ? await analizzaFatturaGls(admin, { contrattiIds: contratto.ids, masterId: u.masterId, righe: righe as RigaFatturaGls[] })
      : await analizzaFatturaBrt(admin, { contrattoId: contratto.id, masterId: u.masterId, righe, legenda })
  } catch (e: any) {
    // Una lettura saltata non deve diventare "spedizione non trovata": meglio fermarsi e dirlo.
    return NextResponse.json({ error: 'Controllo non riuscito: ' + String(e?.message || e) }, { status: 500 })
  }

  // Chi ha spedito: cliente diretto del detentore oppure sotto-master che gli compra il contratto.
  // (anche chi ha pagato il detentore, GLS: il cliente "ingrosso" sulle gambe condivise, o il sotto-master figlio)
  const clientiIds = Array.from(new Set([...esiti.map(e => e.spedizione?.cliente_id), ...esiti.map(e => e.incasso?.chi === 'cliente' ? e.incasso.id : null)].filter(Boolean))) as string[]
  const masterIds = Array.from(new Set([...esiti.map(e => e.spedizione?.master_id), ...esiti.map(e => e.incasso?.chi === 'master' ? e.incasso.id : null)].filter(m => m && m !== u.masterId))) as string[]
  const nomi: Record<string, string> = {}
  for (let i = 0; i < clientiIds.length; i += 200) {
    const { data } = await admin.from('clienti').select('id,ragione_sociale').in('id', clientiIds.slice(i, i + 200))
    for (const c of data || []) nomi[c.id] = c.ragione_sociale
  }
  for (let i = 0; i < masterIds.length; i += 200) {
    const { data } = await admin.from('masters').select('id,nome').in('id', masterIds.slice(i, i + 200))
    for (const m of data || []) nomi[m.id] = m.nome
  }

  const perPagina: EsitoPagina[] = esiti.map(e => ({
    riga: e.riga,
    spedizione: e.spedizione && {
      id: e.spedizione.id, numero: e.spedizione.numero, stato: e.spedizione.stato,
      data: e.spedizione.created_at, colli: e.spedizione.colli ?? 1,
      peso: Number(e.spedizione.peso_fatturato || e.spedizione.peso_reale || 0),
      contrassegno: Number(e.spedizione.contrassegno || 0), citta: e.spedizione.dest_citta || '',
      // Il sotto-master per nome, il cliente diretto per ragione sociale: chi riceverà la rettifica.
      chi: e.spedizione.master_id !== u.masterId ? (nomi[e.spedizione.master_id] || 'Sotto-master') : (nomi[e.spedizione.cliente_id || ''] || 'Cliente'),
    },
    abbinataPer: e.abbinataPer,
    brt: e.brt, moove: e.moove, listino: e.listino?.totale ?? null, zona: e.listino?.zona ?? null,
    differenza: e.differenza, motivi: e.motivi, voci: e.vociPerCategoria as Record<string, number>,
    ...(e.scartoListino != null ? { scartoListino: e.scartoListino } : {}),
    // Il dettaglio di "Cosa allineare nel listino" (quale listino, voce, zona, luogo). Mancava: il controllo lo
    // calcolava e qui si perdeva, e il 25/11 l'allegato di ottobre rifatto da Wave usciva ancora senza.
    ...(e.allinea ? { allinea: e.allinea } : {}),
    ...(e.contratto ? { contratto: e.contratto } : {}),
    ...(e.incasso ? { incasso: { importo: e.incasso.importo, chi: nomi[e.incasso.id] || (e.incasso.chi === 'master' ? 'Sotto-master' : 'Cliente') } } : {}),
  }))

  const { error: errRighe } = await admin.from('fatture_corriere_righe')
    .insert(perPagina.map(e => ({ fattura_id: fattura.id, spedizione_id: e.spedizione?.id || null, esito: e })))
  if (errRighe) return NextResponse.json({ error: 'Non riesco a salvare le righe nello storico: ' + errRighe.message }, { status: 500 })

  return NextResponse.json({ fatturaId: fattura.id, esiti: perPagina })
}
