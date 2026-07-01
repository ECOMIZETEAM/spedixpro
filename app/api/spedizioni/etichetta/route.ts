import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id').eq('id', user.id).single()

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID spedizione mancante' }, { status: 400 })

  const { data: sped } = await supabase
    .from('spedizioni')
    .select('etichetta_url, colli_dettaglio, cliente_id, master_id, numero')
    .eq('id', id)
    .single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // Isolamento multi-tenant
  if (utente?.ruolo === 'cliente') {
    if (sped.cliente_id !== utente.cliente_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  } else if (utente?.master_id && sped.master_id !== utente.master_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // Sorgente etichetta: prima etichetta_url, poi primo collo con etichetta
  let src: string | null = sped.etichetta_url || null
  if (!src && Array.isArray(sped.colli_dettaglio)) {
    src = (sped.colli_dettaglio as any[]).find(c => c?.etichetta_url)?.etichetta_url || null
  }
  if (!src) return NextResponse.json({ error: 'Etichetta non disponibile' }, { status: 404 })

  const filename = `etichetta-${sped.numero || id}.pdf`

  // Caso 1: data URL base64
  const m = src.match(/^data:(application\/pdf|image\/[\w.+-]+);base64,(.+)$/s)
  if (m) {
    const buf = Buffer.from(m[2], 'base64')
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': m[1],
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    })
  }

  // Caso 2: URL remoto → proxy
  if (/^https?:\/\//i.test(src)) {
    try {
      const r = await fetch(src)
      if (!r.ok) return NextResponse.json({ error: 'Etichetta non raggiungibile' }, { status: 502 })
      const buf = Buffer.from(await r.arrayBuffer())
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': r.headers.get('content-type') || 'application/pdf',
          'Content-Disposition': `inline; filename="${filename}"`,
          'Cache-Control': 'private, max-age=0, no-store',
        },
      })
    } catch {
      return NextResponse.json({ error: 'Errore nel recupero etichetta' }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Formato etichetta non riconosciuto' }, { status: 400 })
}
