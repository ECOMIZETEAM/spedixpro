import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const maxDuration = 45

// ── MOOVY VOICE — assistente vocale che AGISCE (Fase 1) ──────────────────
// Letture: eseguite subito. Scritture (ricarica credito / elimina spedizione): NON eseguite qui,
// vengono PROPOSTE con descrizione + id risolti → il frontend chiede conferma (vocale + pulsante),
// poi chiama /api/moovy/esegui. Scoping totale: agente = sola lettura; ognuno vede solo il proprio.

const SYS = `Sei MOOVY, l'assistente vocale di MoovExpress. L'utente ti parla a voce.
- Rispondi in italiano, breve e naturale (verrai letto ad alta voce: niente elenchi lunghi, niente markdown).
- Quando l'utente chiede un'operazione che hai come strumento, chiama lo strumento giusto.
- Per RICARICHE ed ELIMINAZIONI: chiama lo strumento con i dati; NON dire che è fatto — il sistema chiederà conferma all'utente.
- Non rivelare mai guadagni, margini, costi altrui o la struttura della rete. Solo dati dell'utente.
- Se non hai uno strumento per una richiesta, spiega a voce come farlo dall'app.`

const TOOLS = [
  { type: 'function', function: { name: 'leggi_credito', description: 'Legge il credito residuo dell\'utente, oppure di un suo cliente/sotto-master indicato per nome (solo master).', parameters: { type: 'object', properties: { nome: { type: 'string', description: 'nome cliente/sotto-master; vuoto = proprio credito' } } } } },
  { type: 'function', function: { name: 'traccia_spedizione', description: 'Stato/tracking di una spedizione dalla sua lettera di vettura (LDV) o numero.', parameters: { type: 'object', properties: { ldv: { type: 'string' } }, required: ['ldv'] } } },
  { type: 'function', function: { name: 'conta_spedizioni', description: 'Conta le spedizioni dell\'utente in un periodo.', parameters: { type: 'object', properties: { periodo: { type: 'string', enum: ['oggi', 'settimana', 'mese'] } } } } },
  { type: 'function', function: { name: 'ricarica_credito', description: 'Ricarica il credito di un cliente o sotto-master (SOLO master). Va confermata.', parameters: { type: 'object', properties: { nome: { type: 'string' }, importo: { type: 'number' } }, required: ['nome', 'importo'] } } },
  { type: 'function', function: { name: 'elimina_spedizione', description: 'Elimina/annulla una spedizione dalla sua LDV. Va confermata.', parameters: { type: 'object', properties: { ldv: { type: 'string' } }, required: ['ldv'] } } },
]

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: 'Non autenticato' }, 401)
  const { data: u } = await supabase.from('utenti').select('master_id,cliente_id,ruolo,nome,cognome').eq('id', user.id).single()
  const ruolo = (u?.ruolo || '').toLowerCase()
  const isCliente = ruolo === 'cliente' || !!u?.cliente_id
  const isAgente = ruolo === 'agente'
  const isMaster = !isCliente && !isAgente

  const body = await req.json().catch(() => ({} as any))
  const messages: any[] = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-12).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
  if (!messages.length) return json({ error: 'Messaggio mancante' }, 400)

  const GROQ = process.env.GROQ_API_KEY
  if (!GROQ) return json({ reply: 'Moovy non è configurato su questo ambiente.' })

  const admin = createAdminSupabase()

  async function groq(msgs: any[], withTools: boolean) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${GROQ}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', temperature: 0.2, max_tokens: 700,
        messages: [{ role: 'system', content: SYS }, ...msgs], ...(withTools ? { tools: TOOLS, tool_choice: 'auto' } : {}) }),
    })
    if (!r.ok) throw new Error('groq ' + r.status)
    return (await r.json())?.choices?.[0]?.message
  }

  try {
    const msg = await groq(messages, true)
    const call = msg?.tool_calls?.[0]
    if (!call) return json({ reply: msg?.content || 'Come posso aiutarti?' })

    const nome = call.function?.name
    let args: any = {}
    try { args = JSON.parse(call.function?.arguments || '{}') } catch {}

    // ── LETTURE: eseguo e faccio riformulare a Moovy ──
    if (nome === 'leggi_credito') {
      let testo = ''
      if (isMaster && (args.nome || '').trim()) {
        const { data: c } = await admin.from('clienti').select('ragione_sociale,credito').eq('master_id', u!.master_id).ilike('ragione_sociale', `%${args.nome}%`).limit(1).maybeSingle()
        if (c) testo = `Credito di ${c.ragione_sociale}: € ${Number(c.credito || 0).toFixed(2)}.`
        else {
          const { data: m } = await admin.from('masters').select('nome,credito').eq('parent_master_id', u!.master_id).ilike('nome', `%${args.nome}%`).limit(1).maybeSingle()
          testo = m ? `Credito del sotto-master ${m.nome}: € ${Number(m.credito || 0).toFixed(2)}.` : `Non ho trovato "${args.nome}" tra i tuoi clienti o sotto-master.`
        }
      } else if (isCliente) {
        const { data: c } = await admin.from('clienti').select('credito').eq('id', u!.cliente_id).maybeSingle()
        testo = `Il tuo credito residuo è € ${Number(c?.credito || 0).toFixed(2)}.`
      } else {
        const { data: m } = await admin.from('masters').select('credito').eq('id', u!.master_id).maybeSingle()
        testo = `Il tuo credito residuo è € ${Number(m?.credito || 0).toFixed(2)}.`
      }
      return json({ reply: await riformula(groq, messages, call, testo) })
    }

    if (nome === 'conta_spedizioni') {
      const dal = periodoDal(args.periodo || 'oggi')
      let q = admin.from('spedizioni').select('id', { count: 'exact', head: true }).gte('created_at', dal)
      if (isCliente) q = q.eq('cliente_id', u!.cliente_id)
      else { const { sottoAlberoMasterIds } = await import('@/lib/rete-masters'); const sub = await sottoAlberoMasterIds(admin, u!.master_id!); q = q.in('master_id', sub.length ? sub : [u!.master_id]) }
      const { count } = await q
      return json({ reply: await riformula(groq, messages, call, `Spedizioni ${args.periodo || 'oggi'}: ${count || 0}.`) })
    }

    if (nome === 'traccia_spedizione') {
      const ldv = String(args.ldv || '').trim()
      const sped = await trovaSped(admin, ldv, u, isCliente, isAgente, supabase)
      if (!sped) return json({ reply: `Non ho trovato la spedizione ${ldv} tra le tue.` })
      return json({ reply: await riformula(groq, messages, call, `Spedizione ${sped.numero} per ${sped.dest_nome || 'destinatario'}: stato ${statoUmano(sped.stato)}.`) })
    }

    // ── SCRITTURE: NON eseguo, propongo con conferma ──
    if (nome === 'ricarica_credito') {
      if (!isMaster) return json({ reply: 'La ricarica del credito è disponibile solo per i master.' })
      const importo = Math.round((Number(args.importo) || 0) * 100) / 100
      if (!(importo > 0)) return json({ reply: 'Dimmi un importo valido da ricaricare.' })
      const target = await trovaTarget(admin, u!.master_id!, String(args.nome || ''))
      if (!target) return json({ reply: `Non ho trovato "${args.nome}" tra i tuoi clienti o sotto-master.` })
      const desc = `Ricaricare € ${importo.toFixed(2)} a ${target.nome} (${target.tipo === 'cliente' ? 'cliente' : 'sotto-master'})?`
      return json({ reply: `Confermi: ${desc}`, pendingAction: { azione: 'ricarica_credito', targetId: target.id, targetTipo: target.tipo, targetNome: target.nome, importo, descrizione: desc } })
    }

    if (nome === 'elimina_spedizione') {
      if (isAgente) return json({ reply: 'Gli agenti hanno accesso in sola lettura: non posso eliminare spedizioni.' })
      const ldv = String(args.ldv || '').trim()
      const sped = await trovaSped(admin, ldv, u, isCliente, isAgente, supabase)
      if (!sped) return json({ reply: `Non ho trovato la spedizione ${ldv} tra le tue.` })
      const desc = `Eliminare la spedizione ${sped.numero} per ${sped.dest_nome || 'destinatario'}?`
      return json({ reply: `Confermi: ${desc}`, pendingAction: { azione: 'elimina_spedizione', spedizioneId: sped.id, numero: sped.numero, descrizione: desc } })
    }

    return json({ reply: msg?.content || 'Non ho capito la richiesta.' })
  } catch (e: any) {
    return json({ reply: 'Ho avuto un problema tecnico. Riprova tra poco.' })
  }
}

// Riformula il risultato con voce naturale (secondo giro senza tools)
async function riformula(groq: any, messages: any[], call: any, risultato: string) {
  try {
    const m = await groq([...messages, { role: 'assistant', content: '', tool_calls: [call] }, { role: 'tool', tool_call_id: call.id, content: risultato }], false)
    return m?.content || risultato
  } catch { return risultato }
}

async function trovaSped(admin: any, ldv: string, u: any, isCliente: boolean, isAgente: boolean, supabase: any) {
  if (!ldv) return null
  let q = admin.from('spedizioni').select('id,numero,dest_nome,stato,cliente_id,master_id').or(`numero.eq.${ldv},tracking_number.eq.${ldv}`)
  const { data } = await q.limit(1).maybeSingle()
  if (!data) return null
  // scope: cliente = sue; master/agente = rete (agente solo suoi clienti)
  if (isCliente) { if (data.cliente_id !== u.cliente_id) return null; return data }
  const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
  const sub = await sottoAlberoMasterIds(admin, u.master_id)
  if (!sub.includes(data.master_id)) return null
  if (isAgente) { const { clientiAgente } = await import('@/lib/agente'); const miei = await clientiAgente(supabase, u); if (!data.cliente_id || !miei.includes(data.cliente_id)) return null }
  return data
}

async function trovaTarget(admin: any, masterId: string, nome: string): Promise<{ id: string; nome: string; tipo: 'cliente' | 'master' } | null> {
  const n = (nome || '').trim()
  if (!n) return null
  const { data: c } = await admin.from('clienti').select('id,ragione_sociale').eq('master_id', masterId).ilike('ragione_sociale', `%${n}%`).limit(1).maybeSingle()
  if (c) return { id: c.id, nome: c.ragione_sociale, tipo: 'cliente' }
  const { data: m } = await admin.from('masters').select('id,nome').eq('parent_master_id', masterId).ilike('nome', `%${n}%`).limit(1).maybeSingle()
  if (m) return { id: m.id, nome: m.nome, tipo: 'master' }
  return null
}

function periodoDal(p: string) { const d = new Date(); if (p === 'settimana') d.setDate(d.getDate() - 6); else if (p === 'mese') d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString() }
function statoUmano(s: string) { const m: Record<string, string> = { in_lavorazione: 'in lavorazione', spedita: 'spedita', in_transito: 'in transito', in_consegna: 'in consegna', consegnata: 'consegnata', in_giacenza: 'in giacenza', annullata: 'annullata', reso_mittente: 'reso al mittente' }; return m[s] || s }
function json(o: any, status = 200) { return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } }) }
