import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { contrattiDelDetentore, utenteDetentore } from '@/lib/controllo-fattura-accesso'
import { analizzaFatturaBrt } from '@/lib/controllo-fattura'
import { riepilogaFattura, type EsitoPagina } from '@/lib/controllo-fattura-riepilogo'
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
  testata?: { numeroFattura?: string; dataFattura?: string | null; nomeFile?: string }
  chiudi?: boolean
  rettificheFileId?: string
}

export async function POST(req: NextRequest) {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const admin = createAdminSupabase()
  const corpo = await req.json() as Corpo
  const contratti = await contrattiDelDetentore(admin, u.masterId)

  // Una fattura già aperta si tocca solo se è del master e di un suo contratto BRT.
  let fattura: any = null
  if (corpo.fatturaId) {
    const { data } = await admin.from('fatture_corriere').select('id,master_id,corriere_id,stato').eq('id', corpo.fatturaId).maybeSingle()
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
      riepilogo: { perMotivo: t.perMotivo, perVoce: t.perVoce, totaleRientri: t.totaleRientri },
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

  // Primo pacchetto: si apre la fattura nello storico. La stessa fattura caricata due volte non si rifà:
  // si dice quando è stata caricata e la pagina la riapre. Una interrotta a metà, invece, si riprende da capo.
  if (!fattura) {
    const numero = String(corpo.testata?.numeroFattura || righe[0]?.numeroFattura || '').trim()
    if (!numero) return NextResponse.json({ error: 'Nel file manca il numero della fattura.' }, { status: 400 })
    const { data: esistente } = await admin.from('fatture_corriere').select('id,stato,created_at')
      .eq('master_id', u.masterId).eq('corriere_id', contratto.id).eq('numero_fattura', numero).maybeSingle()
    if (esistente?.stato === 'completa') return NextResponse.json({ giaCaricata: { id: esistente.id, il: esistente.created_at } })
    if (esistente) {
      await admin.from('fatture_corriere_righe').delete().eq('fattura_id', esistente.id)
      fattura = { id: esistente.id, stato: 'in_corso' }
    } else {
      const { data: nuova, error } = await admin.from('fatture_corriere').insert({
        master_id: u.masterId, corriere_id: contratto.id, nome_contratto: contratto.nome_contratto,
        numero_fattura: numero, data_fattura: corpo.testata?.dataFattura || righe[0]?.dataFattura || null,
        nome_file: corpo.testata?.nomeFile || null, caricata_da: u.userId,
      }).select('id').single()
      if (error || !nuova) return NextResponse.json({ error: 'Non riesco ad aprire la fattura nello storico: ' + (error?.message || '') }, { status: 500 })
      fattura = { id: nuova.id, stato: 'in_corso' }
    }
  }

  let esiti
  try {
    esiti = await analizzaFatturaBrt(admin, { contrattoId: contratto.id, masterId: u.masterId, righe })
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
