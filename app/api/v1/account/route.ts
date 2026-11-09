import { NextRequest, NextResponse } from 'next/server'
import { autenticaApiKey, rispostaBlocco } from '@/lib/api-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

// GET /api/v1/account — verifica del collegamento ("test connessione").
// Con API key valida risponde 200 con i dati del contratto; senza, 401.
// Utile alle piattaforme che validano le credenziali con una semplice GET.
export async function GET(req: NextRequest) {
  const ctx = await autenticaApiKey(req)
  if (!ctx) return NextResponse.json({ error: 'API key non valida o mancante' }, { status: 401 })
  const _b = rispostaBlocco(ctx); if (_b) return _b

  const admin = createAdminSupabase()
  const [{ data: cliente }, { data: corriere }] = await Promise.all([
    admin.from('clienti').select('ragione_sociale,credito,listino_cliente_id,master_id').eq('id', ctx.clienteId).single(),
    // credenziali e settings servono solo a capire dove consegna il contratto: non escono di qui.
    admin.from('corrieri').select('nome_contratto,tipo,attivo,master_id,credenziali,settings').eq('id', ctx.corriereId).single(),
  ])

  // Il contratto risulta attivo solo se lo e' anche in tutta la catena sopra: chi si integra via
  // API deve leggere lo stato VERO, non quello del proprio livello.
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const sospesi = await contrattiSospesiSopra((corriere as any)?.master_id)
  const attivoInCatena = corriere?.attivo !== false
    && !sospesoDallaCatena(corriere?.nome_contratto, sospesi)

  return NextResponse.json({
    ok: true,
    account: cliente?.ragione_sociale || null,
    contratto: corriere?.nome_contratto || null,
    contratto_attivo: attivoInCatena,
    listino_attivo: !!cliente?.listino_cliente_id,
    credito: Number(cliente?.credito || 0),
    valuta: 'EUR',
    base_url: 'https://moovexpress.com/api/v1',
    consegna: await consegnaDelContratto(admin, corriere, (cliente as any)?.master_id),
  })
}

// DOVE CONSEGNA IL CONTRATTO, per chi integra: a domicilio o a un punto, e cosa serve per spedire.
// Chi si integra mostra la scelta del punto solo dove vale (richiesta del 09/11/2026). La regola e'
// quella della creazione (lib/punti-consegna), cosi' cio' che dice qui e' cio' che la creazione pretende.
async function consegnaDelContratto(admin: any, corriere: any, masterId: string | null | undefined) {
  if (!corriere) return null
  // Contratto condiviso: il contratto vero sta dal venditore, che lo sa.
  if (corriere.tipo === 'moovexpress') {
    const { risolviChiaveDispatch } = await import('@/lib/condivisione-catena')
    const { consegnaMoovexpress } = await import('@/lib/moovexpress')
    const credMv = masterId ? await risolviChiaveDispatch(admin, masterId, corriere.nome_contratto) : null
    return credMv?.api_key ? await consegnaMoovexpress(credMv as any) : null
  }
  const { modalitaConsegna, eLockerS, LOCKER_S_CM } = await import('@/lib/punti-consegna')
  const m = modalitaConsegna(corriere)
  return {
    tipo: m.aUnPunto ? 'punto' : 'domicilio',
    tipo_punto: m.tipoPunto,
    ricerca_punti: m.aUnPunto ? 'GET /api/v1/delivery-points' : null,
    // Alcuni fornitori cercano i punti solo per CAP: chi ha una mappa deve saperlo prima di cercare.
    ricerca_per_posizione: m.aUnPunto ? !m.courierSp : null,
    deposito_obbligatorio: m.deposito,
    tipi_deposito: m.deposito ? ['ufficio_postale', 'punto_poste'] : [],
    email_destinatario_obbligatoria: m.emailObbligatoria,
    misure_massime_collo_cm: eLockerS(corriere.nome_contratto) ? LOCKER_S_CM : null,
  }
}
