import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente } from '@/lib/agente'
import { fetchAllStretto } from '@/lib/fetch-all'
import { vedeLaRete } from '@/lib/ruoli'
import { eDiscendente } from '@/lib/rete-masters'
import { senzaNomiFornitori } from '@/lib/corriere-logo'
import { confineGiornoRoma } from '@/lib/date-roma'

export const dynamic = 'force-dynamic'

// STORICO RICARICHE / ACCREDITI: i movimenti a CREDITO (importo > 0) di un cliente oppure di TUTTI i
// clienti del master, nel periodo scelto, di un TIPO scelto (predefinito: le sole ricariche).
// Prima il totale mescolava tutto: per MULTI 1-14/10/2026 il "Totale accreditato" era 17.331,68 € e le
// ricariche vere 15.887,86 — il resto erano rimborsi di annullo, rimesse contrassegni e rettifiche a
// favore. Una pagina che si chiama "Storico Ricariche" deve dare per prima la cifra delle ricariche;
// gli altri accrediti restano, scegliendoli, e "Tutti gli accrediti" li somma tipo per tipo.
const ETICHETTA: Record<string, string> = {
  ricarica: 'Ricarica credito',
  rimborso: 'Rimborso/storno',
  rettifica: 'Rettifica a favore',
  contrassegno: 'Rimessa contrassegni',
  consumabile: 'Consumabile a favore',
  reso: 'Reso a favore',
  giacenza: 'Giacenza a favore',
  abbonamento_incasso: 'Incasso abbonamento',
  rimborso_abbonamento: 'Rimborso abbonamento',
}
// Valore della tendina "Tipo" → tipi di movimento. 'tutti' = nessun filtro sul tipo.
const TIPI_FILTRO: Record<string, string[] | null> = {
  ricarica: ['ricarica'],
  rimborso: ['rimborso', 'rimborso_abbonamento'],
  contrassegno: ['contrassegno'],
  rettifica: ['rettifica'],
  tutti: null,
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const masterId = utente?.master_id
  // Prima bastava "non essere cliente", e passava anche l'autista. Lo storico dei crediti e' del
  // portale del master (master, admin, operatore) e dell'agente, che pero' vede solo i suoi clienti.
  if (!masterId || !vedeLaRete(utente)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const p = req.nextUrl.searchParams
  const clienteIdRaw = p.get('clienteId')                       // vuoto = TUTTI i clienti
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : (clienteIdRaw || null)
  // Giorni di Roma. Prima `dal` partiva dalla mezzanotte UTC e `al` finiva a ${al}T23:59:59.999Z: ogni
  // giorno cominciava e finiva una o due ore dopo quello italiano.
  const dal = confineGiornoRoma(p.get('dal'), 'dal')
  const al = confineGiornoRoma(p.get('al'), 'al')
  const filtroTipo = Object.prototype.hasOwnProperty.call(TIPI_FILTRO, p.get('tipo') || '') ? (p.get('tipo') as string) : 'ricarica'
  const tipi = TIPI_FILTRO[filtroTipo]

  const { data: master } = await supabase.from('masters')
    .select('nome,logo_url,indirizzo,cap,citta,provincia,email,email_sede,piva,partita_iva')
    .eq('id', masterId).single()

  const admin = createAdminSupabase()
  // Un errore di lettura non deve diventare "nessun accredito": prima fetchAll chiudeva l'elenco in
  // silenzio alla prima pagina non letta, e la pagina diceva "Nessun risultato".
  try {
    // Perimetro: i MIEI clienti (l'agente vede solo i suoi). Il filtro sta sempre sui clienti del
    // master, cosi' nessuno puo' leggere accrediti altrui passando un id a mano.
    const mieiClienti = await fetchAllStretto<any>(() => admin.from('clienti')
      .select('id,ragione_sociale').eq('master_id', masterId).order('id', { ascending: true }))
    let ammessi = mieiClienti
    if (isAgente(utente)) {
      const miei = await clientiAgente(supabase, utente)
      ammessi = ammessi.filter((c) => miei.includes(c.id))
    }
    const nomePerCliente = new Map(ammessi.map((c: any) => [c.id, c.ragione_sociale]))

    const righe: any[] = []
    let intestazione = 'Tutti i clienti'

    if (masterSel) {
      // Sotto-master agganciato: accrediti sul SUO credito, fatti da me.
      if (isAgente(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
      // Il sotto-master deve stare SOTTO di me. Prima si controllava solo che esistesse: con l'id di un
      // master qualunque, anche di un'altra rete, si leggevano accrediti e saldo suoi (la lettura e' con
      // la chiave di servizio, quindi la RLS non faceva da rete). Stesso controllo di Consumabili.
      const { data: sub } = await admin.from('masters').select('id,nome,parent_master_id').eq('id', masterSel).maybeSingle()
      if (!sub || !(await eDiscendente(admin, masterSel, masterId))) return NextResponse.json({ error: 'Il sotto-master non e\' della tua rete' }, { status: 403 })
      intestazione = sub.nome || 'Sotto-master'
      // Solo il conto RETE, cioe' il credito che il sotto-master tiene presso la mia rete. Sul conto
      // 'proprio' stanno i rimborsi dei SUOI contratti, che col mio storico non c'entrano.
      const mv = await fetchAllStretto(() => {
        let q = admin.from('movimenti').select('created_at,tipo,descrizione,riferimento,importo,saldo_dopo')
          .eq('master_target_id', masterSel).gt('importo', 0).or('conto.is.null,conto.neq.proprio')
        if (tipi) q = q.in('tipo', tipi)
        if (dal) q = q.gte('created_at', dal)
        if (al) q = q.lte('created_at', al)
        return q.order('created_at', { ascending: false }).order('id', { ascending: true })
      })
      for (const m of mv) righe.push({ ...(m as any), cliente: sub.nome })
    } else {
      const ids = clienteId ? [clienteId] : ammessi.map((c: any) => c.id)
      if (clienteId && !nomePerCliente.has(clienteId)) {
        return NextResponse.json({ error: 'Il cliente non e\' tuo' }, { status: 403 })
      }
      if (clienteId) intestazione = nomePerCliente.get(clienteId) || 'Cliente'
      // A blocchi: la lista clienti puo' essere lunga e l'URL ha un limite.
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        if (!chunk.length) continue
        const mv = await fetchAllStretto(() => {
          let q = admin.from('movimenti').select('created_at,tipo,descrizione,riferimento,importo,saldo_dopo,cliente_id')
            .in('cliente_id', chunk).gt('importo', 0)
          if (tipi) q = q.in('tipo', tipi)
          if (dal) q = q.gte('created_at', dal)
          if (al) q = q.lte('created_at', al)
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
    // Totale per tipo: con "Tutti gli accrediti" il file dice quanto e' ricarica e quanto no.
    const perTipo = new Map<string, { tipo: string; n: number; importo: number }>()
    for (const r of out) {
      const t = perTipo.get(r.tipo) || { tipo: r.tipo, n: 0, importo: 0 }
      t.n++; t.importo += r.importo
      perTipo.set(r.tipo, t)
    }
    const totali = Array.from(perTipo.values())
      .map((t) => ({ ...t, importo: Math.round(t.importo * 100) / 100 }))
      .sort((a, b) => b.importo - a.importo)

    return NextResponse.json({
      righe: out, totale, totali, filtroTipo, master: master || {},
      cliente: { ragione_sociale: intestazione },
      tuttiClienti: !clienteId && !masterSel,
    })
  } catch (e: any) {
    console.error('[STORICO RICARICHE]', e?.message || e)
    return NextResponse.json({ error: 'Lettura degli accrediti non riuscita: ' + (e?.message || 'errore') }, { status: 500 })
  }
}
