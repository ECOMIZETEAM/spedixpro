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

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get('t') || '').trim()
  const numero = (req.nextUrl.searchParams.get('n') || '').trim()
  const admin = createAdminSupabase()

  let s: any = null
  if (token) {
    // Token = esadecimale di un uuid (32 char). Regex stretta: niente lookup su input sospetti.
    if (!/^[a-f0-9]{20,40}$/.test(token)) return NextResponse.json({ error: 'Codice non valido' }, { status: 400 })
    const { data } = await admin.from('spedizioni').select(COLS).eq('tracking_token', token).maybeSingle()
    s = data
  } else if (numero) {
    // Ricerca dal PORTALE (/traccia): il cliente digita la LDV / numero. Alfanumerico + trattini.
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(numero)) return NextResponse.json({ error: 'Numero non valido' }, { status: 400 })
    const { data } = await admin.from('spedizioni').select(COLS)
      .or(`numero.eq.${numero},tracking_number.eq.${numero}`)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    s = data
  } else {
    return NextResponse.json({ error: 'Manca il codice' }, { status: 400 })
  }
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
