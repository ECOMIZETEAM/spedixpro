import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// I risultati del voto sulla nuova versione: SOLO per il super master (Lorenzo). Per ogni argomento (la nuova versione,
// la Nuova spedizione: app/components/grafica/argomenti.ts) media e quanti per ogni voto; poi i voti uno per uno, coi
// commenti e chi li ha scritti (master, o cliente e il suo master). In più chi ha APERTO la prova (registro
// grafica_visite, Lorenzo 21/11: «controllate chi la visualizza e chi vota»), e se ha votato.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).maybeSingle()
  const { data: m } = utente?.master_id
    ? await supabase.from('masters').select('is_super_master').eq('id', utente.master_id).maybeSingle()
    : { data: null }
  if (!m?.is_super_master) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const admin = createAdminSupabase()
  const { data: voti, error } = await admin.from('grafica_voti')
    .select('id,utente_id,master_id,cliente_id,ruolo,voto,commento,pagina,argomento,creato_il,aggiornato_il')
    .order('aggiornato_il', { ascending: false }).order('id', { ascending: true }).limit(2000)
  if (error) return NextResponse.json({ error: 'Voti non letti' }, { status: 500 })
  const lista = voti || []
  // se il registro delle visite non c'è ancora (scripts/grafica-visite.sql) la pagina mostra solo i voti
  const { data: visiteDb } = await admin.from('grafica_visite')
    .select('utente_id,master_id,cliente_id,ruolo,dispositivo,prima_vista,ultima_vista,pagine_aperte')
    .order('ultima_vista', { ascending: false }).limit(5000)
  const visite = visiteDb || []
  const idMaster = [...new Set([...lista, ...visite].map(v => v.master_id).filter(Boolean))]
  const idClienti = [...new Set([...lista, ...visite].map(v => v.cliente_id).filter(Boolean))]
  const idUtenti = [...new Set([...lista, ...visite].map(v => v.utente_id).filter(Boolean))]
  const [mm, cc, uu] = await Promise.all([
    idMaster.length ? admin.from('masters').select('id,nome').in('id', idMaster) : Promise.resolve({ data: [] as any[] }),
    idClienti.length ? admin.from('clienti').select('id,ragione_sociale').in('id', idClienti) : Promise.resolve({ data: [] as any[] }),
    idUtenti.length ? admin.from('utenti').select('id,nome,cognome').in('id', idUtenti) : Promise.resolve({ data: [] as any[] }),
  ])
  const nomeM = new Map((mm.data || []).map((x: any) => [x.id, x.nome]))
  const nomeC = new Map((cc.data || []).map((x: any) => [x.id, x.ragione_sociale]))
  const nomeU = new Map((uu.data || []).map((x: any) => [x.id, [x.nome, x.cognome].filter(Boolean).join(' ')]))
  const per: Record<string, { totale: number, media: number | null, conti: number[] }> = {}
  for (const v of lista) {
    const a = v.argomento || 'versione'
    if (!per[a]) per[a] = { totale: 0, media: 0, conti: [0, 0, 0, 0, 0] }
    per[a].totale++; per[a].conti[v.voto - 1]++; per[a].media = (per[a].media as number) + v.voto
  }
  for (const a of Object.values(per)) a.media = a.totale ? (a.media as number) / a.totale : null
  const votiDi = new Map<string, string[]>()
  for (const v of lista) votiDi.set(v.utente_id, [...(votiDi.get(v.utente_id) || []), v.argomento || 'versione'])
  return NextResponse.json({
    per,
    visite: visite.map(v => ({
      chi: nomeU.get(v.utente_id) || '—', ruolo: v.ruolo, dispositivo: v.dispositivo,
      master: v.master_id ? nomeM.get(v.master_id) || '—' : null,
      cliente: v.cliente_id ? nomeC.get(v.cliente_id) || '—' : null,
      prima: v.prima_vista, ultima: v.ultima_vista, pagine: v.pagine_aperte, votato: votiDi.get(v.utente_id) || [],
    })),
    voti: lista.map(v => ({
      argomento: v.argomento || 'versione', voto: v.voto, commento: v.commento, pagina: v.pagina, quando: v.aggiornato_il,
      chi: nomeU.get(v.utente_id) || '—', ruolo: v.ruolo,
      master: v.master_id ? nomeM.get(v.master_id) || '—' : null,
      cliente: v.cliente_id ? nomeC.get(v.cliente_id) || '—' : null,
    })),
  })
}
