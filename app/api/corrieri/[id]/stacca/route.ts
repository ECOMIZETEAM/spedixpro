import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { eTitolareOAdmin } from '@/lib/ruoli'
import { fetchAllStretto } from '@/lib/fetch-all'

// STACCA UN CONTRATTO (26/11/2026).
//
// Un master compra ogni contratto da UN fornitore. Se ne trova uno migliore, si stacca da quello di prima e
// ricompra lo stesso contratto altrove (Lorenzo, 25-26/11: "lo deve fare lui", il primo è Atlantik col GLS).
// Staccare non cancella niente: la riga resta per i pacchi già partiti, che continuano a ricevere tracking,
// resi, rettifiche, giacenze e contrassegni lungo la catena di allora, e il fornitore di prima continua ad
// addebitarli. Da quel momento però il contratto non si vende e non si spedisce più, e non si riaccende.
// Le regole stanno nel database (fn_stacca_contratto, scripts/stacca-contratto.sql): questa rotta controlla chi
// chiede, mostra i numeri prima di confermare e chiama quella funzione.
//
// Solo il titolare o un admin, come la revoca di una condivisione: cambia da chi il master compra.

async function contesto(id: string) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !eTitolareOAdmin(utente)) {
    return { errore: NextResponse.json({ error: 'Solo il titolare o un admin può staccare un contratto.' }, { status: 403 }) }
  }
  const admin = createAdminSupabase()
  const { data: corr } = await admin.from('corrieri')
    .select('id,master_id,nome_contratto,proprio,attivo,fornitore_corriere_id,collegamento_id,staccato_il')
    .eq('id', id).maybeSingle()
  if (!corr || corr.master_id !== utente.master_id) {
    return { errore: NextResponse.json({ error: 'Contratto non trovato o non tuo' }, { status: 404 }) }
  }
  return { admin, user, corr }
}

const conta = async (q: any) => {
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count || 0
}

// Quello che si mostra prima di confermare: da chi lo compra, cosa resta in giro, chi lo usa.
async function anteprima(admin: any, corr: any) {
  const id = corr.id as string
  let fornitore: string | null = null
  if (corr.fornitore_corriere_id) {
    const { data: f } = await admin.from('corrieri').select('master_id').eq('id', corr.fornitore_corriere_id).maybeSingle()
    if (f?.master_id) {
      const { data: m } = await admin.from('masters').select('nome').eq('id', f.master_id).maybeSingle()
      fornitore = m?.nome || null
    }
  }
  const giorni = (n: number) => new Date(Date.now() - n * 864e5).toISOString()
  const testa = { count: 'exact' as const, head: true }
  const [spedizioni30, pacchiAperti, aValle, fasce, altri, chiaviApi] = await Promise.all([
    conta(admin.from('spedizioni').select('id', testa).eq('corriere_id', id).gte('created_at', giorni(30))),
    // Pacchi degli ultimi quattro mesi non ancora chiusi: sono quelli su cui arriveranno ancora eventi.
    conta(admin.from('spedizioni').select('id', testa).eq('corriere_id', id).gte('created_at', giorni(120))
      .not('stato', 'in', '(consegnata,annullata,reso_mittente)')),
    admin.from('corrieri').select('master_id').eq('fornitore_corriere_id', id).is('staccato_il', null),
    fetchAllStretto(() => admin.from('listini_clienti_fasce').select('listino_id').eq('corriere_id', id).order('id', { ascending: true })),
    corr.collegamento_id
      ? admin.from('corrieri').select('nome_contratto').eq('collegamento_id', corr.collegamento_id).neq('id', id).is('staccato_il', null)
      : Promise.resolve({ data: [] }),
    // Le chiavi API legate a questo contratto: da subito non creano più spedizioni (tracking ed etichette dei pacchi
    // già fatti continuano, lib/api-auth.ts). Il master deve sapere che qualche integrazione si fermerà.
    conta(admin.from('api_keys').select('id', testa).eq('corriere_id', id).eq('attivo', true)),
  ])
  if ((aValle as any).error) throw new Error((aValle as any).error.message)
  const listini = Array.from(new Set((fasce as any[]).map(f => f.listino_id).filter(Boolean)))
  const clienti = listini.length ? await conta(admin.from('clienti').select('id', testa).in('listino_cliente_id', listini)) : 0
  const mValle = Array.from(new Set(((aValle as any).data || []).map((r: any) => r.master_id)))
  const { data: nomiValle } = mValle.length ? await admin.from('masters').select('nome').in('id', mValle) : { data: [] }

  let motivo: string | null = null
  if (corr.staccato_il) motivo = 'Questo contratto è già staccato.'
  else if (corr.proprio || !corr.fornitore_corriere_id) motivo = 'Questo contratto è tuo: non lo compri da nessuno, quindi non c’è niente da staccare.'
  else if (mValle.length) motivo = 'Lo comprano ancora da te: ' + (nomiValle || []).map((m: any) => m.nome).join(', ') + '. Prima devono staccarsi loro.'

  return {
    nome: corr.nome_contratto, fornitore, viaCodice: !!corr.collegamento_id, staccatoIl: corr.staccato_il,
    spedizioni30, pacchiAperti, listiniClienti: listini.length, clientiSuQueiListini: clienti, chiaviApi,
    restanoDalloStessoFornitore: ((altri as any).data || []).map((r: any) => r.nome_contratto),
    puoStaccare: !motivo, motivo,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await contesto(id)
  if ('errore' in c) return c.errore
  try {
    return NextResponse.json(await anteprima(c.admin, c.corr))
  } catch (e: any) {
    return NextResponse.json({ error: 'Non sono riuscito a leggere i dati del contratto: riprova.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await contesto(id)
  if ('errore' in c) return c.errore
  const body = await req.json().catch(() => ({}))
  if (body?.conferma !== true) return NextResponse.json({ error: 'Conferma mancante' }, { status: 400 })
  const { data, error } = await c.admin.rpc('fn_stacca_contratto', {
    p_corriere_id: id, p_utente: c.user.id, p_attore: c.user.email || null,
  })
  // Il database spiega perché no (contratto tuo, qualcuno lo compra ancora da te): il messaggio è per il master.
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  console.info('[STACCA] contratto staccato', id, c.corr.nome_contratto, 'da', c.user.id)
  return NextResponse.json({ ok: true, ...(data as any) })
}
