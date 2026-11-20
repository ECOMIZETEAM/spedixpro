import { rifOrdineAffidabile } from '@/lib/rif-ordine'

// Una spedizione che CONTA come partita: non cancellata e non annullata (nemmeno in attesa di
// annullo). Annullare e rifare e' legittimo, quindi un'annullata non fa da doppione. La usa anche
// chi collega a un ordine la spedizione nata da una creazione di cui la pagina non ha avuto risposta
// (app/api/ordini/aggiorna-stato): stessa definizione, o le due cose direbbero "spedito" su casi diversi.
export const spedizioneAttiva = (s: { stato?: string | null; cancellata_il?: string | null }): boolean =>
  !s.cancellata_il && !['annullata', 'annullamento_pending', 'annullamento_manuale'].includes(String(s.stato || ''))

// La regola anti-doppione decide se un ordine e' gia' stato spedito: vale soldi, quindi non puo'
// vivere in UNA porta sola. Stava solo nella creazione dal portale (app/api/spedizioni/crea);
// l'API pubblica /api/v1, gli import e le integrazioni la scavalcavano -> stesso ordine spedito due
// volte, addebitato due volte (verificato: 31 doppioni con firma retry, ~1.950€). Estratta qui
// perche' TUTTE le porte la chiamino, e col backstop a livello DB (indice uniq_sped_ordine_attivo_v2)
// che nessuna rotta puo' aggirare, nemmeno una nuova o una gara simultanea.
//
// Il '#' NON deve contare: lo stesso ordine Shopify arriva "#1019" o "1019" a seconda di come e'
// stato creato, e confrontando alla lettera il doppione passava (guasto vero chiuso nel portale).
// Agisce SOLO sui rif affidabili (rifOrdineAffidabile): su un'etichetta riusata a mano ("AMAZON",
// "EXP 2") bloccherebbe ordini diversi e legittimi. Sempre scoped a UN cliente.
export async function spedizioneDoppioneAttiva(
  admin: { from: (t: string) => any },
  params: { clienteId: string | null | undefined; rifOrdine: string | null | undefined; destCap: string | null | undefined },
): Promise<{ id: string; numero: string; tracking: string | null } | null> {
  const { clienteId, rifOrdine, destCap } = params
  if (!clienteId || !rifOrdineAffidabile(rifOrdine)) return null
  const rif = String(rifOrdine).trim()
  const rifNudo = rif.replace(/^#/, '')
  const cap = String(destCap || '').trim()
  const { data } = await admin.from('spedizioni')
    .select('id,numero,tracking_number,stato,cancellata_il')
    .eq('cliente_id', clienteId)
    .eq('dest_cap', cap)
    .in('rif_ordine', Array.from(new Set([rif, rifNudo, '#' + rifNudo])))
    .limit(5)
  const attiva = (data || []).find(spedizioneAttiva)
  return attiva ? { id: attiva.id, numero: attiva.numero, tracking: attiva.tracking_number || null } : null
}

// Il pacco non ha la spedizione del cliente sopra: tutte le sue righe sono gambe di conti d'ingrosso (ledger).
// Succede quando la creazione attraverso il ponte di condivisione si interrompe a meta' strada: la LDV e' nata
// dal venditore, ma chi l'aveva chiesta non ha fatto in tempo a scrivere la sua riga. Non e' un ordine spedito.
// Letto per tracking_number (indicizzato), mai per numero con LIKE. Su un errore di lettura dice di no:
// resta il messaggio di sempre.
export async function doppioneSenzaTesta(admin: { from: (t: string) => any }, tracking: string | null | undefined): Promise<boolean> {
  if (!tracking) return false
  const { data, error } = await admin.from('spedizioni').select('id,clienti(ledger)').eq('tracking_number', tracking).limit(20)
  if (error || !data?.length) return false
  return data.every((r: any) => (Array.isArray(r.clienti) ? r.clienti[0]?.ledger : r.clienti?.ledger) === true)
}

// Il messaggio 409 e' identico fra le porte: chi integra deve ricevere sempre la stessa risposta.
export function messaggioDoppione(numero: string): string {
  return `Questo ordine risulta già spedito (spedizione ${numero}): non ne è stata creata un'altra per evitare il doppione.`
}

// ORDINE IN CREAZIONE. La guardia qui sopra guarda le spedizioni GIA' scritte: due richieste per lo
// stesso ordine nello stesso secondo (doppio clic, import rilanciato) la passano entrambe, comprano
// entrambe la LDV dal corriere, e solo dopo l'indice uniq_sped_ordine_attivo_v2 scarta la seconda riga.
// Il cliente paga una volta sola, ma la seconda LDV resta pagata al fornitore e non la vede nessuno:
// dal 22/09 al 20/11/2026 sette ordini cosi' (FUTURAL quattro volte in otto minuti il 21/10).
// Qui la prima richiesta prenota l'ordine PRIMA di chiamare il corriere; la seconda trova la
// prenotazione e si ferma senza comprare niente. Stessa chiave della guardia (cliente, rif, CAP), stessi
// rif affidabili. La prenotazione si toglie a fine richiesta; se la funzione muore a meta' scade da sola
// dopo DURATA_PRENOTAZIONE_MS, oltre il tempo massimo delle due porte (120 s).
// Se la tabella non risponde si lascia passare: fermare le spedizioni per un guasto di questo controllo
// sarebbe peggio del doppione, che resta comunque fermato dall'indice e il cui ordine va in storno.
const DURATA_PRENOTAZIONE_MS = 150_000

export const MSG_ORDINE_IN_CORSO = 'Questo ordine è già in spedizione da una richiesta partita pochi secondi fa: attendi un momento e controlla l\'elenco delle spedizioni prima di riprovare.'

export async function prenotaOrdineInCreazione(
  admin: { from: (t: string) => any },
  params: { clienteId: string | null | undefined; rifOrdine: string | null | undefined; destCap: string | null | undefined },
): Promise<'occupato' | { libera: () => Promise<void> } | null> {
  const { clienteId, rifOrdine, destCap } = params
  if (!clienteId || !rifOrdineAffidabile(rifOrdine)) return null
  // Senza '#': "#1019" e "1019" sono lo stesso ordine, come nella guardia.
  const chiave = { cliente_id: clienteId, rif_ordine: String(rifOrdine).trim().replace(/^#/, ''), dest_cap: String(destCap || '').trim() }
  try {
    await admin.from('spedizioni_in_creazione').delete()
      .eq('cliente_id', chiave.cliente_id).eq('rif_ordine', chiave.rif_ordine).eq('dest_cap', chiave.dest_cap)
      .lt('creata_il', new Date(Date.now() - DURATA_PRENOTAZIONE_MS).toISOString())
    const { error } = await admin.from('spedizioni_in_creazione').insert(chiave)
    if (error) {
      if (error.code === '23505') return 'occupato'
      console.error('[DOPPIONE][IN CREAZIONE] prenotazione non scritta, si prosegue', error.message || error.code)
      return null
    }
  } catch (e: any) {
    console.error('[DOPPIONE][IN CREAZIONE] prenotazione non scritta, si prosegue', e?.message || e)
    return null
  }
  return {
    libera: async () => {
      try {
        await admin.from('spedizioni_in_creazione').delete()
          .eq('cliente_id', chiave.cliente_id).eq('rif_ordine', chiave.rif_ordine).eq('dest_cap', chiave.dest_cap)
      } catch { /* scade da sola */ }
    },
  }
}
