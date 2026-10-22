import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { confineGiornoRoma, giorniFaRoma, giornoRoma } from '@/lib/date-roma'

// ── RETTIFICHE ELIMINATE: PAGATE DA ME, NON RECUPERATE DA NESSUNO ──
//
// Chiesto da Lorenzo il 22/10/2026: un master puo' caricare le rettifiche e poi, per sbaglio o per
// scelta, eliminarle invece di girarle sotto. Il costo pero' gli e' gia' stato scalato. Qui si vede
// quanto gli e' rimasto addosso, riga per riga:
//  - ricevute da sopra e ASSORBITE (o scartate perche' sotto non c'era niente da recuperare);
//  - ricevute da sopra e CARICATE, ma poi cancellate in Rettifica Costi senza confermarle: la riga
//    madre e' "propagata" e non ha piu' nessuna figlia;
//  - il SUO costo di detentore su spedizioni dove sotto non c'era niente da rettificare (riga
//    intestata a se' stesso, confermata).
// Le ANNULLATE non ci sono: l'addebito e' stato restituito, non e' un costo.
// Solo lettura. Le righe appartengono al master di sopra -> si leggono con la chiave di servizio,
// autorizzazione = target_master_id mio (come in network/ricevuti).
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  // L'agente non vede i costi del master (vedi costo_fornitore nascosto in GET /api/rettifiche).
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio = utente.master_id
  const admin = createAdminSupabase()
  // PERIODO come nelle altre liste: giorni del calendario di Roma (dal/al = 'YYYY-MM-DD'), di serie gli
  // ultimi 90 giorni. La data e' quella della rettifica (quando e' nata la riga).
  const dalG = req.nextUrl.searchParams.get('dal') || giorniFaRoma(90)
  const alG = req.nextUrl.searchParams.get('al') || giornoRoma()
  const dal = confineGiornoRoma(dalG, 'dal')!, al = confineGiornoRoma(alG, 'al')!

  const campi = 'id,master_id,spedizione_id,numero_spedizione,differenza,fuori_sagoma,costo_fornitore,propagazione,created_at,masters:master_id(nome)'
  const leggi = async (filtra: (q: any) => any) => {
    const out: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await filtra(admin.from('rettifiche').select(campi))
        .gte('created_at', dal).lte('created_at', al).order('created_at', { ascending: false }).order('id').range(da, da + 999)
      if (error) throw new Error(error.message)
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return out
  }

  try {
    // Ricevute da sopra, confermate (quindi gia' scalate a me), assorbite o caricate.
    const ricevute = await leggi(q => q.eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true)
      .in('propagazione', ['assorbita', 'propagata']))
    // Delle caricate, quali hanno ancora una figlia (in attesa o confermata): quelle sono girate.
    const caricate = ricevute.filter(r => r.propagazione === 'propagata').map(r => r.id)
    const conFiglia = new Set<string>()
    for (let i = 0; i < caricate.length; i += 300) {
      const { data } = await admin.from('rettifiche').select('origine_rettifica_id').in('origine_rettifica_id', caricate.slice(i, i + 300))
      for (const f of (data || []) as any[]) conFiglia.add(f.origine_rettifica_id)
    }
    // Il mio costo di detentore senza nessuno sotto da rettificare.
    const mie = await leggi(q => q.eq('master_id', mio).eq('target_master_id', mio).eq('confermata', true))

    const arr = (n: number) => Math.round(n * 100) / 100
    const righe: any[] = []
    for (const r of ricevute) {
      if (r.propagazione === 'propagata' && conFiglia.has(r.id)) continue
      // Quanto mi e' stato scalato: ripesatura (differenza, negativa = addebito) + supplementi fissi.
      const pagato = arr(-(Number(r.differenza || 0) - Number(r.fuori_sagoma || 0)))
      if (pagato < 0.005) continue
      righe.push({
        id: r.id, ldv: r.numero_spedizione, quando: r.created_at,
        da: (r as any).masters?.nome || 'livello sopra', importo: pagato,
        motivo: r.propagazione === 'assorbita'
          ? 'Assorbita: non girata sotto (o sotto non c\'era niente da recuperare)'
          : 'Caricata in Rettifica Costi e poi cancellata senza confermarla',
      })
    }
    for (const r of mie) {
      const costo = arr(Number(r.costo_fornitore || 0))
      if (costo < 0.005) continue
      righe.push({
        id: r.id, ldv: r.numero_spedizione, quando: r.created_at,
        da: 'Tuo costo (contratto tuo)', importo: costo,
        motivo: 'Solo a tuo carico: sotto non c\'era niente da rettificare',
      })
    }
    righe.sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
    const perMotivo: Record<string, { n: number; euro: number }> = {}
    for (const r of righe) { const m = perMotivo[r.motivo] || { n: 0, euro: 0 }; m.n++; m.euro = arr(m.euro + r.importo); perMotivo[r.motivo] = m }
    return NextResponse.json({ dal: dalG, al: alG, righe, totale: arr(righe.reduce((t, r) => t + r.importo, 0)), perMotivo })
  } catch (e: any) {
    console.error('[RETTIFICHE] eliminate:', e?.message || e)
    return NextResponse.json({ error: 'Lettura non riuscita' }, { status: 500 })
  }
}
