import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { fetchAll } from '@/lib/fetch-all'
import { leggiPercentuale } from '@/lib/aumento-listini'
import { accessoAumenti, eUuid, listiniDaPropagare } from '@/lib/aumento-listini-accesso'

// AUMENTA PREZZI — un contratto, piu' listini cliente, una percentuale (richiesta di Lorenzo, 30/10/2026).
// Esempio: Ecomize LL alza SDA EXPRESS L del 5% su tutti i listini dei suoi clienti.
// GET: i contratti del master che stanno in almeno un suo listino, e lo storico degli aumenti.
// POST: applica. Il calcolo e la scrittura li fa il database in una transazione sola
// (`applica_aumento_listino`), che registra ogni riga col prezzo prima e dopo per poterla annullare.

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET() {
  const acc = await accessoAumenti(); if (acc instanceof NextResponse) return acc
  const admin = createAdminSupabase()
  const { masterId } = acc

  const { data: contratti } = await admin.from('corrieri').select('id,nome_contratto,codice,attivo').eq('master_id', masterId)
  const listini = await fetchAll<any>(() => admin.from('listini_clienti').select('id').eq('master_id', masterId).order('id'))
  const mieiListini = new Set(listini.map((l: any) => l.id))
  const ids = (contratti || []).map((c: any) => c.id)
  // Ogni contratto con prezzi in un listino ha la sua riga di aggancio (verificato il 30/10: 8.514 su 8.514):
  // da li' si conta in quanti listini sta, senza leggere tutte le fasce.
  // A gruppi di 40: un IN con centinaia di id allunga l'indirizzo della richiesta oltre il limite e
  // PostgREST risponde errore, che fetchAll trasforma in "nessuna riga" senza dirlo.
  const agganci: any[] = []
  for (let i = 0; i < ids.length; i += 40) {
    const gruppo = ids.slice(i, i + 40)
    agganci.push(...await fetchAll<any>(() => admin.from('listini_clienti_corrieri').select('id,listino_id,corriere_id').in('corriere_id', gruppo).order('corriere_id').order('id')))
  }
  const quanti = new Map<string, Set<string>>()
  for (const a of agganci) {
    if (!mieiListini.has(a.listino_id)) continue
    if (!quanti.has(a.corriere_id)) quanti.set(a.corriere_id, new Set())
    quanti.get(a.corriere_id)!.add(a.listino_id)
  }
  const elenco = (contratti || [])
    .map((c: any) => ({ id: c.id, nome: c.nome_contratto, codice: c.codice, attivo: c.attivo !== false, listini: quanti.get(c.id)?.size || 0 }))
    .filter((c: any) => c.listini > 0)
    .sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'it'))

  const { data: storico } = await admin.from('aumenti_listino')
    .select('id,corriere_id,nome_contratto,codice_contratto,percentuale,listini,fasce,creato_da,creato_il,annullato_il,annullato_da,fasce_ripristinate,fasce_lasciate')
    .eq('master_id', masterId).order('creato_il', { ascending: false }).limit(50)
  const persone = [...new Set((storico || []).flatMap((a: any) => [a.creato_da, a.annullato_da]).filter(Boolean))]
  const { data: utenti } = persone.length ? await admin.from('utenti').select('id,nome,cognome').in('id', persone) : { data: [] }
  const nomeDi = new Map((utenti || []).map((u: any) => [u.id, `${u.nome || ''} ${u.cognome || ''}`.trim()]))

  return NextResponse.json({
    contratti: elenco,
    storico: (storico || []).map((a: any) => ({
      ...a,
      percentuale: Number(a.percentuale),
      creato_da: nomeDi.get(a.creato_da) || null,
      annullato_da: nomeDi.get(a.annullato_da) || null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const acc = await accessoAumenti(); if (acc instanceof NextResponse) return acc
  const admin = createAdminSupabase()
  const body = await req.json().catch(() => ({} as any))
  const perc = leggiPercentuale(body?.percentuale)
  if (perc == null) return NextResponse.json({ error: 'Scrivi un aumento maggiore di zero e al massimo del 100%.' }, { status: 400 })
  if (!eUuid(body?.corriere_id)) return NextResponse.json({ error: 'Scegli il contratto' }, { status: 400 })
  if (!eUuid(body?.richiesta_id)) return NextResponse.json({ error: 'Richiesta non valida, ricarica la pagina' }, { status: 400 })
  const listini = [...new Set<string>((Array.isArray(body?.listini) ? body.listini : []).filter(eUuid))]
  if (!listini.length) return NextResponse.json({ error: 'Scegli almeno un listino' }, { status: 400 })

  const { data, error } = await admin.rpc('applica_aumento_listino', {
    p_master: acc.masterId, p_corriere: body.corriere_id, p_listini: listini,
    p_perc: perc, p_utente: acc.utenteId, p_richiesta: body.richiesta_id,
  })
  if (error) {
    // Lo stesso clic arrivato due volte: il primo ha gia' aumentato, il secondo non fa niente.
    if (error.code === '23505') return NextResponse.json({ error: 'Questo aumento è già stato applicato.' }, { status: 409 })
    const stato = error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500
    if (stato === 500) console.error('[AUMENTI] applica', error)
    return NextResponse.json({ error: stato === 500 ? 'Aumento non riuscito: nessun prezzo è stato cambiato.' : error.message }, { status: stato })
  }

  // Sotto-master e master collegati che comprano da questi listini: le loro copie si riallineano dopo
  // la risposta (su reti profonde ci vuole del tempo), come al salvataggio dall'editor.
  const daPropagare = await listiniDaPropagare(admin, acc.masterId, listini)
  if (daPropagare.length) {
    after(async () => {
      const { propagaListinoModificato } = await import('@/lib/listino-modificato')
      for (const id of daPropagare) await propagaListinoModificato(createAdminSupabase(), id)
    })
  }
  return NextResponse.json({ ok: true, ...(data as any), propagazione: daPropagare.length })
}
