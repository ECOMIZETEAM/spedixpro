import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Tracking PUBBLICO per il destinatario (link nell'SMS/email). Nessuna autenticazione: si apre con il
// solo `tracking_token` (128 bit, non indovinabile). Espone SOLO stato + città + eventi: MAI nome,
// indirizzo, telefono, email, mittente, cliente, contrassegno, costi o il nome tecnico del provider.
const STATO_LABEL: Record<string, string> = {
  in_lavorazione: 'In lavorazione',
  spedita: 'Presa in carico',
  in_transito: 'In transito',
  in_consegna: 'In consegna',
  consegnata: 'Consegnata',
  in_giacenza: 'In giacenza',
  non_consegnato: 'Consegna non riuscita',
  reso_mittente: 'In reso al mittente',
  annullata: 'Annullata',
  annullamento_manuale: 'Annullata',
  annullamento_pending: 'In lavorazione',
}

const COLS = 'id,master_id,stato,numero,tracking_number,dest_citta,dest_provincia,updated_at,created_at'

// "NON TROVATA" E "NON SONO RIUSCITO A GUARDARE" SONO DUE COSE DIVERSE.
//
// Prima l'errore della query veniva buttato via (`const { data } = await ...`): se il database aveva
// un singhiozzo — e ne capitano, nei log ci sono ECONNRESET a pacchi — `data` restava vuoto e al
// DESTINATARIO rispondevamo "Spedizione non trovata". Cioe' dicevamo a chi aspetta un pacco che il
// suo pacco non esiste, per un problema nostro durato un secondo. Visto succedere il 21/09/2026 su
// una spedizione che esisteva benissimo, mentre si registrava il video per la revisione Shopify.
// Ora si ritenta una volta e, se ancora non si riesce, si risponde 503: la pagina dira' "riprova",
// che e' la verita'.
async function cerca(q: () => any): Promise<{ riga?: any; guasto?: string }> {
  for (let tentativo = 0; tentativo < 2; tentativo++) {
    try {
      const { data, error } = await q()
      if (!error) return { riga: data || null }
      if (tentativo === 1) return { guasto: String(error.message || error) }
    } catch (e: any) {
      if (tentativo === 1) return { guasto: String(e?.message || e) }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return { guasto: 'database non raggiungibile' }
}

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get('t') || '').trim()
  const numero = (req.nextUrl.searchParams.get('n') || '').trim()
  const admin = createAdminSupabase()

  let esito: { riga?: any; guasto?: string }
  if (token) {
    // Token = esadecimale di un uuid (32 char). Regex stretta: niente lookup su input sospetti.
    if (!/^[a-f0-9]{20,40}$/.test(token)) return NextResponse.json({ error: 'Codice non valido' }, { status: 400 })
    esito = await cerca(() => admin.from('spedizioni').select(COLS).eq('tracking_token', token).maybeSingle())
  } else if (numero) {
    // Ricerca dal PORTALE (/traccia): il cliente digita la LDV / numero. Alfanumerico + trattini.
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(numero)) return NextResponse.json({ error: 'Numero non valido' }, { status: 400 })
    esito = await cerca(() => admin.from('spedizioni').select(COLS)
      .or(`numero.eq.${numero},tracking_number.eq.${numero}`)
      .order('created_at', { ascending: false }).limit(1).maybeSingle())
  } else {
    return NextResponse.json({ error: 'Manca il codice' }, { status: 400 })
  }
  if (esito.guasto) {
    console.error('[TRACKING PUBBLICO] lettura non riuscita:', esito.guasto)
    return NextResponse.json({ error: 'non_disponibile' }, { status: 503 })
  }
  const s: any = esito.riga
  if (!s) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // WHITE-LABEL: il destinatario vede il marchio del master della spedizione (come nel portale
  // cliente), con ripiego su MoovExpress. Non espone il mittente/cliente, solo il brand di piattaforma.
  let brand: { nome: string; logo: string | null } = { nome: 'MoovExpress', logo: null }
  if (s.master_id) {
    const { data: m } = await admin.from('masters').select('nome,logo_url').eq('id', s.master_id).maybeSingle()
    if (m?.nome) brand = { nome: m.nome, logo: m.logo_url || null }
  }

  const { data: ev } = await admin
    .from('tracking_events')
    .select('descrizione,luogo,data_evento')
    .eq('spedizione_id', s.id)
    .order('data_evento', { ascending: false })
    .limit(50)

  return NextResponse.json({
    brand,
    stato: s.stato,
    stato_label: STATO_LABEL[s.stato] || 'In lavorazione',
    // Numero visibile: il tracking del corriere se c'è, altrimenti il nostro numero interno.
    riferimento: s.tracking_number || s.numero || null,
    citta: s.dest_citta || null,
    provincia: s.dest_provincia || null,
    aggiornato_il: s.updated_at || s.created_at,
    eventi: (ev || []).map((e: any) => ({
      descrizione: e.descrizione || 'Aggiornamento',
      luogo: e.luogo || '',
      data: e.data_evento || '',
    })),
  })
}
