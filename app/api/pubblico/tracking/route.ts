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

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get('t') || '').trim()
  // Il token è l'esadecimale di un uuid (32 char). Regex stretta: niente lookup su input sospetti.
  if (!/^[a-f0-9]{20,40}$/.test(token)) {
    return NextResponse.json({ error: 'Codice non valido' }, { status: 400 })
  }
  const admin = createAdminSupabase()
  const { data: s } = await admin
    .from('spedizioni')
    .select('id,master_id,stato,numero,tracking_number,dest_citta,dest_provincia,updated_at,created_at')
    .eq('tracking_token', token)
    .single()
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
