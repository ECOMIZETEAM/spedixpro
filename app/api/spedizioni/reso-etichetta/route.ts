import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { sottoAlberoMasterIds } from '@/lib/rete-masters'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { pacchiSpedizione } from '@/lib/reso-prezzi'

// ETICHETTA DI RESO = "inversione di marcia". Il pacco è GIÀ arrivato; il cliente lo rimanda indietro
// con una SECONDA spedizione NUOVA (tracking proprio, ciclo che finisce a 'consegnata') — NON è il reso
// del sistema (spedizione fallita che torna col vecchio tracking a 'reso_mittente').
//
// Perciò NON reinventa niente: per ogni spedizione selezionata crea una spedizione NORMALE riusando
// /api/spedizioni/crea, con mittente e destinatario INVERTITI e SENZA contrassegno (l'andata poteva
// averlo, il ritorno no). Assicurazione solo se richiesta (e se il listino la prevede). Il ritiro, se
// richiesto, si prenota col corriere all'indirizzo del NUOVO mittente (il destinatario originale)
// riusando /api/ritiri/crea. Zero modifiche al percorso critico: qui si orchestrano rotte esistenti.

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : []
  if (!ids.length) return NextResponse.json({ error: 'Seleziona almeno una spedizione' }, { status: 400 })
  // Ogni reso crea una spedizione VERA col corriere (chiamata + etichetta): un lotto enorme in una
  // sola richiesta andrebbe in timeout. Meglio a scaglioni, con un messaggio chiaro.
  if (ids.length > 25) return NextResponse.json({ error: 'Massimo 25 resi per volta: seleziona meno spedizioni e ripeti.' }, { status: 400 })
  const assicura = body?.assicura === true
  const vuoleRitiro = body?.ritiro === true
  const dataRitiro = String(body?.dataRitiro || '')
  const orarioRitiro = String(body?.orarioRitiro || '')
  if (vuoleRitiro && !dataRitiro) return NextResponse.json({ error: 'Indica la data del ritiro' }, { status: 400 })

  const admin = createAdminSupabase()
  const ruolo = (utente.ruolo || '').toLowerCase()

  // Carico le spedizioni originali NEL PERIMETRO di chi chiede (cliente: le proprie; master: la sua
  // rete; agente: solo i suoi clienti). Solo così creerò resi di spedizioni che può davvero vedere.
  let q = admin.from('spedizioni').select(
    'id,numero,corriere_id,cliente_id,master_id,contenuto,valore_merce,assicurazione,colli,peso_reale,lunghezza,larghezza,altezza,colli_dettaglio,' +
    'mitt_nome,mitt_indirizzo,mitt_citta,mitt_provincia,mitt_cap,mitt_paese,mitt_email,mitt_telefono,' +
    'dest_nome,dest_indirizzo,dest_citta,dest_provincia,dest_cap,dest_paese,dest_email,dest_telefono'
  ).in('id', ids)
  if (ruolo === 'cliente') {
    q = q.eq('cliente_id', utente.cliente_id)
  } else {
    const subtree = await sottoAlberoMasterIds(admin, utente.master_id)
    q = q.in('master_id', subtree.length ? subtree : ['00000000-0000-0000-0000-000000000000'])
    if (isAgente(utente)) q = q.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente)))
  }
  const { data: originali } = await q
  if (!originali?.length) return NextResponse.json({ error: 'Spedizioni non trovate' }, { status: 404 })

  const cookie = req.headers.get('cookie') || ''
  const creaUrl = new URL('/api/spedizioni/crea', req.nextUrl.origin).toString()
  const ritiroUrl = new URL('/api/ritiri/crea', req.nextUrl.origin).toString()
  const chiamaInterna = (url: string, payload: any) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(payload),
  })

  const creati: any[] = []
  const errori: any[] = []

  for (const o of originali as any[]) {
    // Provincia mittente del reso = provincia del DESTINATARIO originale (che ora spedisce). crea la
    // pretende: se sull'originale manca, non possiamo prezzare/creare → errore chiaro per quella riga.
    if (!String(o.dest_provincia || '').trim()) { errori.push({ originale: o.numero, error: 'Manca la provincia del destinatario originale: non posso creare il reso.' }); continue }

    const packages = pacchiSpedizione(o)
    const insuranceValue = assicura ? (Number(o.valore_merce) || Number(o.assicurazione) || 0) : 0

    // Chi paga il reso = chi possedeva l'andata: il cliente originale; se era una spedizione PROPRIA,
    // il master proprietario (mio → __proprio__; di un sotto-master diretto → m:<id>). Per un utente
    // CLIENTE la creazione ignora questo campo e usa comunque il suo cliente_id.
    let clienteIdBody: string
    if (o.cliente_id) clienteIdBody = o.cliente_id
    else if (o.master_id && o.master_id !== utente.master_id) clienteIdBody = `m:${o.master_id}`
    else clienteIdBody = '__proprio__'

    // Spedizione di ritorno: mitt/dest INVERTITI, stesso corriere, niente contrassegno.
    const creaBody: any = {
      clienteId: clienteIdBody,
      _corriere_id: o.corriere_id,
      shipFrom: { name: o.dest_nome, street1: o.dest_indirizzo, city: o.dest_citta, state: o.dest_provincia, postalCode: o.dest_cap, country: o.dest_paese || 'IT', email: o.dest_email || '', phone: o.dest_telefono || '' },
      shipTo: { name: o.mitt_nome, street1: o.mitt_indirizzo, city: o.mitt_citta, state: o.mitt_provincia, postalCode: o.mitt_cap, country: o.mitt_paese || 'IT', email: o.mitt_email || '', phone: o.mitt_telefono || '' },
      packages,
      codValue: 0,
      insuranceValue,
      contenuto: o.contenuto || '',
      rifOrdine: o.numero,                         // link alla spedizione di andata
      notes: `Reso di ${o.numero}`,
      // Il ritiro lo passo alla creazione (per i corrieri che lo prenotano insieme all'etichetta, es.
      // easyparcel) e poi lo confermo/prenoto con /api/ritiri/crea per tutti gli altri.
      richiediRitiro: vuoleRitiro, dataRitiro: vuoleRitiro ? dataRitiro : undefined, orarioRitiro: vuoleRitiro ? orarioRitiro : undefined,
    }

    try {
      const r = await chiamaInterna(creaUrl, creaBody)
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.spedizioneId) { errori.push({ originale: o.numero, error: j?.error || `Creazione non riuscita (HTTP ${r.status})` }); continue }

      // Marchio la nuova spedizione come "Reso" (canale) così è riconoscibile in elenco/report.
      try { await admin.from('spedizioni').update({ canale: 'Reso' }).eq('id', j.spedizioneId) } catch { /* cosmetico */ }

      const voce: any = { originale: o.numero, spedizioneId: j.spedizioneId, numero: j.numero || null }

      // Ritiro col corriere all'indirizzo del NUOVO mittente (il destinatario originale).
      if (vuoleRitiro) {
        try {
          const rr = await chiamaInterna(ritiroUrl, {
            spedizioneIds: [j.spedizioneId],
            mittNome: o.dest_nome, mittIndirizzo: o.dest_indirizzo, mittCitta: o.dest_citta,
            mittProvincia: o.dest_provincia, mittCap: o.dest_cap, mittPaese: o.dest_paese || 'IT',
            mittTelefono: o.dest_telefono || '', mittEmail: o.dest_email || '',
            dataRitiro, orarioRitiro, contenuto: o.contenuto || '',
          })
          const rj = await rr.json().catch(() => ({}))
          voce.ritiro = rr.ok && !rj?.error ? { ok: true, pickupId: rj.pickupId || null, avviso: rj.avviso || null } : { ok: false, error: rj?.error || 'Ritiro non prenotato' }
        } catch (e: any) { voce.ritiro = { ok: false, error: String(e?.message || e) } }
      }

      creati.push(voce)
    } catch (e: any) {
      errori.push({ originale: o.numero, error: String(e?.message || e) })
    }
  }

  return NextResponse.json({ creati, errori })
}
