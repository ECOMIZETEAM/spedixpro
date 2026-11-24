import { codiceServizioSpedisci, marchioCorriere } from '@/lib/corriere-logo'
import { codiceServizioGls, servizioGls } from '@/lib/gls'

// I SERVIZI ACCESSORI (Exchange, Saturday Service) CHIESTI DALL'API PUBBLICA.
// Fino al 24/11/2026 l'API non ne leggeva nessuno: ai contratti GLS rivenduti mandava sempre un elenco vuoto, e chi
// si integrava non aveva modo di chiedere l'Exchange. Caso vero: Pedana click, GLS CASERTA Consegna Diretta, Exchange
// a listino a 4,00 € — dal portale lo sceglie, dall'API no.
// Le regole sono quelle del portale, nessuna nuova:
//  - si offrono solo dove si trasmettono davvero (lib/tariffe-motore → accessori_disponibili): GLS rivenduto, coi
//    codici del fornitore, e GLS diretto nazionale, coi codici GLS. Sui contratti condivisi il portale non li offre;
//  - il servizio deve stare nel listino del cliente per QUEL contratto, e il prezzo lo decide il listino
//    (lib/prezzo-cliente), mai chi chiama;
//  - un servizio a listino a 0 € il portale lo mostra ma alla creazione lo scarta (crea/route: il filtro
//    sull'importo), quindi al corriere non arriva. Qui non si offre: meglio un no esplicito che un 200 senza servizio.

// Il codice con cui il servizio arriva al corriere su questo contratto, o null se qui non si trasmette.
export function codiceServizioContratto(corriere: any, nome: string): string | null {
  if (corriere?.tipo === 'spedisci') return marchioCorriere(corriere?.nome_contratto || '') === 'GLS' ? codiceServizioSpedisci(nome) : null
  // Il GLS Parcel (Europa) i servizi non li accetta: solo FlexDelivery (manuale MU162), come nel portale.
  if (corriere?.tipo === 'gls') return servizioGls(corriere?.settings) === 'P' ? null : codiceServizioGls(nome)
  return null
}

// I servizi chiesti da chi integra: `accessoryServices` (o, come il portale, `serviziAccessori`), come nomi
// ("Exchange") o oggetti ({ name } / { nome }). Il prezzo eventualmente mandato non si legge: lo decide il listino.
export function serviziDelCorpo(body: any): string[] {
  const grezzo = body?.accessoryServices ?? body?.serviziAccessori
  const elenco = Array.isArray(grezzo) ? grezzo : (typeof grezzo === 'string' && grezzo.trim() ? [grezzo] : [])
  const nomi: string[] = []
  for (const s of elenco) {
    const nome = String((typeof s === 'string' ? s : (s?.name ?? s?.nome ?? '')) || '').trim()
    if (nome && !nomi.some(n => n.toLowerCase() === nome.toLowerCase())) nomi.push(nome)
  }
  return nomi
}

export type ServizioDisponibile = { nome: string; prezzo: number; perc: number; codice: string }

// I servizi che il cliente puo' chiedere su questo contratto: a listino, con un prezzo, e trasmessi dal canale.
export async function serviziDisponibili(admin: any, p: { listinoId: string | null | undefined; corriere: any }): Promise<ServizioDisponibile[]> {
  if (!p.listinoId || !p.corriere?.id) return []
  const { data } = await admin.from('listini_clienti_supplementi')
    .select('nome,descrizione,valore').eq('listino_id', p.listinoId)
    .eq('corriere_id', p.corriere.id).eq('tipo', 'accessorio')
  const out: ServizioDisponibile[] = []
  for (const s of (data || [])) {
    let d: any = null; try { d = JSON.parse((s as any).descrizione) } catch { /* descrizione non JSON */ }
    const nome = String((s as any).nome || d?.nome || '').trim()
    if (!nome) continue
    const prezzo = Number(d?.prezzo ?? (s as any).valore ?? 0) || 0
    const perc = Number(d?.perc ?? 0) || 0
    if (prezzo <= 0 && perc <= 0) continue
    const codice = codiceServizioContratto(p.corriere, nome)
    if (!codice || out.some(x => x.codice === codice)) continue
    out.push({ nome, prezzo, perc, codice })
  }
  return out
}

// Da quello che ha scritto chi integra ai servizi del listino. Si riconosce il nome esatto (senza badare a
// maiuscole) e i sinonimi che portano allo stesso servizio ("exchange", "cambio"; "saturday", "sabato").
export async function risolviServiziRichiesti(
  admin: any,
  p: { listinoId: string | null | undefined; corriere: any; richiesti: string[] },
): Promise<{ ok: true; servizi: { nome: string }[] } | { ok: false; errore: string }> {
  if (!p.richiesti.length) return { ok: true, servizi: [] }
  const disponibili = await serviziDisponibili(admin, p)
  if (!disponibili.length) {
    return { ok: false, errore: 'Su questo contratto non è disponibile nessun servizio accessorio (accessoryServices): togli il campo, oppure usa la chiave di un contratto che li prevede (vedi GET /api/v1/account, servizi_accessori).' }
  }
  const elenco = disponibili.map(s => s.nome).join(', ')
  const servizi: { nome: string }[] = []
  for (const r of p.richiesti) {
    const codice = codiceServizioContratto(p.corriere, r)
    const s = disponibili.find(d => d.nome.toLowerCase() === r.toLowerCase()) || (codice ? disponibili.find(d => d.codice === codice) : undefined)
    if (!s) return { ok: false, errore: `Servizio accessorio "${r}" non disponibile su questo contratto (accessoryServices). Disponibili: ${elenco}.` }
    if (!servizi.some(x => x.nome === s.nome)) servizi.push({ nome: s.nome })
  }
  return { ok: true, servizi }
}

// I codici da mandare al corriere per i servizi scelti (gia' risolti sul listino).
export function codiciServiziContratto(corriere: any, servizi: { nome: string }[] | null | undefined): string[] {
  return Array.from(new Set((servizi || []).map(s => codiceServizioContratto(corriere, s.nome)).filter(Boolean))) as string[]
}
