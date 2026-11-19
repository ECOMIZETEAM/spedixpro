import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { contrattiDelDetentore, utenteDetentore } from '@/lib/controllo-fattura-accesso'
import { analizzaFatturaBrt } from '@/lib/controllo-fattura'
import { riepilogaFattura, fatturaConAzioni, type EsitoPagina } from '@/lib/controllo-fattura-riepilogo'
import type { RigaFatturaBrt } from '@/lib/fattura-brt'

// Mille e più righe, ognuna col listino rifatto dalla funzione dell'addebito: serve più del minuto standard.
export const maxDuration = 300

// CONTROLLO FATTURA CORRIERE. La fattura la legge il browser (lib/fattura-brt, la stessa lettura qui e là);
// qui arrivano le righe a pacchetti, si confrontano col costo registrato al detentore e si salvano nello
// storico (fatture_corriere + righe), così la fattura si riapre senza il file. Il costo in Moove non si
// tocca: l'addebito ai clienti lo fa la Rettifica, la pagina le manda le differenze di peso come "solo pesi".
// Chi può usarla: solo il detentore del contratto (lib/controllo-fattura-accesso).

export async function GET() {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const contratti = await contrattiDelDetentore(createAdminSupabase(), u.masterId)
  return NextResponse.json({ contratti: contratti.map((c: any) => ({ id: c.id, nome: c.nome_contratto, attivo: c.attivo })) })
}

type Corpo = {
  contrattoId?: string
  righe?: RigaFatturaBrt[]
  fatturaId?: string
  testata?: { numeroFattura?: string; dataFattura?: string | null; nomeFile?: string; legenda?: Record<string, string> }
  chiudi?: boolean
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

export async function POST(req: NextRequest) {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const admin = createAdminSupabase()
  const corpo = await req.json() as Corpo
  const contratti = await contrattiDelDetentore(admin, u.masterId)

  // Una fattura già aperta si tocca solo se è del master e di un suo contratto BRT.
  let fattura: any = null
  if (corpo.fatturaId) {
    const { data } = await admin.from('fatture_corriere').select('id,master_id,corriere_id,stato,riepilogo').eq('id', corpo.fatturaId).maybeSingle()
    if (!data || data.master_id !== u.masterId) return NextResponse.json({ error: 'Fattura non trovata.' }, { status: 404 })
    fattura = data
  }

  // ── COLLEGA LA RETTIFICA: le differenze di peso sono state mandate, si ricorda in quale file ──
  if (corpo.rettificheFileId && fattura) {
    const { data: f } = await admin.from('rettifiche_files').select('id,master_id').eq('id', corpo.rettificheFileId).maybeSingle()
    if (!f || f.master_id !== u.masterId) return NextResponse.json({ error: 'File di rettifiche non tuo.' }, { status: 403 })
    await admin.from('fatture_corriere').update({ rettifiche_file_id: f.id }).eq('id', fattura.id)
    return NextResponse.json({ ok: true })
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
    await admin.from('fatture_corriere').update({
      stato: 'completa', completata_at: new Date().toISOString(),
      righe: t.righe, andate: t.andate, rientri: t.rientri,
      totale_corriere: t.totaleCorriere, totale_trovate: t.totaleTrovate, costo_moove: t.costoMoove, differenza: t.differenza,
      non_trovate: t.nonTrovate, totale_non_trovate: t.totaleNonTrovate, da_girare: t.daGirare, euro_da_girare: t.euroDaGirare,
      riepilogo: { ...(fattura.riepilogo || {}), perMotivo: t.perMotivo, perVoce: t.perVoce, totaleRientri: t.totaleRientri },
    }).eq('id', fattura.id)
    return NextResponse.json({ ok: true })
  }

  // ── UN PACCHETTO DI RIGHE ──
  const contrattoId = fattura?.corriere_id || corpo.contrattoId
  const contratto = contratti.find((c: any) => c.id === contrattoId)
  if (!contratto) return NextResponse.json({ error: 'Contratto non tuo: la fattura del corriere la controlla solo chi detiene il contratto.' }, { status: 403 })
  const righe = corpo.righe
  if (!Array.isArray(righe) || !righe.length) return NextResponse.json({ error: 'Nessuna riga da controllare.' }, { status: 400 })
  if (righe.length > 1000) return NextResponse.json({ error: 'Troppe righe in una volta.' }, { status: 400 })
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
    const { data: sue } = await admin.from('fatture_corriere').select('id,numero_fattura,corriere_id,stato,created_at,rettifiche_file_id,riepilogo').eq('master_id', u.masterId)
    const ieri = Date.now() - 86400000
    const daTogliere = (sue || []).filter((f: any) => !(f.numero_fattura === numero && f.corriere_id === contratto.id) && !fatturaConAzioni(f)
      && (f.stato === 'completa' || new Date(f.created_at).getTime() < ieri)).map((f: any) => f.id)
    if (daTogliere.length) await admin.from('fatture_corriere').delete().in('id', daTogliere)
    const esistente = (sue || []).find((f: any) => f.numero_fattura === numero && f.corriere_id === contratto.id)
    if (esistente?.stato === 'completa' && fatturaConAzioni(esistente)) return NextResponse.json({ giaCaricata: { id: esistente.id, il: esistente.created_at } })
    if (esistente) {
      await admin.from('fatture_corriere_righe').delete().eq('fattura_id', esistente.id)
      await admin.from('fatture_corriere').update({ stato: 'in_corso', riepilogo: legendaTestata ? { legenda: legendaTestata } : null, etichetta: null, completata_at: null,
        nome_file: corpo.testata?.nomeFile || null, caricata_da: u.userId, created_at: new Date().toISOString() }).eq('id', esistente.id)
      fattura = { id: esistente.id, stato: 'in_corso' }
    } else {
      const { data: nuova, error } = await admin.from('fatture_corriere').insert({
        master_id: u.masterId, corriere_id: contratto.id, nome_contratto: contratto.nome_contratto,
        numero_fattura: numero, data_fattura: corpo.testata?.dataFattura || righe[0]?.dataFattura || null,
        nome_file: corpo.testata?.nomeFile || null, caricata_da: u.userId,
        ...(legendaTestata ? { riepilogo: { legenda: legendaTestata } } : {}),
      }).select('id').single()
      if (error || !nuova) return NextResponse.json({ error: 'Non riesco ad aprire la fattura nello storico: ' + (error?.message || '') }, { status: 500 })
      fattura = { id: nuova.id, stato: 'in_corso' }
    }
  }

  let esiti
  try {
    // La legenda del PDF, se c'è: col primo pacchetto arriva nella testata, poi sta nella fattura salvata.
    const legenda = pulisciLegenda(corpo.testata?.legenda) || fattura.riepilogo?.legenda || null
    esiti = await analizzaFatturaBrt(admin, { contrattoId: contratto.id, masterId: u.masterId, righe, legenda })
  } catch (e: any) {
    // Una lettura saltata non deve diventare "spedizione non trovata": meglio fermarsi e dirlo.
    return NextResponse.json({ error: 'Controllo non riuscito: ' + String(e?.message || e) }, { status: 500 })
  }

  // Chi ha spedito: cliente diretto del detentore oppure sotto-master che gli compra il contratto.
  const clientiIds = Array.from(new Set(esiti.map(e => e.spedizione?.cliente_id).filter(Boolean))) as string[]
  const masterIds = Array.from(new Set(esiti.map(e => e.spedizione?.master_id).filter(m => m && m !== u.masterId))) as string[]
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
  }))

  const { error: errRighe } = await admin.from('fatture_corriere_righe')
    .insert(perPagina.map(e => ({ fattura_id: fattura.id, spedizione_id: e.spedizione?.id || null, esito: e })))
  if (errRighe) return NextResponse.json({ error: 'Non riesco a salvare le righe nello storico: ' + errRighe.message }, { status: 500 })

  return NextResponse.json({ fatturaId: fattura.id, esiti: perPagina })
}
