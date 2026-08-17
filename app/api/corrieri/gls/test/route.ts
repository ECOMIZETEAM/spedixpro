import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { creaSpedizioneConEtichettaGls, annullaSpedizioneGls, type CredenzialiGls } from '@/lib/gls'

// ─────────────────────────────────────────────────────────────────────────────
// TEST connessione GLS diretto — SOLO IL PROPRIETARIO del contratto.
//
// Fa un AddParcel di PROVA con le credenziali vere salvate sul contratto e poi cancella
// subito il collo (DeleteParcel), così l'account GLS non resta con colli appesi. Serve a
// verificare che credenziali + struttura XMLInfoParcel siano corrette PRIMA di collegare
// GLS al percorso di creazione reale (rischio pacchi). Mostra la risposta grezza di GLS:
// se la struttura è sbagliata, GLS risponde con un errore parlante e si corregge il modulo.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Utente senza master' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const corriereId = String(body?.corriereId || '')
  if (!corriereId) return NextResponse.json({ error: 'corriereId mancante' }, { status: 400 })

  // Verifica proprietà con client user-scoped (RLS), SENZA credenziali: la colonna `credenziali`
  // non è leggibile da 'authenticated' (grant SELECT per-colonna), un select che la include
  // fallirebbe l'intera query.
  const { data: c } = await supabase.from('corrieri')
    .select('id,tipo,proprio,settings,nome_contratto')
    .eq('id', corriereId).eq('master_id', utente.master_id).eq('proprio', true).eq('tipo', 'gls')
    .maybeSingle()
  if (!c) return NextResponse.json({ error: 'Contratto GLS non trovato o non di tua proprietà' }, { status: 403 })

  // Credenziali via admin: la proprietà è già verificata qui sopra.
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const { data: credRow } = await createAdminSupabase().from('corrieri').select('credenziali').eq('id', corriereId).maybeSingle()
  const cred = ((credRow as { credenziali?: CredenzialiGls } | null)?.credenziali || {}) as CredenzialiGls
  if (!cred.sigla_sede || !cred.user_webservice || !cred.password_webservice) {
    return NextResponse.json({ error: 'Credenziali GLS incomplete: compila Sigla Sede, User e Password del webservice dal pannello.' }, { status: 400 })
  }

  // Collo di prova: destinazione neutra, 1 collo, 1 kg, nessun contrassegno.
  try {
    const ris = await creaSpedizioneConEtichettaGls(cred, {
      ragioneSociale: 'TEST MOOVEXPRESS - NON SPEDIRE',
      indirizzo: 'Via Prova 1',
      localita: 'Milano',
      cap: '20100',
      provincia: 'MI',
      pesiColli: [1],
      bda: 'TEST',
    })

    // Se ha creato davvero un collo, lo annulliamo per non lasciarlo sull'account.
    let annullato: boolean | null = null
    if (ris.numeroSpedizione) {
      annullato = await annullaSpedizioneGls(cred, ris.numeroSpedizione)
    }

    return NextResponse.json({
      ok: !!ris.numeroSpedizione,
      numeroSpedizione: ris.numeroSpedizione,
      tracking: ris.tracking,
      haEtichetta: !!ris.pdfBase64,
      errore: ris.errore,
      collodProvaAnnullato: annullato,
      // Risposta grezza troncata: se la struttura è errata, qui si legge il perché.
      raw: (ris.raw || '').substring(0, 1500),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: `Chiamata GLS fallita: ${msg}`.substring(0, 600) }, { status: 502 })
  }
}
