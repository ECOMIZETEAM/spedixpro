import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { contrattiDelDetentore, gruppiGls, utenteDetentore } from '@/lib/controllo-fattura-accesso'
import { analizzaFatturaBrt } from '@/lib/controllo-fattura'
import { analizzaFatturaGls } from '@/lib/controllo-fattura-gls'
import { eGls, type RigaFatturaGls } from '@/lib/fattura-gls'
import { costruisciCatena } from '@/lib/cascata'
import { riepilogaFattura, fatturaConAzioni, type EsitoPagina } from '@/lib/controllo-fattura-riepilogo'
import type { RigaFatturaBrt } from '@/lib/fattura-brt'

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

export async function GET() {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const contratti = await contrattiControllabili(createAdminSupabase(), u.masterId)
  return NextResponse.json({ contratti: contratti.map(c => ({ id: c.id, nome: c.nome, attivo: c.attivo, tipo: c.tipo })) })
}

type Corpo = {
  contrattoId?: string
  righe?: RigaFatturaBrt[]
  fatturaId?: string
  testata?: { numeroFattura?: string; dataFattura?: string | null; nomeFile?: string; legenda?: Record<string, string>; gls?: any }
  chiudi?: boolean
  rifai?: boolean                    // rifare con le regole di oggi una fattura già controllata, tenendo le azioni
  perche?: { id: string; peso: number }[]   // spedizioni da girare rimaste senza rettifica: perché
  statoVoce?: { chiave: string; stato: string | null; nota?: string; importo?: number; numero?: string; listino?: { id: string; nome?: string; di?: string } }   // a che punto è una voce di "Cosa fare"
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
    await admin.from('fatture_corriere').update({ rettifiche_file_id: f.id,
      ...(esterne?.length ? { riepilogo: { ...(fattura.riepilogo || {}), rettificheEsterne: { ids: esterne } } } : {}) }).eq('id', fattura.id)
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
    const { data: f2, error: errF2 } = await admin.from('fatture_corriere').select('riepilogo').eq('id', fattura.id).maybeSingle()
    if (errF2) return NextResponse.json({ error: 'Lettura fattura non riuscita: ' + errF2.message }, { status: 500 })
    const riepilogo = f2?.riepilogo || {}
    const stati: Record<string, any> = { ...(riepilogo.stati || {}) }
    if (sv.stato == null) delete stati[chiave]
    else {
      const prima = stati[chiave]
      const storia = [...(prima?.storia || []), ...(prima ? [{ stato: prima.stato, il: prima.il }] : [])].slice(-10)
      const nota = String(sv.nota ?? '').trim().slice(0, 500), numero = String(sv.numero ?? '').trim().slice(0, 60)
      stati[chiave] = { stato: sv.stato, il: new Date().toISOString(), da: u.userId,
        ...(nota ? { nota } : {}), ...(importo != null ? { importo: Math.round(importo * 100) / 100 } : {}), ...(numero ? { numero } : {}), ...(storia.length ? { storia } : {}),
        ...(sv.listino && typeof sv.listino.id === 'string' && /^[0-9a-f-]{36}$/.test(sv.listino.id) ? { listino: { id: sv.listino.id, nome: String(sv.listino.nome || '').slice(0, 80), di: String(sv.listino.di || '').slice(0, 80) } } : {}) }
    }
    const { error } = await admin.from('fatture_corriere').update({ riepilogo: { ...riepilogo, stati } }).eq('id', fattura.id)
    if (error) return NextResponse.json({ error: 'Stato non salvato: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true, stati })
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
    const { data: f2, error: errF2 } = await admin.from('fatture_corriere').select('riepilogo').eq('id', fattura.id).maybeSingle()
    if (errF2) return NextResponse.json({ error: 'Lettura fattura non riuscita: ' + errF2.message }, { status: 500 })
    const riepilogo = f2?.riepilogo || {}
    const esterni = { ...(riepilogo.esterni || {}), [nome]: voce }
    const { error } = await admin.from('fatture_corriere').update({ riepilogo: { ...riepilogo, esterni } }).eq('id', fattura.id)
    if (error) return NextResponse.json({ error: 'Export non salvato: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true, esterni })
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
    const riepilogo = { ...(fattura.riepilogo || {}), fileEsterni: [...(fattura.riepilogo?.fileEsterni || []), voce] }
    const { error } = await admin.from('fatture_corriere').update({ riepilogo }).eq('id', fattura.id)
    if (error) return NextResponse.json({ error: 'Non riesco a segnare il file scaricato: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── IL PDF DELLA FATTURA AGGIUNTO DOPO: la sua legenda si salva con la fattura ──
  if (corpo.legenda && fattura && !corpo.righe) {
    const legenda = pulisciLegenda(corpo.legenda)
    if (!legenda) return NextResponse.json({ error: 'Legenda vuota.' }, { status: 400 })
    const { error } = await admin.from('fatture_corriere').update({ riepilogo: { ...(fattura.riepilogo || {}), legenda } }).eq('id', fattura.id)
    if (error) return NextResponse.json({ error: 'Legenda non salvata: ' + error.message }, { status: 500 })
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
    await admin.from('fatture_corriere').update({
      stato: 'completa', completata_at: new Date().toISOString(),
      righe: t.righe, andate: t.andate, rientri: t.rientri,
      totale_corriere: t.totaleCorriere, totale_trovate: t.totaleTrovate, costo_moove: t.costoMoove, differenza: t.differenza,
      non_trovate: t.nonTrovate, totale_non_trovate: t.totaleNonTrovate, da_girare: t.daGirare, euro_da_girare: t.euroDaGirare,
      riepilogo: { ...(fattura.riepilogo || {}), perMotivo: t.perMotivo, perVoce: t.perVoce, totaleRientri: t.totaleRientri, ...(esterne?.length ? { rettificheEsterne: { ids: esterne } } : {}) },
    }).eq('id', fattura.id)
    // La pagina deve sapere se le differenze sono già nella Rettifica (fattura rifatta, o già girate da un file).
    return NextResponse.json({ ok: true, rettificheInviate: !!fattura.rettifiche_file_id || !!esterne?.length, stati: fattura.riepilogo?.stati || {}, esterni: fattura.riepilogo?.esterni || {} })
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
        const f = candidate.find((x: any) => x.id === fid)
        await admin.from('fatture_corriere').update({ riepilogo: { ...(f?.riepilogo || {}), rettificheEsterne: { ids } } }).eq('id', fid)
      }
      const daTogliere = candidate.filter((f: any) => !esterne.has(f.id)).map((f: any) => f.id)
      if (daTogliere.length) await admin.from('fatture_corriere').delete().in('id', daTogliere)
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
      const tenuti = conAzioni ? Object.fromEntries(['fileEsterni', 'rettificheEsterne', 'stati', 'esterni'].filter(k => esistente.riepilogo?.[k]).map(k => [k, esistente.riepilogo[k]])) : {}
      const riepilogo = riepilogoIniziale || Object.keys(tenuti).length ? { ...(riepilogoIniziale || {}), ...tenuti } : null
      await admin.from('fatture_corriere_righe').delete().eq('fattura_id', esistente.id)
      await admin.from('fatture_corriere').update({ stato: 'in_corso', riepilogo, etichetta: conAzioni ? esistente.etichetta ?? null : null, completata_at: null,
        nome_file: corpo.testata?.nomeFile || null, caricata_da: u.userId, created_at: new Date().toISOString() }).eq('id', esistente.id)
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
