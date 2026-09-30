import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { inviaCredenzialiCliente } from '@/lib/email'
import { bloccaAgente } from '@/lib/agente'

// Almeno 12 caratteri: sotto quella soglia Supabase RIFIUTA la password. Prima erano 10 e la
// creazione dell'accesso falliva, con l'errore mai letto e l'email di credenziali spedita lo stesso.
function generaPassword(len = 14): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  return Array.from({length: len}, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id, ruolo, masters(nome,slug)').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg   // agente = sola lettura
  if (!utente?.master_id) return NextResponse.json({ error: 'Master non trovato' }, { status: 400 })
  const body = await req.json()
  const email = body.email?.toLowerCase().trim()
  const ragioneSociale = body.ragione_sociale
  if (!email) return NextResponse.json({ error: 'Email obbligatoria' }, { status: 400 })
  if (!ragioneSociale) return NextResponse.json({ error: 'Ragione sociale obbligatoria' }, { status: 400 })
  // Duplicato email: il vincolo `clienti_email_key` è GLOBALE (una email = un cliente su TUTTA la
  // piattaforma). Il controllo va fatto col client ADMIN, non con quello RLS-scoped: altrimenti
  // un'email già usata sotto un ALTRO master — o sotto un proprio agente/sotto-account non visibile —
  // non veniva vista qui e la creazione falliva più sotto con l'errore GREZZO del DB ("duplicate key
  // value violates unique constraint clienti_email_key"), incomprensibile: è IL motivo per cui la
  // creazione "non funzionava". Ora: messaggio chiaro + log per misurare quanto capita.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const adminClient = createAdminSupabase()
  const { data: existing } = await adminClient.from('clienti').select('id, master_id').eq('email', email).maybeSingle()
  if (existing) {
    const tuo = existing.master_id === utente.master_id
    console.error('[CLIENTE][CREA] 400 email duplicata', { tuo })
    return NextResponse.json({ error: tuo
      ? 'Hai già un cliente con questa email (può essere sotto un tuo agente o non più attivo): cercalo nell\'Elenco Clienti invece di ricrearlo.'
      : 'Questa email è già usata da un altro account sulla piattaforma e non può essere riassegnata a un nuovo cliente. Usa un\'altra email.' },
      { status: 400 })
  }
  // CODICE PROGRESSIVO PER MASTER, calcolato SOLO sui codici della serie e in NUMERICO.
  //
  // Prima si prendeva il massimo in ordine ALFABETICO su tutti i codici, comunque fossero fatti, e da
  // quella stringa si tiravano fuori le cifre. Bastava un codice fuori serie per rompere tutto: Velox
  // aveva "LDG-9F9FA70C" (un cliente d'ingrosso), che in alfabeto viene dopo ogni "CLI-…"; le sue
  // cifre sono 9,9,7,0 -> 9970, quindi proponeva sempre CLI-9971, che esisteva gia'. Non una corsa:
  // un blocco FISSO, a ogni tentativo, e il master non poteva piu' creare clienti. Stessa cosa per
  // MoovExpress con "TIKTOKREV" (nessuna cifra -> ripartiva da CLI-0001, gia' preso).
  //
  // Quindi: si guardano solo i "CLI-<numero>", si confronta il NUMERO e non il testo, e i codici
  // personalizzati restano fuori dalla serie — che e' quello che sono.
  const { data: codici } = await supabase.from('clienti')
    .select('codice_cliente').eq('master_id', utente.master_id).like('codice_cliente', 'CLI-%')
  let prossimo = 1
  for (const r of (codici || [])) {
    const m = /^CLI-(\d+)$/.exec(String((r as any).codice_cliente || '').trim())
    if (m) prossimo = Math.max(prossimo, parseInt(m[1], 10) + 1)
  }
  const password = generaPassword()
  // E SE DUE CREAZIONI SI SCONTRANO DAVVERO, si riprova col numero dopo invece di rimandare indietro
  // l'utente: e' il caso che il messaggio raccontava gia' prima, ma senza farci niente.
  let nuovoCliente: any = null
  let error: any = null
  let codice = ''
  for (let tent = 0; tent < 5; tent++) {
    codice = `CLI-${String(prossimo + tent).padStart(4, '0')}`
    const res = await supabase.from('clienti').insert({
    master_id: utente.master_id,
    ragione_sociale: ragioneSociale,
    piva: body.piva||null, cf: body.cf||null, pec: body.pec||null,
    cod_sdi: body.cod_sdi||null, rappresentante_legale: body.rappresentante_legale||null,
    telefono: body.telefono||null, email,
    sl_paese: body.sl_paese||'Italia', sl_indirizzo: body.sl_indirizzo||null,
    sl_citta: body.sl_citta||null, sl_provincia: body.sl_provincia||null, sl_cap: body.sl_cap||null,
    so_paese: body.so_paese||'Italia', so_indirizzo: body.so_indirizzo||null,
    so_citta: body.so_citta||null, so_provincia: body.so_provincia||null, so_cap: body.so_cap||null,
    listino_cliente_id: body.listino_cliente_id||null,
    // Nuovi clienti: formato etichetta di default 10x11 (deciso 18/9). Gli esistenti restano al formato
    // nativo del corriere finché non scelgono (il campo assente = nativo). Vedi lib/formato-etichetta.
    impostazioni: { formato_stampa: '10x11' },
    tipo_contratto: body.tipo_contratto||'credito_scalare',
    aliquota_iva: body.aliquota_iva||'22',
    fattura_auto: body.fattura_auto||false,
    metodo_pagamento: body.metodo_pagamento||'sepa',
    diritto_fisso: body.diritto_fisso||false,
    agente: body.agente||null,
    ritiro_tipo: body.ritiro_tipo||null, ritiro_fascia: body.ritiro_fascia||null,
    rimborso_freq: body.rimborso_freq||null, rimborso_tipo: body.rimborso_tipo||null,
    iban: body.iban||null, abi: body.abi||null, cab: body.cab||null,
    bic_swift: body.bic_swift||null, note_rimborso: body.note_rimborso||null,
    codice_cliente: codice, attivo: true,
    }).select().single()
    nuovoCliente = res.data; error = res.error
    if (!error && nuovoCliente) break
    const collisioneCodice = (res.error as any)?.code === '23505' && /codice/i.test(res.error?.message || '')
    if (!collisioneCodice) break        // un altro errore non si risolve riprovando
  }
  if (error || !nuovoCliente) {
    // L'email duplicata è già intercettata sopra. Sul codice si è già riprovato cinque volte qui
    // sopra: se si arriva fin qui non è più "riprova", è qualcosa che non si sblocca da solo — e il
    // messaggio non deve mandare l'utente a ritentare all'infinito come faceva prima.
    console.error('[CLIENTE][CREA] insert KO', (error as any)?.code, error?.message)
    const codiceInUso = (error as any)?.code === '23505' && /codice/i.test(error?.message || '')
    return NextResponse.json({ error: codiceInUso
      ? 'Non sono riuscito ad assegnare un codice cliente libero. Riprova fra un istante; se continua, segnalalo all\'assistenza.'
      : 'Non è stato possibile creare il cliente. Riprova; se il problema persiste contatta l\'assistenza.' },
      { status: 400 })
  }
  // L'accesso va creato PRIMA di spedire le credenziali. Se qui falliva (indirizzo già usato da
  // un altro account, ecc.) l'errore non veniva letto e l'email partiva lo stesso: al cliente
  // arrivava una password di un account inesistente e non riusciva ad entrare.
  let accessoCreato = false
  let motivoAccesso = ''
  try {
    const { data: authUser, error: aErr } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true })
    if (aErr || !authUser?.user) {
      motivoAccesso = aErr?.message || 'creazione utente non riuscita'
      console.error('[CLIENTE][ACCESSO] createUser fallito', { email, motivo: motivoAccesso })
    } else {
      // client ADMIN: la riga utenti è di un altro utente, l'RLS bloccherebbe il client utente-scoped
      const { error: uErr } = await adminClient.from('utenti').insert({ id: authUser.user.id, ruolo: 'cliente', master_id: utente.master_id, cliente_id: nuovoCliente.id, nome: ragioneSociale, attivo: true })
      if (uErr) { motivoAccesso = uErr.message; console.error('Errore creazione riga utenti cliente:', uErr) }
      else accessoCreato = true
    }
  } catch(e: any) { motivoAccesso = e?.message || 'errore imprevisto'; console.error('Auth error:', e) }

  // Credenziali spedite SOLO se l'accesso esiste davvero.
  if (accessoCreato) {
    try {
      const master = (utente as any).masters
      await inviaCredenzialiCliente({ email, nomeCliente: ragioneSociale, masterNome: master?.nome||'MoovExpress', dominio: 'moovexpress.com', password })
    } catch(e) { console.error('Email error:', e) }
  }
  return NextResponse.json({
    id: nuovoCliente.id, codice, email,
    password: accessoCreato ? password : null,
    accessoCreato,
    // Il master deve saperlo subito: il cliente è in anagrafica ma senza accesso.
    avviso: accessoCreato ? null : `Cliente creato, ma l'ACCESSO non è stato attivato (${motivoAccesso}). Nessuna email inviata: apri la scheda del cliente e usa "Reset password" per attivarlo.`,
  })
}
