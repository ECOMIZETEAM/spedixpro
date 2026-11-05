import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { controlloAttivo } from '@/lib/ripesature-controllo'

// LE RETTIFICHE GIA' CONFERMATE CHE POSTE SMENTISCE (Lorenzo, 05/11/2026: «vorrei che anche quelle… il master multi
// capisse il perchè… ma non devono capire gli altri che sono sbagliate»). Solo per chi ha il controllo acceso, solo le
// SUE righe (master_id = lui): l'esito del controllo sta sulla riga di chi ha caricato il file, e sotto nessuno lo legge
// — le righe di un master sopra non si vedono (rettifiche_lettura: master_id nella propria rete, che scende e non sale)
// e le pagine dei livelli sotto prendono colonne scelte, mai il controllo. Gli agenti no: dentro ci sono gli importi.
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  if (!(await controlloAttivo(admin, utente.master_id))) return NextResponse.json({ attivo: false, righe: [] })
  // Solo quante sono, per la testata della sezione: le righe si leggono quando la si apre.
  if (req.nextUrl.searchParams.get('conta')) {
    const { count, error } = await admin.from('rettifiche').select('id', { count: 'exact', head: true })
      .eq('master_id', utente.master_id).eq('confermata', true).in('controllo->>esito', ['senza_agevolazione', 'peso_sbagliato'])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ attivo: true, n: count || 0 })
  }

  const righe: any[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await admin.from('rettifiche')
      .select('id,spedizione_id,numero_spedizione,peso_iniziale,target_master_id,cliente_id,differenza,fuori_sagoma,costo_fornitore,created_at,file_id,controllo')
      .eq('master_id', utente.master_id).eq('confermata', true)
      .in('controllo->>esito', ['senza_agevolazione', 'peso_sbagliato'])
      .order('created_at', { ascending: false }).order('id').range(da, da + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    righe.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  // A chi e' stata addebitata: il nome del master o del cliente, e il file da cui e' nata.
  const nomi = new Map<string, string>()
  const idM = [...new Set(righe.map(r => r.target_master_id).filter(Boolean))]
  const idC = [...new Set(righe.map(r => r.cliente_id).filter(Boolean))]
  const idF = [...new Set(righe.map(r => r.file_id).filter(Boolean))]
  for (let i = 0; i < idM.length; i += 200) {
    const { data } = await admin.from('masters').select('id,nome').in('id', idM.slice(i, i + 200))
    for (const m of (data || []) as any[]) nomi.set(m.id, m.nome)
  }
  for (let i = 0; i < idC.length; i += 200) {
    const { data } = await admin.from('clienti').select('id,ragione_sociale').in('id', idC.slice(i, i + 200))
    for (const c of (data || []) as any[]) nomi.set(c.id, c.ragione_sociale)
  }
  for (let i = 0; i < idF.length; i += 200) {
    const { data } = await admin.from('rettifiche_files').select('id,nome_file').in('id', idF.slice(i, i + 200))
    for (const f of (data || []) as any[]) nomi.set(f.id, f.nome_file)
  }
  const mio = utente.master_id
  return NextResponse.json({
    attivo: true,
    righe: righe.map(r => ({
      id: r.id, ldv: r.numero_spedizione, quando: r.created_at, peso_dichiarato: Number(r.peso_iniziale) || 0,
      esito: r.controllo?.esito, motivo: r.controllo?.motivo, peso_file: r.controllo?.peso_file,
      peso_poste: r.controllo?.peso_onetracking, misura: r.controllo?.misura || null,
      // Quanto e' stato fatto pagare sotto con questa riga (ripesatura + supplemento), e a chi. La riga «solo mia»
      // (target = me stesso, come in GET /api/rettifiche) non ha girato niente a nessuno.
      addebitato: r.target_master_id === mio ? 0 : Math.max(0, Math.round((-Number(r.differenza || 0) + Number(r.fuori_sagoma || 0)) * 100) / 100),
      costo_tuo: Math.round(Number(r.costo_fornitore || 0) * 100) / 100,
      a_chi: r.target_master_id === mio ? 'solo a tuo carico'
        : r.target_master_id ? (nomi.get(r.target_master_id) || 'master')
        : r.cliente_id ? (nomi.get(r.cliente_id) || 'cliente') : 'solo a tuo carico',
      file: nomi.get(r.file_id) || '',
    })),
  })
}
