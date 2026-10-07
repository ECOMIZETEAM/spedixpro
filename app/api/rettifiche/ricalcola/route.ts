import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'

// RICALCOLA UNA RETTIFICA col listino AGGIORNATO (passo A, pagina Rettifiche "da controllare").
//
// Flusso: una riga risulta "da controllare" perche' il da-girare (riprezzo) copre meno del costo che il
// corriere ci ha addebitato. Il master corregge il listino del cliente e preme Ricalcola: qui si
// ri-riprezza la SINGOLA riga NON confermata con lo STESSO motore dell'upload (calcolaRipesature, cosi'
// DB=visto=pagato: si fa rispettare il prezzo salvato, non si inventa nulla), si riscrivono
// costo_iniziale/costo_finale/differenza, e si torna la nuova classe. Se ora copre, passa tra le buone.
//
// NON si tocca: il costo_fornitore (la fattura e' fissa) ne' il supplemento/penale (fuori_sagoma). Una
// PENALE non si recupera col listino: su quelle righe il Ricalcola e' rifiutato (si gira o si assorbe).
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _b = bloccaAgente(utente as any); if (_b) return _b
  if (!gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id mancante' }, { status: 400 })

  const admin = createAdminSupabase()
  // Solo una riga MIA e ancora NON confermata (dopo la conferma il credito e' gia' sceso, non si tocca).
  const { data: r } = await supabase.from('rettifiche').select('*')
    .eq('id', id).eq('master_id', utente!.master_id).eq('confermata', false).maybeSingle()
  if (!r) return NextResponse.json({ error: 'Rettifica non trovata o gia\' confermata' }, { status: 404 })
  if (String(r.supplementi_nomi || '').toLowerCase().includes('penale')) {
    return NextResponse.json({ error: 'E\' una penale del corriere: non si recupera col listino. Decidi se girarla al cliente o assorbirla.' }, { status: 400 })
  }

  const { data: sp } = await admin.from('spedizioni').select('numero,tracking_number,stato')
    .eq('id', r.spedizione_id).maybeSingle()
  if (!sp) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })
  if (sp.stato === 'annullata') return NextResponse.json({ error: 'Spedizione annullata: non si rettifica' }, { status: 400 })

  const { calcolaRipesature } = await import('@/lib/ripesature-calcolo')
  // I colli ripesati salvati sulla riga; se mancano, un collo unico col peso reale (niente volume).
  const colli = Array.isArray(r.colli_ripesati) && r.colli_ripesati.length
    ? r.colli_ripesati.map((c: any) => ({
        peso: Number(c?.weight ?? c?.peso) || 0,
        lunghezza: Number(c?.length ?? c?.lunghezza) || 0,
        larghezza: Number(c?.width ?? c?.larghezza) || 0,
        altezza: Number(c?.height ?? c?.altezza) || 0,
      }))
    : [{ peso: Number(r.peso_reale) || 0, lunghezza: 0, larghezza: 0, altezza: 0 }]
  const rip: any = {
    idOrdine: r.rif_fornitore || r.id,
    ldv: sp.numero || sp.tracking_number || '',
    colli,
    addebitoFornitore: Number(r.costo_fornitore || 0),
  }
  const esiti = await calcolaRipesature(admin, [rip])
  const e: any = esiti?.[0]
  if (!e || !e.trovata) return NextResponse.json({ error: 'Ricalcolo non riuscito (spedizione non ricostruita)' }, { status: 422 })

  // Il livello di QUESTA riga: il master-figlio target, oppure — se intestata al cliente — il cliente.
  const liv = r.target_master_id
    ? (e.livelli || []).find((l: any) => l.masterId === r.target_master_id)
    : (e.livelli || []).find((l: any) => l.clienteId === r.cliente_id)
  if (!liv || liv.dovuto == null) {
    return NextResponse.json({ error: 'Il listino attuale non prezza questa destinazione: nessun ricalcolo (il contratto non la copre).' }, { status: 422 })
  }

  // SOLO RECUPERI, mai note di credito: differenza = -(dovuto - pagato) se positiva, altrimenti 0.
  const diffRett = Number(liv.differenza) >= 0.01 ? Number(liv.differenza) : 0
  const costoIniziale = Math.round(Number(liv.pagato) * 100) / 100
  const costoFinale = Math.round(Number(liv.dovuto) * 100) / 100
  const { error: errUpd } = await admin.from('rettifiche').update({
    costo_iniziale: costoIniziale,
    costo_finale: costoFinale,
    differenza: -diffRett,
    // costo_fornitore e fuori_sagoma restano com'erano: la fattura del corriere non cambia col listino.
  }).eq('id', r.id).eq('confermata', false)
  if (errUpd) return NextResponse.json({ error: 'Salvataggio non riuscito: ' + errUpd.message }, { status: 500 })

  const daGirare = Math.round((diffRett + Number(r.fuori_sagoma || 0)) * 100) / 100
  const costoForn = Number(r.costo_fornitore || 0)
  const buona = costoForn <= 0.01 || daGirare >= costoForn - 0.01
  return NextResponse.json({
    ok: true,
    classe: buona ? 'buona' : 'da_controllare',
    da_girare: daGirare,
    costo_fornitore: Math.round(costoForn * 100) / 100,
    manca: buona ? 0 : Math.round((costoForn - daGirare) * 100) / 100,
  })
}
