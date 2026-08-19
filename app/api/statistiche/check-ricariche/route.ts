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

// Le uniche azioni ammesse, con la GUARDIA sullo stato attuale (transizione rigida). L'update scatta
// SOLO se lo stato di partenza e' quello giusto: cosi' due click, un doppio invio o una richiesta in
// ritardo non possono "saltare" lo stato. È il cuore delle regole rigide sui bonifici.
//   in_attesa --effettuato--> effettuato --arrivato--> arrivato   (+ le due annulla, un passo alla volta)
const AZIONI = ['effettuato', 'arrivato', 'annulla_effettuato', 'annulla_arrivato', 'nota', 'elimina']

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const b = await req.json().catch(() => ({}))
  const id = String(b.id || ''); const azione = String(b.azione || '')
  if (!id || !AZIONI.includes(azione)) return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })

  // La riga dev'essere del MIO master: conoscere un id qualsiasi non basta. E ogni scrittura ripete
  // il vincolo master (eq master_id) come cintura, oltre alla guardia di stato.
  const { data: riga } = await admin.from('ricariche_check')
    .select('id,master_id,bonifico_effettuato_il,bonifico_arrivato_il').eq('id', id).maybeSingle()
  if (!riga || riga.master_id !== s.master_id) return NextResponse.json({ error: 'Riga non trovata nella tua rete' }, { status: 403 })

  const now = new Date().toISOString()

  if (azione === 'elimina') {
    const { error } = await admin.from('ricariche_check').delete().eq('id', id).eq('master_id', s.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, eliminata: true })
  }
  if (azione === 'nota') {
    const { error } = await admin.from('ricariche_check').update({ note: b.note ? String(b.note).slice(0, 500) : null }).eq('id', id).eq('master_id', s.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    // Transizione RIGIDA: patch + guardia sullo stato di partenza.
    let q: any = admin.from('ricariche_check')
    if (azione === 'effettuato') q = q.update({ bonifico_effettuato_il: now }).is('bonifico_effettuato_il', null)
    else if (azione === 'arrivato') q = q.update({ bonifico_arrivato_il: now }).is('bonifico_arrivato_il', null).not('bonifico_effettuato_il', 'is', null)
    else if (azione === 'annulla_arrivato') q = q.update({ bonifico_arrivato_il: null }).not('bonifico_arrivato_il', 'is', null)
    else /* annulla_effettuato */ q = q.update({ bonifico_effettuato_il: null }).not('bonifico_effettuato_il', 'is', null).is('bonifico_arrivato_il', null)
    const { error } = await q.eq('id', id).eq('master_id', s.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    // Se la guardia non ha trovato la riga (0 update) NON e' un errore: la riga era gia' in quello
    // stato o la transizione non era valida. Sotto rileggo e restituisco lo stato VERO: la UI si
    // allinea sempre alla realta', non a un click ottimistico.
  }

  const { data: fresh } = await admin.from('ricariche_check').select('*').eq('id', id).maybeSingle()
  return NextResponse.json({ ok: true, riga: fresh ? arricchisci(fresh) : null })
}
