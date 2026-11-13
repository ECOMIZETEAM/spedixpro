import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { chiAllarme, nomiPerId } from '@/lib/allarmi-sicurezza'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ALLARMI DI SICUREZZA — la pagina dove si scrive l'esito di ogni allarme e si segna la revisione dei
// registri (DPP Amazon 2.6.1: revisione almeno ogni 2 settimane; 2.6.2: ogni allarme esaminato, esito
// scritto). Solo super master: gli allarmi parlano di account e clienti di tutta la piattaforma.
// Tabelle e funzioni: scripts/allarmi-sicurezza.sql e scripts/allarmi-sicurezza-esame.sql.

const GIORNI_REVISIONE = 14

// Stesso controllo del Registro attivita' (/api/audit): il ruolo va guardato INSIEME al master, perche'
// sotto MoovExpress ci sono anche utenti 'cliente' (l'app Shopify ne crea uno per negozio).
async function superMaster(): Promise<{ id: string } | null> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminSupabase()
  const { data: utente } = await admin.from('utenti').select('master_id, ruolo').eq('id', user.id).maybeSingle()
  if (!utente?.master_id || !['master', 'admin'].includes(String(utente.ruolo || '').toLowerCase())) return null
  const { data: m } = await admin.from('masters').select('is_super_master').eq('id', utente.master_id).maybeSingle()
  return m?.is_super_master ? { id: user.id } : null
}

// Il periodo della prossima revisione parte dalla fine dell'ultima (o da 14 giorni fa, la prima volta):
// cosi' nessun giorno resta fuori e nessuno conta due volte.
async function inizioPeriodo(admin: any): Promise<string> {
  const { data } = await admin.from('revisioni_sicurezza').select('al').order('fatta_il', { ascending: false }).limit(1).maybeSingle()
  return data?.al || new Date(Date.now() - GIORNI_REVISIONE * 86400_000).toISOString()
}

export async function GET() {
  const chi = await superMaster()
  if (!chi) return NextResponse.json({ error: 'Sezione riservata al super master' }, { status: 403 })
  const admin = createAdminSupabase()
  const dal = await inizioPeriodo(admin)

  const [all, rev, riep] = await Promise.all([
    admin.from('allarmi_sicurezza').select('*').order('creato_il', { ascending: false }).limit(300),
    admin.from('revisioni_sicurezza').select('*').order('fatta_il', { ascending: false }).limit(12),
    admin.rpc('riepilogo_registri', { p_dal: dal }),
  ])
  if (all.error || rev.error) {
    console.error('[SICUREZZA] lettura non riuscita:', all.error?.message || rev.error?.message)
    return NextResponse.json({ error: 'Allarmi non letti, riprova' }, { status: 500 })
  }
  // Il riepilogo e' un aiuto alla revisione: se non arriva, la pagina funziona lo stesso e lo dice.
  if (riep.error) console.error('[SICUREZZA] riepilogo non letto:', riep.error.message)

  const allarmi = (all.data || []) as any[]
  const revisioni = (rev.data || []) as any[]
  const righe = (riep.data || []) as any[]
  const nomi = await nomiPerId(admin,
    [...allarmi.map(a => a.utente_id), ...allarmi.map(a => a.esaminato_da), ...revisioni.map(r => r.fatta_da),
      ...righe.filter(r => r.voce !== 'api').map(r => r.chi)],
    [...allarmi.map(a => a.cliente_id), ...righe.filter(r => r.voce === 'api').map(r => r.chi)])

  return NextResponse.json({
    periodo: { dal, giorni: GIORNI_REVISIONE },
    allarmi: allarmi.map(a => ({
      id: a.id, tipo: a.tipo, descrizione: a.descrizione, creato_il: a.creato_il, inviato_il: a.inviato_il,
      chi: chiAllarme(a, nomi), esito: a.esito, esaminato_il: a.esaminato_il,
      esaminato_da: a.esaminato_da ? nomi.utente(a.esaminato_da) : null,
    })),
    revisioni: revisioni.map(r => ({ ...r, fatta_da: nomi.utente(r.fatta_da) })),
    riepilogo: riep.error ? null : righe.map(r => ({
      voce: r.voce, n: Number(r.n) || 0,
      chi: r.chi ? (r.voce === 'api' ? nomi.cliente(r.chi) : nomi.utente(r.chi)) : null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const chi = await superMaster()
  if (!chi) return NextResponse.json({ error: 'Sezione riservata al super master' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const admin = createAdminSupabase()

  if (body?.azione === 'esito') {
    const id = Number(body.id)
    const esito = String(body.esito || '').trim()
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Allarme non valido' }, { status: 400 })
    if (esito.length < 3) return NextResponse.json({ error: 'Scrivi cosa hai verificato' }, { status: 400 })
    if (esito.length > 2000) return NextResponse.json({ error: 'Esito troppo lungo (massimo 2000 caratteri)' }, { status: 400 })
    const { data, error } = await admin.from('allarmi_sicurezza')
      .update({ esito, esaminato_il: new Date().toISOString(), esaminato_da: chi.id })
      .eq('id', id).select('id')
    if (error) return NextResponse.json({ error: 'Esito non salvato, riprova' }, { status: 500 })
    if (!data?.length) return NextResponse.json({ error: 'Allarme non trovato' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  if (body?.azione === 'revisione') {
    const note = String(body.note || '').trim()
    if (note.length < 3) return NextResponse.json({ error: 'Scrivi in due parole cosa hai guardato' }, { status: 400 })
    if (note.length > 2000) return NextResponse.json({ error: 'Note troppo lunghe (massimo 2000 caratteri)' }, { status: 400 })
    const dal = await inizioPeriodo(admin)
    const al = new Date().toISOString()
    // La revisione chiude il periodo: gli allarmi del periodo vanno esaminati prima. Lo dice anche la
    // pagina, ma la regola sta qui.
    const [{ count: totali, error: e1 }, { count: aperti, error: e2 }] = await Promise.all([
      admin.from('allarmi_sicurezza').select('id', { count: 'exact', head: true }).gte('creato_il', dal).lte('creato_il', al),
      admin.from('allarmi_sicurezza').select('id', { count: 'exact', head: true }).gte('creato_il', dal).lte('creato_il', al).is('esaminato_il', null),
    ])
    if (e1 || e2) return NextResponse.json({ error: 'Allarmi non letti, riprova' }, { status: 500 })
    if ((aperti || 0) > 0) {
      return NextResponse.json({ error: `Prima scrivi l'esito di ${aperti} ${aperti === 1 ? 'allarme' : 'allarmi'} del periodo` }, { status: 409 })
    }
    const { error } = await admin.from('revisioni_sicurezza').insert({ fatta_da: chi.id, dal, al, allarmi: totali || 0, note })
    if (error) return NextResponse.json({ error: 'Revisione non salvata, riprova' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}
