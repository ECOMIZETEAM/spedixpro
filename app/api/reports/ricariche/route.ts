import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente } from '@/lib/agente'
import { fetchAll } from '@/lib/fetch-all'
import { vedeLaRete } from '@/lib/ruoli'
import { eDiscendente } from '@/lib/rete-masters'
import { senzaNomiFornitori } from '@/lib/corriere-logo'

export const dynamic = 'force-dynamic'

// STORICO RICARICHE / ACCREDITI: tutti i movimenti a CREDITO (importo > 0) di un cliente
// oppure di TUTTI i clienti del master, nel periodo scelto.
// Comprende ricariche, rimborsi, storni, rimesse contrassegni compensate e rettifiche a favore:
// e' il "quanto ho accreditato a chi" che serve per la quadratura con le fatture.
const ETICHETTA: Record<string, string> = {
  ricarica: 'Ricarica credito',
  rimborso: 'Rimborso/storno',
  rettifica: 'Rettifica a favore',
  contrassegno: 'Rimessa contrassegni',
  abbonamento_incasso: 'Incasso abbonamento',
  rimborso_abbonamento: 'Rimborso abbonamento',
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ righe: [], master: {}, cliente: {} })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const masterId = utente?.master_id
  // Prima bastava "non essere cliente", e passava anche l'autista. Lo storico dei crediti e' del
  // portale del master (master, admin, operatore) e dell'agente, che pero' vede solo i suoi clienti.
  if (!masterId || !vedeLaRete(utente)) {
    return NextResponse.json({ righe: [], master: {}, cliente: {} })
  }

  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')                       // vuoto = TUTTI i clienti
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : (clienteIdRaw || null)
  const dal = p.get('dal'); const al = p.get('al')

  const { data: master } = await supabase.from('masters')
    .select('nome,logo_url,indirizzo,cap,citta,provincia,email,email_sede,piva,partita_iva')
    .eq('id', masterId).single()

  const admin = createAdminSupabase()

  // Perimetro: i MIEI clienti (l'agente vede solo i suoi). Il filtro sta sempre sui clienti del
  // master, cosi' nessuno puo' leggere accrediti altrui passando un id a mano.
  const { data: mieiClienti } = await admin.from('clienti')
    .select('id,ragione_sociale').eq('master_id', masterId)
  let ammessi = (mieiClienti || []) as any[]
  if (isAgente(utente)) {
    const miei = await clientiAgente(supabase, utente)
    ammessi = ammessi.filter((c) => miei.includes(c.id))
  }
  const nomePerCliente = new Map(ammessi.map((c: any) => [c.id, c.ragione_sociale]))

  const finePeriodo = al ? `${al}T23:59:59.999Z` : null
  const righe: any[] = []
  let intestazione = 'Tutti i clienti'

  if (masterSel) {
    // Sotto-master agganciato: accrediti sul SUO credito, fatti da me.
    if (isAgente(utente)) return NextResponse.json({ righe: [], master: master || {}, cliente: {} })
    // Il sotto-master deve stare SOTTO di me. Prima si controllava solo che esistesse: con l'id di un
    // master qualunque, anche di un'altra rete, si leggevano accrediti e saldo suoi (la lettura e' con
    // la chiave di servizio, quindi la RLS non faceva da rete). Stesso controllo di Consumabili.
    const { data: sub } = await admin.from('masters').select('id,nome,parent_master_id').eq('id', masterSel).maybeSingle()
    if (!sub || !(await eDiscendente(admin, masterSel, masterId))) return NextResponse.json({ righe: [], master: master || {}, cliente: {} })
    intestazione = sub.nome || 'Sotto-master'
    // Solo il conto RETE, cioe' il credito che il sotto-master tiene presso la mia rete. Sul conto
    // 'proprio' stanno i rimborsi dei SUOI contratti, che col mio storico non c'entrano.
    const mv = await fetchAll(() => {
      let q = admin.from('movimenti').select('created_at,tipo,descrizione,riferimento,importo,saldo_dopo')
        .eq('master_target_id', masterSel).gt('importo', 0).or('conto.is.null,conto.neq.proprio')
      if (dal) q = q.gte('created_at', dal)
      if (finePeriodo) q = q.lte('created_at', finePeriodo)
      return q.order('created_at', { ascending: false }).order('id', { ascending: true })
    })
    for (const m of mv) righe.push({ ...(m as any), cliente: sub.nome })
  } else {
    const ids = clienteId ? [clienteId] : ammessi.map((c: any) => c.id)
    if (clienteId && !nomePerCliente.has(clienteId)) {
      return NextResponse.json({ righe: [], master: master || {}, cliente: {} })   // non e' un mio cliente
    }
    if (clienteId) intestazione = nomePerCliente.get(clienteId) || 'Cliente'
    // A blocchi: la lista clienti puo' essere lunga e l'URL ha un limite.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      if (!chunk.length) continue
      const mv = await fetchAll(() => {
        let q = admin.from('movimenti').select('created_at,tipo,descrizione,riferimento,importo,saldo_dopo,cliente_id')
          .in('cliente_id', chunk).gt('importo', 0)
        if (dal) q = q.gte('created_at', dal)
        if (finePeriodo) q = q.lte('created_at', finePeriodo)
        return q.order('created_at', { ascending: false }).order('id', { ascending: true })
      })
      for (const m of mv) righe.push({ ...(m as any), cliente: nomePerCliente.get((m as any).cliente_id) || '—' })
    }
  }

  righe.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  // Il credito residuo dei clienti lo vede solo lo staff del master: all'agente no, come in Lista
  // Movimenti e in Consumabili. Gli accrediti restano, il saldo dopo ciascuno no.
  const nascondiSaldo = isAgente(utente)
  const out = righe.map((r: any) => ({
    data: r.created_at,
    cliente: r.cliente,
    tipo: ETICHETTA[r.tipo] || r.tipo,
    // All'agente senza i nomi dei fornitori tecnici scritti a mano nelle descrizioni.
    descrizione: nascondiSaldo ? senzaNomiFornitori(r.descrizione) : (r.descrizione || ''),
    riferimento: nascondiSaldo ? senzaNomiFornitori(r.riferimento) : (r.riferimento || ''),
    importo: Number(r.importo) || 0,
    saldo_dopo: nascondiSaldo || r.saldo_dopo == null ? null : Number(r.saldo_dopo),
  }))
  const totale = Math.round(out.reduce((s, r) => s + r.importo, 0) * 100) / 100

  return NextResponse.json({
    righe: out, totale, master: master || {},
    cliente: { ragione_sociale: intestazione },
    tuttiClienti: !clienteId && !masterSel,
  })
}
