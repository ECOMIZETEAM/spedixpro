import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { registraMovimento, TipoMovimento } from '@/lib/movimenti'

const TIPI_MANUALI: TipoMovimento[] = ['ricarica', 'reso', 'rettifica', 'rimborso']

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, master_id').eq('id', user.id).single()

  // Solo il master può registrare movimenti manuali (ricariche, resi, rettifiche)
  if (utente?.ruolo === 'cliente' || !utente?.master_id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const body = await req.json()
  const { clienteId, tipo, descrizione, riferimento } = body
  const importo = Number(body.importo)

  if (!clienteId) return NextResponse.json({ error: 'clienteId mancante' }, { status: 400 })
  if (!TIPI_MANUALI.includes(tipo)) {
    return NextResponse.json({ error: 'Tipo movimento non valido' }, { status: 400 })
  }
  if (!isFinite(importo) || importo === 0) {
    return NextResponse.json({ error: 'Importo non valido (usa + o - e diverso da 0)' }, { status: 400 })
  }
  if (!descrizione || !String(descrizione).trim()) {
    return NextResponse.json({ error: 'Descrizione obbligatoria' }, { status: 400 })
  }

  // Verifica che il cliente appartenga a questo master
  const { data: cli } = await supabase
    .from('clienti').select('id, master_id').eq('id', clienteId).single()
  if (!cli || cli.master_id !== utente.master_id) {
    return NextResponse.json({ error: 'Cliente non trovato o non autorizzato' }, { status: 403 })
  }

  try {
    const { saldo } = await registraMovimento(supabase, {
      masterId: utente.master_id,
      clienteId,
      tipo,
      descrizione: String(descrizione).trim(),
      riferimento: riferimento ? String(riferimento).trim() : null,
      importo,
      createdBy: user.id,
    })
    return NextResponse.json({ ok: true, saldo })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Errore registrazione movimento' }, { status: 500 })
  }
}
