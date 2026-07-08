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

  // Ricarica del credito di un SOTTO-MASTER agganciato (id = "m:<masterId>")
  if (typeof clienteId === 'string' && clienteId.startsWith('m:')) {
    const targetMasterId = clienteId.slice(2)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: sub } = await admin.from('masters').select('id,parent_master_id').eq('id', targetMasterId).single()
    // Autorizzato se il mio master è un ANTENATO del sotto-master (figlio diretto o più in basso
    // nella rete), coerente con accesso/impersona che risalgono la catena parent_master_id.
    let cur: string | null = sub?.parent_master_id || null
    let autorizzato = false
    for (let i = 0; i < 20 && cur; i++) {
      if (cur === utente.master_id) { autorizzato = true; break }
      const { data: p } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
      cur = p?.parent_master_id || null
    }
    if (!sub || !autorizzato) {
      return NextResponse.json({ error: 'Sotto-master non trovato o non autorizzato' }, { status: 403 })
    }
    try {
      const { registraMovimentoMaster } = await import('@/lib/movimenti')
      const { saldo } = await registraMovimentoMaster(admin, {
        masterOwnerId: utente.master_id, masterTargetId: targetMasterId,
        tipo, descrizione: String(descrizione).trim(),
        riferimento: riferimento ? String(riferimento).trim() : null,
        importo, createdBy: user.id,
      })
      return NextResponse.json({ ok: true, saldo })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Errore ricarica sotto-master' }, { status: 500 })
    }
  }

  // Verifica che il cliente appartenga a questo master
  const { data: cli } = await supabase
    .from('clienti').select('id, master_id').eq('id', clienteId).single()
  if (!cli || cli.master_id !== utente.master_id) {
    // Fallback robusto: l'id potrebbe essere quello di un SOTTO-MASTER della rete inviato
    // SENZA il prefisso m: (bug frontend). Se è un master discendente, lo tratto come sotto-master.
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: sub } = await admin.from('masters').select('id,parent_master_id').eq('id', clienteId).maybeSingle()
    if (sub) {
      let cur: string | null = sub.parent_master_id || null
      let autorizzato = false
      for (let i = 0; i < 20 && cur; i++) {
        if (cur === utente.master_id) { autorizzato = true; break }
        const { data: p } = await admin.from('masters').select('parent_master_id').eq('id', cur).maybeSingle()
        cur = p?.parent_master_id || null
      }
      if (autorizzato) {
        try {
          const { registraMovimentoMaster } = await import('@/lib/movimenti')
          const { saldo } = await registraMovimentoMaster(admin, {
            masterOwnerId: utente.master_id, masterTargetId: clienteId,
            tipo, descrizione: String(descrizione).trim(),
            riferimento: riferimento ? String(riferimento).trim() : null,
            importo, createdBy: user.id,
          })
          return NextResponse.json({ ok: true, saldo })
        } catch (e: any) {
          return NextResponse.json({ error: e?.message || 'Errore ricarica sotto-master' }, { status: 500 })
        }
      }
    }
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
