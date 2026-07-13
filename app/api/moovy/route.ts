import { createServerSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

// ── MOOVY — assistente AI di MoovExpress ────────────────────────────────
// Risponde alle domande e guida l'utente passo passo. Legge SOLO il contesto
// del proprio utente (ruolo, credito, KPI) per risposte personalizzate: non
// modifica dati e non vede quelli di altri utenti (query scoped alla sessione).

type Msg = { role: 'user' | 'assistant'; content: string }

const REGOLE = `Sei MOOVY, l'assistente virtuale di MoovExpress, una piattaforma di spedizioni.
Il tuo scopo: rispondere alle domande e guidare l'utente passo passo nell'uso dell'app.

REGOLE (rispettale sempre):
- Rispondi SEMPRE in italiano, con tono cordiale, chiaro e conciso.
- Per le procedure usa elenchi numerati brevi ("1. ...", "2. ...") con il nome esatto delle sezioni/pulsanti.
- Basati solo sulle informazioni qui fornite e sul contesto dell'utente. Se non sai qualcosa o serve un intervento umano, dillo e invita ad aprire un Ticket dalla sezione Assistenza.
- Non inventare funzioni che non esistono. Non dare consulenza legale/fiscale.
- Non rivelare mai dettagli tecnici interni, nomi di sistemi/fornitori tecnici, chiavi o segreti. Parla solo dei nomi commerciali dei corrieri che l'utente già vede nell'app.
- Non mostrare né dedurre dati di altri utenti. Usa solo il contesto dell'utente corrente.
- Mantieni le risposte brevi: vai al punto, offri di approfondire se serve.`

// Mappa funzionale del portale MASTER (chi gestisce clienti, listini, corrieri).
const GUIDA_MASTER = `SEI NEL PORTALE MASTER (gestore). Sezioni principali e cosa fanno:
- Dashboard: statistiche di tutta la rete (spedizioni proprie + dei sotto-clienti/master), fatturato, margine, tasso di consegna, top corriere/cliente.
- Spedizioni → Nuova Spedizione: crea una spedizione (mittente, destinatario, colli/misure, scelta corriere e prezzo). Elenco Spedizioni: cerca/filtra, scarica etichette (PDF), dettaglio (👁), elimina. Giacenze, Rettifica Costi, Spedizioni Cancellate (ripristinabili entro 48h).
- Contrassegni: lista contrassegni da rimettere e Distinte Contrassegni.
- Ritiri: Nuovo Ritiro, Elenco Ritiri (di tutta la rete).
- Distinte: Crea Distinta e Elenco Distinte.
- Resi: Scansiona Resi, Elenco Distinte Resi.
- Assistenza Clienti: Ticket, POD. Tracking Interno.
- Listini Prezzi: Listini Clienti, Nuovo Listino, Listino Corrieri, si può duplicare un listino e applicare una maggiorazione %. Gestione Zone (aree/CAP per corriere).
- Clienti: Nuovo/Elenco Cliente, Nuovo/Elenco Master, Gerarchia della rete. Autisti e Consegne. Consumabili.
- Movimenti/credito: ogni addebito/accredito è tracciato; il credito è a scalare (se non copre il costo, la spedizione è bloccata).
- Impostazioni: filiale, logo, staff, notifiche.
CONCETTI CHIAVE: la rete è ad albero (master → sotto-master → clienti); i prezzi si propagano a cascata lungo la catena; staccando un corriere a un cliente/sotto-master, sparisce dal suo listino e non può più usarlo.`

// Mappa funzionale del portale CLIENTE (chi spedisce).
const GUIDA_CLIENTE = `SEI NEL PORTALE CLIENTE. Sezioni principali e cosa fanno:
- Spedizioni → Nuova Spedizione: inserisci mittente, destinatario, colli e misure, poi scegli corriere e tariffa e conferma. Elenco Spedizioni: cerca (per lettera di vettura, destinatario o mittente), filtra, scarica l'etichetta in PDF, apri il dettaglio (👁). Crea Distinta / Lista Distinte. Giacenze. Contrassegni. Spedizioni Cancellate (ripristinabili entro 48h col pulsante Ripristina).
- Importa Ordini: da file CSV/XLSX (auto-riconosce gli export di Shopify e marketplace) e Negozi collegati (Shopify/WooCommerce/PrestaShop): gli ordini arrivano e poi li trasformi in spedizioni.
- Ritiri: Nuovo Ritiro, Elenco Ritiri.
- Resi, Fatture.
- Assistenza: apri un Ticket, consulta i POD (prova di consegna).
- Reports: Spedizioni, Distinte, Contrassegni, Consumabili, Rettifiche.
- Mio Account: Listino Prezzi (le tue tariffe), Lista Movimenti (credito e addebiti).
- Impostazioni: Pacchi (misure preimpostate), Stampa e Notifiche, Cambia Password, API Key (per integrazioni), Logo.
CONCETTI CHIAVE: il credito è a scalare — se il credito non copre il costo della spedizione, questa viene bloccata; ricarica o contatta il tuo referente. Il contrassegno (COD) incassato ti viene poi rimesso.`

function systemPrompt(ruolo: 'master' | 'cliente', contesto: string) {
  const guida = ruolo === 'master' ? GUIDA_MASTER : GUIDA_CLIENTE
  return `${REGOLE}\n\n${guida}\n\nCONTESTO DELL'UTENTE CORRENTE (usalo per personalizzare, non ripeterlo a pappagallo):\n${contesto}`
}

export async function POST(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Non autenticato', { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const raw: any[] = Array.isArray(body?.messages) ? body.messages : []
  const messages: Msg[] = raw
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return new Response('Messaggio mancante', { status: 400 })
  }

  // Ruolo + contesto (best-effort: non deve mai far fallire la chat)
  const { data: utente } = await supabase
    .from('utenti')
    .select('master_id,cliente_id,masters(nome)')
    .eq('id', user.id)
    .single()

  let ruolo: 'master' | 'cliente' = 'cliente'
  let contesto = ''
  try {
    if (utente?.cliente_id) {
      ruolo = 'cliente'
      const { data: cli } = await supabase.from('clienti').select('ragione_sociale,credito').eq('id', utente.cliente_id).single()
      let kpi: any = null
      try { const { data } = await supabase.rpc('dashboard_kpi_cliente'); kpi = data } catch {}
      const k = kpi || {}
      contesto = [
        `Nome cliente: ${cli?.ragione_sociale || 'n/d'}`,
        `Credito residuo: € ${Number(cli?.credito || 0).toFixed(2)}`,
        `Spedizioni totali: ${k.spedizioniTotali ?? 'n/d'}; consegnate questo mese: ${k.consegnateMese ?? 'n/d'}; in transito: ${k.inTransito ?? 'n/d'}; in giacenza: ${k.inGiacenza ?? 'n/d'}`,
        `Contrassegni da incassare: € ${Number(k.codDaIncassare || 0).toFixed(2)}`,
      ].join('\n')
    } else if (utente?.master_id) {
      ruolo = 'master'
      const nome = (utente as any)?.masters?.nome || 'n/d'
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const admin = createAdminSupabase()
      let kpi: any = null
      try { const { data } = await admin.rpc('dashboard_kpi_master', { p_master: utente.master_id }); kpi = data } catch {}
      const k = kpi || {}
      contesto = [
        `Nome master: ${nome}`,
        `Clienti in rete: ${k.clientiTotali ?? 'n/d'}; sotto-master: ${k.sottomaster ?? 'n/d'}`,
        `Spedizioni totali rete: ${k.spedizioniTotali ?? 'n/d'}; consegnate questo mese: ${k.consegnateMese ?? 'n/d'}; in transito: ${k.inTransito ?? 'n/d'}; in giacenza: ${k.inGiacenza ?? 'n/d'}`,
        `Fatturato mese: € ${Number(k.fatturatoMese || 0).toFixed(2)}; contrassegni da rimettere: € ${Number(k.codDaRimettere || 0).toFixed(2)}`,
        k.topCorriere ? `Corriere più usato: ${k.topCorriere}` : '',
      ].filter(Boolean).join('\n')
    }
  } catch { /* contesto opzionale */ }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response('MOOVY non è configurato su questo ambiente.', { status: 503 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const client = new Anthropic()
        const s = client.messages.stream({
          model: 'claude-sonnet-5',
          max_tokens: 1024,
          system: systemPrompt(ruolo, contesto),
          messages,
        })
        s.on('text', (t: string) => { try { controller.enqueue(encoder.encode(t)) } catch {} })
        await s.finalMessage()
      } catch {
        try { controller.enqueue(encoder.encode('\n\nMi dispiace, ho avuto un problema tecnico. Riprova tra poco o apri un Ticket dalla sezione Assistenza.')) } catch {}
      } finally {
        try { controller.close() } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
