import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'

// CHECK RICARICHE: monitoraggio bonifici delle ricariche manuali (vedi tabella ricariche_check).
// Ogni master vede SOLO le ricariche che ha fatto lui (master_id esatto): il bonifico arriva a lui.
// Due soglie di alert (modificabili qui): giorni senza bonifico, giorni senza conferma d'arrivo.
const GIORNI_NO_BONIFICO = 3
const GIORNI_NO_ARRIVO = 4
const MS_G = 86400000

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id } : null
}

// Calcola stato e alert di una riga (rispetto ad adesso).
function arricchisci(r: any) {
  const ora = Date.now()
  const eff = r.bonifico_effettuato_il ? new Date(r.bonifico_effettuato_il).getTime() : null
  const arr = r.bonifico_arrivato_il ? new Date(r.bonifico_arrivato_il).getTime() : null
  const ric = r.ricaricato_il ? new Date(r.ricaricato_il).getTime() : ora
  const stato = arr ? 'arrivato' : eff ? 'effettuato' : 'in_attesa'
  const giorniDaRicarica = Math.floor((ora - ric) / MS_G)
  const giorniDaEffettuato = eff ? Math.floor((ora - eff) / MS_G) : null
  const alert_no_bonifico = stato === 'in_attesa' && giorniDaRicarica >= GIORNI_NO_BONIFICO
  const alert_no_arrivo = stato === 'effettuato' && (giorniDaEffettuato ?? 0) >= GIORNI_NO_ARRIVO
  return { ...r, stato, giorniDaRicarica, giorniDaEffettuato, alert_no_bonifico, alert_no_arrivo, alert: alert_no_bonifico || alert_no_arrivo }
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const p = req.nextUrl.searchParams

  // Badge menu: quanti ALERT attivi (righe aperte in allarme). Leggo solo le aperte.
  if (p.get('count')) {
    const { data } = await admin.from('ricariche_check')
      .select('ricaricato_il,bonifico_effettuato_il,bonifico_arrivato_il')
      .eq('master_id', s.master_id).is('bonifico_arrivato_il', null).limit(3000)
    const n = (data || []).map(arricchisci).filter((r: any) => r.alert).length
    return NextResponse.json({ count: n })
  }

  let q = admin.from('ricariche_check').select('*')
    .eq('master_id', s.master_id).order('ricaricato_il', { ascending: false }).limit(1000)
  const dal = p.get('dal'), al = p.get('al')
  if (dal) q = q.gte('ricaricato_il', dal)
  if (al) q = q.lte('ricaricato_il', al + 'T23:59:59')
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  let righe = (data || []).map(arricchisci)
  const cerca = (p.get('q') || '').trim().toLowerCase()
  if (cerca) righe = righe.filter((r: any) => (r.target_nome || '').toLowerCase().includes(cerca))
  const filtro = p.get('stato')
  if (filtro === 'alert') righe = righe.filter((r: any) => r.alert)
  else if (filtro && ['in_attesa', 'effettuato', 'arrivato'].includes(filtro)) righe = righe.filter((r: any) => r.stato === filtro)

  const riepilogo = {
    scoperto: righe.filter((r: any) => r.stato !== 'arrivato').reduce((t: number, r: any) => t + Number(r.importo || 0), 0),
    n_in_attesa: righe.filter((r: any) => r.stato === 'in_attesa').length,
    n_effettuato: righe.filter((r: any) => r.stato === 'effettuato').length,
    n_alert: righe.filter((r: any) => r.alert).length,
    soglie: { no_bonifico: GIORNI_NO_BONIFICO, no_arrivo: GIORNI_NO_ARRIVO },
  }
  return NextResponse.json({ righe, riepilogo })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const b = await req.json().catch(() => ({}))
  const id = String(b.id || ''); const azione = String(b.azione || '')
  if (!id || !azione) return NextResponse.json({ error: 'Dati mancanti' }, { status: 400 })

  // La riga dev'essere del MIO master: conoscere un id qualsiasi non basta.
  const { data: riga } = await admin.from('ricariche_check')
    .select('id,master_id,bonifico_effettuato_il').eq('id', id).maybeSingle()
  if (!riga || riga.master_id !== s.master_id) return NextResponse.json({ error: 'Riga non trovata' }, { status: 403 })

  if (azione === 'elimina') {
    await admin.from('ricariche_check').delete().eq('id', id)
    return NextResponse.json({ ok: true })
  }
  const now = new Date().toISOString()
  let patch: any = null
  if (azione === 'effettuato') patch = { bonifico_effettuato_il: now }
  else if (azione === 'annulla_effettuato') patch = { bonifico_effettuato_il: null, bonifico_arrivato_il: null }
  else if (azione === 'arrivato') patch = { bonifico_arrivato_il: now, bonifico_effettuato_il: riga.bonifico_effettuato_il || now }
  else if (azione === 'annulla_arrivato') patch = { bonifico_arrivato_il: null }
  else if (azione === 'nota') patch = { note: b.note ? String(b.note).slice(0, 500) : null }
  else return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })

  const { error } = await admin.from('ricariche_check').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
