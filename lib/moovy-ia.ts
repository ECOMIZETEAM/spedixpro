import Anthropic from '@anthropic-ai/sdk'

// ── MOOVY — il modello che risponde ─────────────────────────────────────
// Dal 24/11/2026 Moovy risponde con Claude (Anthropic) invece che con Groq: scelta di Lorenzo, per
// la qualita' delle risposte e perche' le regole di riservatezza (margini, rete, fornitori) devono
// reggere anche quando l'utente prova a farsele aggirare. Lo usano la chat (/api/moovy) e la voce
// (/api/moovy/voice): un posto solo per chiave, modello e parametri.
//
// LA CHIAVE HA UN NOME SUO, non ANTHROPIC_API_KEY: quel nome accende da solo la lettura della visura
// camerale con l'IA (app/api/clienti/estrai-visura), che oggi va con le regole locali e manderebbe
// fuori anche il nome del legale rappresentante. Accenderla e' un'altra decisione.
//
// MODELLO via MOOVY_MODEL, cosi' una dismissione si cambia senza rilascio (con Groq era successo:
// llama-3.3-70b-versatile tolto il 16/08/2026, e Moovy rispondeva solo "problema tecnico").
// Se il modello principale rifiuta una richiesta per le sue regole di sicurezza, il server di
// Anthropic la rifa' col modello di riserva nella stessa chiamata (fallbacks).
export const MODELLO_MOOVY = process.env.MOOVY_MODEL || 'claude-opus-5-5'
const MODELLO_RISERVA = 'claude-opus-4-8'

export function clientMoovy(): Anthropic | null {
  const apiKey = process.env.MOOVY_ANTHROPIC_API_KEY
  if (!apiKey) return null
  // Un tentativo in piu' sui 429/5xx; 20 secondi a chiamata: la voce ne fa due e la rotta ha 60 secondi.
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 })
}

// Parametri comuni. Sforzo "low": Moovy guida nell'uso del portale, non deve ragionare a lungo, e chi
// scrive aspetta la risposta. Niente temperature: questi modelli la rifiutano.
export const PARAMETRI_MOOVY = {
  model: MODELLO_MOOVY,
  betas: ['server-side-fallback-2026-06-01'],
  fallbacks: [{ model: MODELLO_RISERVA }],
  output_config: { effort: 'low' as const },
}

// Testo della risposta (i blocchi di ragionamento e di cambio modello si saltano).
export function testoRisposta(m: { content: Array<{ type: string; text?: string }> }): string {
  return m.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim()
}

// L'errore nel log con stato e motivo: un guasto del fornitore non deve diventare un "problema
// tecnico" muto, come succedeva con Groq prima che si loggasse.
export function logErroreMoovy(dove: string, e: unknown) {
  if (e instanceof Anthropic.APIError) console.error(`[MOOVY]${dove} Anthropic HTTP`, e.status, MODELLO_MOOVY, String(e.message).slice(0, 300))
  else console.error(`[MOOVY]${dove} chiamata fallita:`, (e as any)?.message || e)
}

export const RIFIUTO_MOOVY = 'Su questo non posso aiutarti. Se ti serve una mano con il portale, chiedimi pure, oppure apri un Ticket dalla sezione Assistenza.'
