import { createAdminSupabase } from '@/lib/supabase-admin'

export type ApiContext = {
  clienteId: string
  masterId: string
  corriereId: string
  keyId: string
  // Perche' le API sono ferme, se lo sono. Vive qui e non in ogni rotta: il controllo si fa una
  // volta sola, dove la chiave viene gia' letta, e nessuna rotta nuova puo' dimenticarselo.
  blocco?: { motivo: 'pacchetto_esaurito' | 'non_pagato'; usate: number; limite: number; piano: string } | null
}

// Autentica una richiesta API pubblica tramite header Authorization: Bearer <api_key>.
// La chiave è PER CONTRATTO -> risolve cliente + master + corriere (contratto).
export async function autenticaApiKey(req: Request): Promise<ApiContext | null> {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const admin = createAdminSupabase()
  const { data } = await admin
    .from('api_keys')
    .select('id,cliente_id,master_id,corriere_id,attivo')
    .eq('chiave', token)
    .maybeSingle()
  if (!data || data.attivo === false) return null

  // IL CLIENTE DEVE ESSERE ANCORA ATTIVO.
  // Il portale butta fuori a ogni pagina chi viene disattivato (di solito per morosita'), ma qui si
  // guardava solo la riga della chiave: il cliente sospeso continuava a creare spedizioni via API,
  // e la catena master veniva addebitata a ogni pacco mentre il master lo credeva fermo. Per
  // bloccarlo davvero avrebbe dovuto revocare la chiave, che pero' si revoca solo dal portale del
  // CLIENTE. Stessa cosa per il contratto: se il master lo spegne, non deve restare spendibile.
  const [{ data: cli }, { data: cor }] = await Promise.all([
    admin.from('clienti').select('attivo').eq('id', data.cliente_id).maybeSingle(),
    admin.from('corrieri').select('attivo').eq('id', data.corriere_id).maybeSingle(),
  ])
  if (!cli || cli.attivo === false) return null
  if (cor && cor.attivo === false) return null

  // aggiorna last_used_at senza bloccare la risposta
  admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {})

  // Il pacchetto: chi sfora o non paga si ferma QUI, non nel portale. E' la differenza col master,
  // dove a chiudersi e' il pannello: qui le API sono lo strumento che sta usando, e fermare quelle
  // significa fermare lui e nessun altro — i suoi pacchi gia' partiti continuano il loro giro.
  let blocco: ApiContext['blocco'] = null
  try {
    const { data: st } = await admin.rpc('fn_stato_api_cliente', { p_cliente: data.cliente_id })
    const s: any = st || {}
    // I TRE GIORNI PARTONO DA QUI. Il primo momento in cui il pacchetto risulta finito si segna,
    // e da li' si contano. Quando il mese riparte e si torna sotto, il segno si cancella:
    // altrimenti chi ha sforato a luglio se lo porterebbe dietro per sempre.
    if (s?.oltre_limite && !s?.sforato_dal) {
      admin.from('clienti').update({ api_limite_sforato_dal: new Date().toISOString() }).eq('id', data.cliente_id).then(() => {}, () => {})
    } else if (!s?.oltre_limite && s?.sforato_dal) {
      admin.from('clienti').update({ api_limite_sforato_dal: null }).eq('id', data.cliente_id).then(() => {}, () => {})
    }
    if (s?.bloccato) {
      blocco = {
        motivo: s.oltre_limite ? 'pacchetto_esaurito' : 'non_pagato',
        usate: Number(s.usate || 0), limite: Number(s.limite || 0), piano: String(s.nome || s.piano || ''),
      }
    }
  } catch (e: any) {
    // Se il controllo non risponde NON si blocca nessuno: un errore nostro non deve spegnere le
    // spedizioni di chi ha pagato.
    console.error('[API][PIANO] controllo non riuscito:', e?.message)
  }

  return { clienteId: data.cliente_id, masterId: data.master_id, corriereId: data.corriere_id, keyId: data.id, blocco }
}

// La risposta da dare quando le API sono ferme. Dice cosa e' successo e cosa fare: un 402 muto
// manderebbe l'integratore a cercare un errore nel suo codice che non c'e'.
export function rispostaBlocco(ctx: ApiContext | null): Response | null {
  if (!ctx?.blocco) return null
  const b = ctx.blocco
  const messaggio = b.motivo === 'pacchetto_esaurito'
    ? `Pacchetto esaurito: hai usato ${b.usate} delle ${b.limite} spedizioni comprese nel piano ${b.piano}. Passa a un pacchetto piu' grande dal portale, in Impostazioni → Chiavi API.`
    : 'Pagamento non riuscito: le API restano ferme finche\' non viene saldato. Sistemalo dal portale, in Impostazioni → Chiavi API.'
  // NON 402. Quel codice i gestionali lo traducono in "credito insufficiente" — e' successo
  // davvero, e il cliente e' andato a cercare un problema di credito che non esisteva. 429 dice
  // quello che e' davvero: la quota del periodo e' finita.
  return new Response(JSON.stringify({ error: messaggio, codice: b.motivo, usate: b.usate, limite: b.limite }), {
    status: 429, headers: { 'Content-Type': 'application/json' },
  })
}

// Genera una chiave API leggibile e sicura.
export function generaApiKey(): string {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `mvx_live_${hex}`
}
