import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente, bloccaAgente } from '@/lib/agente'

// Gestione di una singola giacenza (dettaglio "Gestisci").
// Flusso a due attori: il cliente sceglie l'operazione (riconsegna / riconsegna a
// nuovo destinatario / reso) e chiede lo svincolo; il master vede la richiesta,
// puo' aggiungere costi manuali e conferma lo svincolo -> addebito + invio al corriere.

type Ctx = { admin: any; sped: any; ruolo: 'cliente' | 'master'; agente?: boolean; masterId?: string; clienteId?: string; nomeUtente: string }

// Mappa i nomi dei servizi giacenza del listino sulle 3 operazioni
function chiaveServizio(nome: string): string | null {
  const n = (nome || '').toLowerCase()
  if (n.includes('nuovo')) return 'riconsegna_nuovo'
  if (n.includes('reso')) return 'reso'
  if (n.includes('riconsegna')) return 'riconsegna'
  return null
}

// Legge i prezzi giacenza dal listino del cliente della spedizione
async function leggiPrezzi(admin: any, sped: any) {
  const out: any = { apertura: 0, servizi: { riconsegna: { valore: 0, perc: 0 }, riconsegna_nuovo: { valore: 0, perc: 0 }, reso: { valore: 0, perc: 100 } } }
  const { data: cliente } = await admin.from('clienti').select('listino_cliente_id').eq('id', sped.cliente_id).maybeSingle()
  const listinoId = cliente?.listino_cliente_id
  if (!listinoId) return out
  let q = admin.from('listini_clienti_supplementi').select('tipo,nome,valore,descrizione,corriere_id').eq('listino_id', listinoId).in('tipo', ['giacenza', 'giacenza_apertura'])
  if (sped.corriere_id) q = q.eq('corriere_id', sped.corriere_id)
  const { data: suppl } = await q
  for (const s of (suppl || [])) {
    if (s.tipo === 'giacenza_apertura') { out.apertura = Number(s.valore) || 0; continue }
    const k = chiaveServizio(s.nome)
    if (!k) continue
    let perc = 0
    try { perc = Number(JSON.parse(s.descrizione || '{}')?.perc) || 0 } catch { /* descrizione non JSON */ }
    out.servizi[k] = { valore: Number(s.valore) || 0, perc }
  }
  return out
}

// Nolo base del cliente senza assicurazione (le commissioni assicurazione/contrassegno
// NON entrano nel calcolo del reso)
function noloBase(sped: any) {
  return Math.max(0, (Number(sped.costo_totale) || 0) - (Number(sped.assicurazione) || 0))
}

// Costi di una operazione secondo il modello: apertura giacenza + servizio (reso = solo reso)
function calcolaCosti(operazione: string, prezzi: any, sped: any) {
  const base = noloBase(sped)
  const serv = prezzi.servizi[operazione] || { valore: 0, perc: 0 }
  const costoServizio = (Number(serv.valore) || 0) + ((Number(serv.perc) || 0) / 100) * base
  const costoApertura = operazione === 'reso' ? 0 : (Number(prezzi.apertura) || 0)
  return { costo_apertura: +costoApertura.toFixed(2), costo_servizio: +costoServizio.toFixed(2), costo_totale: +(costoApertura + costoServizio).toFixed(2) }
}

async function contesto(req: NextRequest, id: string): Promise<Ctx | NextResponse> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  const ruolo = (utente?.ruolo || '').toLowerCase() === 'cliente' ? 'cliente' : 'master'
  const admin = createAdminSupabase()
  const { data: sped } = await admin.from('spedizioni')
    .select('*, clienti(ragione_sociale), corrieri(credenziali,nome_contratto)')
    .eq('id', id).maybeSingle()
  if (!sped) return NextResponse.json({ error: 'Giacenza non trovata' }, { status: 404 })
  if (ruolo === 'cliente') {
    if (sped.cliente_id !== utente?.cliente_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  } else {
    if (sped.master_id !== utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  // Agente: solo giacenze di un suo cliente.
  if (isAgente(utente)) {
    const miei = await clientiAgente(supabase, utente)
    if (!sped.cliente_id || !miei.includes(sped.cliente_id)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  return { admin, sped, ruolo, agente: isAgente(utente), masterId: utente?.master_id, clienteId: utente?.cliente_id, nomeUtente: utente?.nome || (ruolo === 'cliente' ? 'Cliente' : 'Master') }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contesto(req, id)
  if (ctx instanceof NextResponse) return ctx
  const { admin, sped, ruolo } = ctx
  const prezzi = await leggiPrezzi(admin, sped)
  const [{ data: storico }, { data: costi }] = await Promise.all([
    admin.from('giacenza_richieste').select('*').eq('spedizione_id', id).order('created_at', { ascending: false }),
    admin.from('giacenza_costi').select('*').eq('spedizione_id', id).order('created_at', { ascending: true }),
  ])
  return NextResponse.json({ sped, prezzi, noloBase: noloBase(sped), storico: storico || [], costi: costi || [], ruolo })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contesto(req, id)
  if (ctx instanceof NextResponse) return ctx
  if ((ctx as any).agente) return NextResponse.json({ error: 'Operazione non consentita: gli agenti hanno accesso in sola lettura.' }, { status: 403 })
  const { admin, sped, ruolo, masterId, nomeUtente } = ctx
  const body = await req.json()
  const azione = body?.azione

  // 1) Richiesta operazione (cliente o master)
  if (azione === 'richiesta') {
    const operazione = String(body?.operazione || '')
    if (!['riconsegna', 'riconsegna_nuovo', 'reso'].includes(operazione)) return NextResponse.json({ error: 'Operazione non valida' }, { status: 400 })
    const prezzi = await leggiPrezzi(admin, sped)
    const costi = calcolaCosti(operazione, prezzi, sped)
    const { data, error } = await admin.from('giacenza_richieste').insert({
      spedizione_id: id, master_id: sped.master_id, cliente_id: sped.cliente_id,
      operazione, data_operazione: body?.data || null, note: body?.note || null,
      nuovo_destinatario: operazione === 'riconsegna_nuovo' ? (body?.nuovoDestinatario || null) : null,
      ...costi, richiesta_da: ruolo, creata_da: nomeUtente, stato: 'da_confermare',
    }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    // La spedizione resta in giacenza ma segnata "in attesa di conferma svincolo"
    await admin.from('spedizioni').update({ giacenza_stato: 'in_gestione' }).eq('id', id)
    return NextResponse.json({ success: true, id: data?.id, costi })
  }

  // 2) Aggiunta costo manuale (solo master)
  if (azione === 'aggiungi_costo') {
    if (ruolo !== 'master') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    const importo = Number(body?.importo) || 0
    const { error } = await admin.from('giacenza_costi').insert({ spedizione_id: id, master_id: masterId, nota: body?.nota || null, importo, creato_da: nomeUtente })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }
  if (azione === 'rimuovi_costo') {
    if (ruolo !== 'master') return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    await admin.from('giacenza_costi').delete().eq('id', body?.costoId).eq('spedizione_id', id)
    return NextResponse.json({ success: true })
  }

  // 3) Annulla una richiesta ancora da confermare
  if (azione === 'annulla') {
    await admin.from('giacenza_richieste').update({ stato: 'annullata' }).eq('id', body?.richiestaId).eq('spedizione_id', id).eq('stato', 'da_confermare')
    return NextResponse.json({ success: true })
  }

  // 4) Conferma svincolo (solo master) -> addebito + aggiornamento + invio al corriere
  if (azione === 'conferma_svincolo') {
    if (ruolo !== 'master') return NextResponse.json({ error: 'Solo il master puo confermare lo svincolo' }, { status: 403 })
    const { data: rich } = await admin.from('giacenza_richieste').select('*').eq('id', body?.richiestaId).eq('spedizione_id', id).maybeSingle()
    if (!rich) return NextResponse.json({ error: 'Richiesta non trovata' }, { status: 404 })
    if (rich.stato === 'confermata') return NextResponse.json({ error: 'Richiesta gia confermata' }, { status: 400 })

    const { data: costiManuali } = await admin.from('giacenza_costi').select('importo').eq('spedizione_id', id)
    const extra = (costiManuali || []).reduce((s: number, c: any) => s + (Number(c.importo) || 0), 0)
    const totale = +((Number(rich.costo_totale) || 0) + extra).toFixed(2)

    const opLabel: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }
    const istr = `${opLabel[rich.operazione] || rich.operazione}${rich.data_operazione ? ' - data ' + rich.data_operazione : ''}${rich.note ? ' - ' + rich.note : ''}`

    // Invio al corriere (riuso API delivery-instructions esistente)
    const cred = sped.corrieri?.credenziali as Record<string, string>
    if (cred?.master_domain && cred?.password && sped.tracking_number) {
      try {
        await fetch(`https://${cred.master_domain}/api/v2/shipping/delivery-instructions/${sped.tracking_number}`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: istr, operation: rich.operazione, new_recipient: rich.nuovo_destinatario || undefined }),
        })
      } catch (e) { console.error('Errore invio svincolo al corriere:', e) }
    }

    // Addebito al cliente
    if (totale > 0 && !sped.giacenza_addebito_effettuato) {
      await admin.from('movimenti_clienti').insert({
        master_id: sped.master_id, cliente_id: sped.cliente_id, tipo: 'addebito',
        descrizione: `Giacenza ${sped.numero} - ${opLabel[rich.operazione] || rich.operazione}`,
        prezzo_unitario: totale, quantita: 1, iva: 22, importo: totale,
        totale_iva: +(totale * 0.22).toFixed(2), totale: +(totale * 1.22).toFixed(2),
        data_acquisto: new Date().toISOString().split('T')[0],
      })
    }

    await admin.from('giacenza_richieste').update({ stato: 'confermata', confermata_da: nomeUtente, confermata_at: new Date().toISOString() }).eq('id', rich.id)
    // La spedizione resta nella lista giacenze come "svincolata" (verde: svincolo confermato).
    // Non tocco spedizioni.stato cosi la riga non sparisce dall'elenco giacenze.
    await admin.from('spedizioni').update({
      giacenza_stato: 'svincolata', giacenza_istruzioni: istr, giacenza_addebito_effettuato: true,
    }).eq('id', id)
    return NextResponse.json({ success: true, addebito: totale })
  }

  // 5) Chiudi giacenza (solo master) -> non piu gestibile
  if (azione === 'chiudi') {
    if (ruolo !== 'master') return NextResponse.json({ error: 'Solo il master puo chiudere la giacenza' }, { status: 403 })
    await admin.from('spedizioni').update({ giacenza_stato: 'chiusa' }).eq('id', id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}
