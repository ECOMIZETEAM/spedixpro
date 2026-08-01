import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// L'AUTISTA, DAL TELEFONO.
//
// Niente applicazione da installare: l'autista e' un utente come gli altri, entra dal telefono e
// vede una schermata sola — i pacchi che deve consegnare oggi. E' la stessa scelta fatta per il
// resto del sistema: un codice solo, che si aggiorna per tutti nello stesso momento, invece di
// due (portale + app) che prima o poi raccontano cose diverse.
//
// Il suo perimetro e' STRETTO: solo i pacchi del circuito interno del suo master, solo quelli in
// consegna, e solo nella SUA zona se ne ha una assegnata. Nessun prezzo, nessun cliente, nessun
// conto: a chi guida non servono e non deve vederli.

async function autistaDalToken() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: u } = await supabase.from('utenti').select('id,nome,cognome,ruolo,master_id,attivo').eq('id', user.id).single()
  if (!u || (u.ruolo || '').toLowerCase() !== 'autista' || !u.master_id) {
    return { errore: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  }
  if (u.attivo === false) return { errore: NextResponse.json({ error: 'Accesso sospeso' }, { status: 403 }) }
  const admin = createAdminSupabase()
  // La riga in anagrafica: e' quella che porta la zona e su cui si contano le consegne.
  const { data: a } = await admin.from('autisti')
    .select('id,nome,zona_id,attivo,zone(nome)').eq('utente_id', u.id).eq('master_id', u.master_id).maybeSingle()
  return { user, utente: u, admin, autista: a || null }
}

// I CAP della zona dell'autista. Senza zona assegnata vede tutto quello che c'e' da consegnare:
// meglio che non vedere niente, ed e' come lavorano le squadre piccole.
async function capDellaZona(admin: any, zonaId: string | null): Promise<Set<string> | null> {
  if (!zonaId) return null
  const out = new Set<string>()
  for (let da = 0; ; da += 1000) {
    const { data } = await admin.from('zone_cap').select('cap').eq('zona_id', zonaId).range(da, da + 999)
    for (const r of (data || [])) if (r.cap) out.add(String(r.cap).trim())
    if (!data || data.length < 1000) break
  }
  return out
}

export async function GET(_req: NextRequest) {
  const ctx = await autistaDalToken()
  if ('errore' in ctx) return ctx.errore
  const { utente, admin, autista } = ctx

  const { data: contratti } = await admin.from('corrieri').select('id').eq('tipo', 'interno').eq('master_id', utente.master_id)
  const corrieriIds = (contratti || []).map((c: any) => c.id)
  if (!corrieriIds.length) {
    return NextResponse.json({ autista: autista?.nome || utente.nome, zona: null, consegne: [], fatte: [] })
  }

  const { data: sp } = await admin.from('spedizioni')
    .select('id,numero,stato,dest_nome,dest_indirizzo,dest_cap,dest_citta,dest_provincia,dest_telefono,colli,contrassegno,note')
    .in('corriere_id', corrieriIds)
    .in('stato', ['in_transito', 'in_consegna'])
    .order('dest_cap').limit(500)

  const capZona = await capDellaZona(admin, autista?.zona_id || null)
  const consegne = (sp || []).filter((s: any) => !capZona || capZona.has(String(s.dest_cap || '').trim()))

  // Quello che ha gia' fatto oggi: serve a lui per sapere a che punto e', e a noi perche' un pacco
  // gia' consegnato non deve restare nella lista di chi guida.
  const oggi = new Date().toISOString().slice(0, 10)
  const { data: fatte } = autista ? await admin.from('scansioni_interne')
    .select('tipo,created_at,spedizioni(numero,dest_nome,dest_citta)')
    .eq('autista_id', autista.id).in('tipo', ['consegna', 'tentata'])
    .gte('created_at', `${oggi}T00:00:00.000Z`).order('created_at', { ascending: false }).limit(200) : { data: [] }

  return NextResponse.json({
    autista: autista?.nome || utente.nome,
    zona: (autista as any)?.zone?.nome || null,
    senzaAnagrafica: !autista,
    consegne, fatte: fatte || [],
  })
}

// L'ESITO: consegnato, oppure destinatario assente. Sono le uniche due cose che puo' fare.
export async function POST(req: NextRequest) {
  const ctx = await autistaDalToken()
  if ('errore' in ctx) return ctx.errore
  const { user, utente, admin, autista } = ctx

  const body = await req.json()
  const tipo = String(body?.tipo || '')
  // Il ritiro c'e' perche' l'autista ritira anche dai mittenti; tutto il resto (ingresso in
  // deposito, partenze fra filiali) e' lavoro di magazzino e non passa da qui.
  if (!['consegna', 'tentata', 'ritiro'].includes(tipo)) {
    return NextResponse.json({ error: 'Operazione non consentita' }, { status: 400 })
  }
  // Virgole e parentesi via: sono i separatori del linguaggio di ricerca, e lasciarle passare
  // vorrebbe dire far scrivere a chi chiama il filtro invece del valore.
  const ldv = String(body?.ldv || '').trim().replace(/[,()]/g, '')
  if (!ldv) return NextResponse.json({ error: 'Lettera di vettura mancante' }, { status: 400 })

  const { data: sped } = await admin.from('spedizioni')
    .select('id,numero,master_id,dest_nome,dest_cap,dest_citta,contrassegno,corrieri(tipo)')
    .or(`numero.eq.${ldv},tracking_number.eq.${ldv}`).limit(1).maybeSingle()
  if (!sped) return NextResponse.json({ error: 'Lettera di vettura non trovata' }, { status: 404 })
  // Solo pacchi del PROPRIO master e solo del circuito interno: non si scende nella rete e non si
  // tocca cio' che viaggia su un contratto di un provider, dove gli stati li detta il corriere.
  if (sped.master_id !== utente.master_id || (sped as any).corrieri?.tipo !== 'interno') {
    return NextResponse.json({ error: 'Lettera di vettura non trovata' }, { status: 404 })
  }

  const { data, error } = await admin.rpc('fn_scansione_interna', {
    p_spedizione_id: sped.id,
    p_tipo: tipo,
    p_master_id: utente.master_id,
    p_autista_id: autista?.id || null,
    p_operatore: autista?.nome || utente.nome || null,
    p_filiale: null,
    p_note: String(body?.note || '').trim() || null,
    p_created_by: user.id,
  })
  if (error) {
    console.error('[AUTISTA][SCANSIONE]', error.message)
    return NextResponse.json({ error: 'Non registrata: riprova.' }, { status: 500 })
  }
  const esito = (data as any)?.esito
  if (esito === 'chiusa') {
    return NextResponse.json({ ok: false, error: `${sped.numero}: risulta già chiusa, chiedi in sede` })
  }
  return NextResponse.json({
    ok: esito === 'ok', ripetuta: esito === 'ripetuta',
    numero: sped.numero, destinatario: sped.dest_nome,
    contrassegno: Number(sped.contrassegno || 0),
    descrizione: (data as any)?.descrizione || null,
  })
}
