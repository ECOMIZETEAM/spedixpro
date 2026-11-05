import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { confineGiornoRoma, giorniFaRoma, giornoRoma } from '@/lib/date-roma'
import { controlloAttivo, FERMA } from '@/lib/ripesature-controllo'

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
// Per MULTI (2.675 righe in 90 giorni) ora si leggono anche le sue rettifiche verso sotto sugli stessi pacchi: ~9 secondi.
export const maxDuration = 120

const MOTIVO_GIA = 'Già fatta pagare sotto con un\'altra rettifica: qui c\'è solo il costo, non è una perdita'

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
  const leggi = async (filtra: (q: any) => any, extra = '') => {
    const out: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await filtra(admin.from('rettifiche').select(campi + extra))
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
    // Il mio costo di detentore senza nessuno sotto da rettificare. Su queste, che sono righe MIE, anche l'esito del
    // controllo Poste (se l'ho acceso): se Poste le smentisce le ho pagate al fornitore per niente, e si contestano.
    // Sulle ricevute da sopra no: l'esito e' di chi ha caricato il file, e sotto non deve sapere che era sbagliata.
    const conPoste = await controlloAttivo(admin, mio)
    const mie = await leggi(q => q.eq('master_id', mio).eq('target_master_id', mio).eq('confermata', true),
      ',peso_reale,peso_volume_reale,supplementi_nomi' + (conPoste ? ',controllo' : ''))

    // GIA' FATTE PAGARE SOTTO NON SONO SOLDI PERSI (lib/rettifiche-perche). Sulla maggior parte di questi pacchi avevo
    // gia' fatto pagare la ripesatura a qualcuno sotto con un'altra rettifica (dalle misure del portale, da un file di
    // prima): il costo arrivato dopo resta a me perche' sotto non si chiede due volte, ma l'ho gia' incassato. Sulle
    // righe di MULTI del 05/11/2026 erano 2.635 su 2.675. Si dice riga per riga: a chi, quando, quanto.
    const { giaFattePagareSotto, perchePropri } = await import('@/lib/rettifiche-perche')
    const ricevuteNonGirate = ricevute.filter(r => !(r.propagazione === 'propagata' && conFiglia.has(r.id)))
    const giaRicevute = await giaFattePagareSotto(admin, mio, ricevuteNonGirate.map(r => r.spedizione_id))
    const percheMie = await perchePropri(admin, mio, mie)

    const arr = (n: number) => Math.round(n * 100) / 100
    const righe: any[] = []
    for (const r of ricevute) {
      if (r.propagazione === 'propagata' && conFiglia.has(r.id)) continue
      // Quanto mi e' stato scalato: ripesatura (differenza, negativa = addebito) + supplementi fissi.
      const pagato = arr(-(Number(r.differenza || 0) - Number(r.fuori_sagoma || 0)))
      if (pagato < 0.005) continue
      const gia = r.spedizione_id ? giaRicevute.get(r.spedizione_id) : undefined
      righe.push({
        id: r.id, ldv: r.numero_spedizione, quando: r.created_at,
        da: (r as any).masters?.nome || 'livello sopra', importo: pagato,
        recuperata: gia || null,
        motivo: gia ? MOTIVO_GIA
          : r.propagazione === 'assorbita'
            ? 'Assorbita: non girata sotto (o sotto non c\'era niente da recuperare)'
            : 'Caricata in Rettifica Costi e poi cancellata senza confermarla',
      })
    }
    for (const r of mie) {
      const costo = arr(Number(r.costo_fornitore || 0))
      if (costo < 0.005) continue
      const p: any = percheMie.get(r.id)
      righe.push({
        id: r.id, ldv: r.numero_spedizione, quando: r.created_at,
        da: 'Tuo costo (contratto tuo)', importo: costo,
        recuperata: p?.tipo === 'gia_fatta_pagare' ? p.gia : null,
        motivo: p?.tipo === 'gia_fatta_pagare' ? MOTIVO_GIA
          : p?.tipo === 'reso' ? 'Reso: il ritorno si paga col nolo del reso, non con la ripesatura'
          : p?.tipo === 'senza_voce' ? 'Il fornitore ha addebitato un importo senza dire per cosa (né chili né un supplemento conosciuto): il portale non sa a chi girarlo'
          : 'Solo a tuo carico: per chi sta sotto il peso nuovo costa uguale, non c\'era niente da chiedergli',
        ...(conPoste && FERMA.has(r.controllo?.esito) ? { poste: r.controllo.motivo } : {}),
      })
    }
    righe.sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
    const perMotivo: Record<string, { n: number; euro: number }> = {}
    for (const r of righe) { const m = perMotivo[r.motivo] || { n: 0, euro: 0 }; m.n++; m.euro = arr(m.euro + r.importo); perMotivo[r.motivo] = m }
    const perse = righe.filter(r => !r.recuperata), recuperate = righe.filter(r => r.recuperata)
    return NextResponse.json({ dal: dalG, al: alG, righe, totale: arr(righe.reduce((t, r) => t + r.importo, 0)), perMotivo,
      perse: { n: perse.length, euro: arr(perse.reduce((t, r) => t + r.importo, 0)) },
      recuperate: { n: recuperate.length, euro: arr(recuperate.reduce((t, r) => t + r.importo, 0)), incassato: arr(recuperate.reduce((t, r) => t + Number(r.recuperata.euro || 0), 0)) } })
  } catch (e: any) {
    console.error('[RETTIFICHE] eliminate:', e?.message || e)
    return NextResponse.json({ error: 'Lettura non riuscita' }, { status: 500 })
  }
}
