import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

// GET /api/v1/account — verifica del collegamento ("test connessione").
// Con API key valida risponde 200 con i dati del contratto; senza, 401.
// Utile alle piattaforme che validano le credenziali con una semplice GET.
export async function GET(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })

  const admin = createAdminSupabase()
  const [{ data: cliente }, { data: corriere }] = await Promise.all([
    admin.from('clienti').select('ragione_sociale,credito,listino_cliente_id').eq('id', ctx.clienteId).single(),
    admin.from('corrieri').select('nome_contratto,tipo,attivo').eq('id', ctx.corriereId).single(),
  ])

  return NextResponse.json({
    ok: true,
    account: cliente?.ragione_sociale || null,
    contratto: corriere?.nome_contratto || null,
    contratto_attivo: corriere?.attivo !== false,
    listino_attivo: !!cliente?.listino_cliente_id,
    credito: Number(cliente?.credito || 0),
    valuta: 'EUR',
    base_url: 'https://moovexpress.com/api/v1',
  })
}
