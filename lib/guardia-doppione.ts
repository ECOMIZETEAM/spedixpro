import { rifOrdineAffidabile } from '@/lib/rif-ordine'

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
): Promise<{ id: string; numero: string } | null> {
  const { clienteId, rifOrdine, destCap } = params
  if (!clienteId || !rifOrdineAffidabile(rifOrdine)) return null
  const rif = String(rifOrdine).trim()
  const rifNudo = rif.replace(/^#/, '')
  const cap = String(destCap || '').trim()
  const { data } = await admin.from('spedizioni')
    .select('id,numero,stato,cancellata_il')
    .eq('cliente_id', clienteId)
    .eq('dest_cap', cap)
    .in('rif_ordine', Array.from(new Set([rif, rifNudo, '#' + rifNudo])))
    .limit(5)
  const attiva = (data || []).find((s: any) => !s.cancellata_il
    && !['annullata', 'annullamento_pending', 'annullamento_manuale'].includes(String(s.stato || '')))
  return attiva ? { id: attiva.id, numero: attiva.numero } : null
}

// Il messaggio 409 e' identico fra le porte: chi integra deve ricevere sempre la stessa risposta.
export function messaggioDoppione(numero: string): string {
  return `Questo ordine risulta già spedito (spedizione ${numero}): non ne è stata creata un'altra per evitare il doppione.`
}
