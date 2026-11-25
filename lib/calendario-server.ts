// LE VOCI DEL CALENDARIO DI UNA PERSONA, lato server (fase 2, 25/11/2026). Le sue (anche quelle che si ripetono) e
// quelle a cui è invitata. Una sola lettura per i quattro posti che le mostrano — il calendario, la campanella, il giro
// delle email e il link per Google e iPhone — così nessuno dei quattro può far vedere qualcosa che gli altri non vedono.
//
// CHI VEDE COSA, per gli inviti (scelta di Lorenzo, 25/11: si invitano staff, agenti e clienti dello stesso master):
//  - chi è invitato vede titolo, orari, luogo, note e chi l'ha invitato; NON vede gli altri invitati (un cliente non
//    deve conoscere gli altri clienti) e NON vede la spedizione collegata (il nome del destinatario è di chi la gestisce);
//  - chi ha organizzato vede tutti gli invitati e le loro risposte.
// Le tabelle le tocca solo il client di servizio: ogni lettura qui è legata all'utente passato da chi chiama, che
// deve essere quello della sessione.
import { occorrenze, type Ricorrenza } from '@/lib/calendario-ricorrenza'
import { momentoAvviso } from '@/lib/calendario-avviso'
import { giornoRoma, inizioGiornoRomaISO, fineGiornoRomaISO } from '@/lib/date-roma'

export const COLONNE_EVENTO = 'id,utente_id,master_id,tipo,titolo,inizio,fine,tutto_il_giorno,luogo,note,avviso_minuti,collegamento,fatto,creato_il,ricorrenza,eccezioni,fatti'

export type Invitato = { utente_id: string; nome: string; ruolo: string; stato: string }
export type VoceServer = {
  id: string; tipo: string; titolo: string; inizio: string; fine: string | null; tutto_il_giorno: boolean
  luogo: string | null; note: string | null; avviso_minuti: number | null; collegamento: any; fatto: boolean; creato_il: string
  ricorrenza: Ricorrenza | null; occorrenza: string | null; serie_inizio: string; serie_fine: string | null
  ruolo: 'mio' | 'invitato'
  invito?: { stato: string; organizzatore: string }
  invitati?: Invitato[]
}

const nomeDi = (u: any) => {
  const nome = [u?.nome, u?.cognome].filter(Boolean).join(' ').trim()
  const rs = u?.clienti?.ragione_sociale
  return nome && rs && nome.toLowerCase() !== String(rs).toLowerCase() ? `${nome} · ${rs}` : (nome || rs || 'Utente')
}

// una riga del database → le occorrenze nel periodo, nella forma che il calendario disegna
function srotola(e: any, dal: Date, al: Date, ruolo: 'mio' | 'invitato', extra: Partial<VoceServer> = {}): VoceServer[] {
  const occ = occorrenze(e, dal, al, 500)
  return occ.map((o) => ({
    id: e.id, tipo: e.tipo, titolo: e.titolo,
    inizio: o.inizio.toISOString(), fine: o.fine ? o.fine.toISOString() : null, tutto_il_giorno: !!e.tutto_il_giorno,
    luogo: e.luogo ?? null, note: e.note ?? null, avviso_minuti: e.avviso_minuti ?? null,
    // la spedizione collegata è solo di chi ha scritto la voce
    collegamento: ruolo === 'mio' ? (e.collegamento ?? null) : null,
    // un promemoria che si ripete è «fatto» giorno per giorno
    fatto: e.ricorrenza ? (e.fatti || []).includes(o.giorno) : !!e.fatto,
    creato_il: e.creato_il,
    ricorrenza: e.ricorrenza ?? null, occorrenza: e.ricorrenza ? o.giorno : null,
    serie_inizio: e.inizio, serie_fine: e.fine ?? null,
    ruolo, ...extra,
  }))
}

// le righe proprie che possono toccare il periodo: le singole che vi cadono e le serie cominciate prima della fine
async function righeMie(admin: any, utenteId: string, dal: Date, al: Date): Promise<any[]> {
  const [singole, serie] = await Promise.all([
    admin.from('calendario_eventi').select(COLONNE_EVENTO).eq('utente_id', utenteId).is('eliminato_il', null).is('ricorrenza', null)
      .lt('inizio', al.toISOString())
      .or(`fine.gte."${dal.toISOString()}",and(fine.is.null,inizio.gte."${dal.toISOString()}")`)
      .order('inizio', { ascending: true }).limit(2000),
    admin.from('calendario_eventi').select(COLONNE_EVENTO).eq('utente_id', utenteId).is('eliminato_il', null).not('ricorrenza', 'is', null)
      .lt('inizio', al.toISOString()).order('inizio', { ascending: true }).limit(500),
  ])
  if (singole.error) throw new Error('voci non lette: ' + singole.error.message)
  if (serie.error) throw new Error('voci che si ripetono non lette: ' + serie.error.message)
  // le serie finite prima del periodo non servono (la data di fine è dentro la ricorrenza)
  const dalG = giornoRoma(dal)
  return [...(singole.data || []), ...(serie.data || []).filter((e: any) => !e.ricorrenza?.fino || e.ricorrenza.fino >= dalG)]
}

// gli inviti di una persona (non tolti), con la voce e chi l'ha organizzata
async function invitiMiei(admin: any, utenteId: string, conRifiutati = false): Promise<{ inviti: any[]; eventi: Map<string, any>; organizzatori: Map<string, string> }> {
  let q = admin.from('calendario_inviti').select('id,evento_id,stato,invitato_da,avvisato_il,avvisato_occorrenza,creato_il').eq('utente_id', utenteId).is('eliminato_il', null)
  if (!conRifiutati) q = q.neq('stato', 'rifiutato')
  const { data: inviti, error } = await q.limit(1000)
  if (error) throw new Error('inviti non letti: ' + error.message)
  const eventi = new Map<string, any>(), organizzatori = new Map<string, string>()
  if (!inviti?.length) return { inviti: [], eventi, organizzatori }
  const ids = [...new Set(inviti.map((i: any) => i.evento_id))]
  const { data: ev, error: e2 } = await admin.from('calendario_eventi').select(COLONNE_EVENTO).in('id', ids).is('eliminato_il', null)
  if (e2) throw new Error('voci degli inviti non lette: ' + e2.message)
  for (const e of ev || []) eventi.set(e.id, e)
  const chi = [...new Set(inviti.map((i: any) => i.invitato_da))]
  const { data: org } = await admin.from('utenti').select('id,nome,cognome,masters(nome)').in('id', chi)
  for (const u of org || []) organizzatori.set(u.id, [nomeDi(u), (u as any).masters?.nome].filter(Boolean).join(' · '))
  return { inviti: inviti.filter((i: any) => eventi.has(i.evento_id)), eventi, organizzatori }
}

// per chi organizza: gli invitati delle sue voci, con le risposte
async function invitatiDi(admin: any, eventiIds: string[]): Promise<Map<string, Invitato[]>> {
  const per = new Map<string, Invitato[]>()
  if (!eventiIds.length) return per
  const { data: inv, error } = await admin.from('calendario_inviti').select('evento_id,utente_id,stato').in('evento_id', eventiIds).is('eliminato_il', null)
  if (error) throw new Error('invitati non letti: ' + error.message)
  if (!inv?.length) return per
  const { data: us } = await admin.from('utenti').select('id,nome,cognome,ruolo,clienti(ragione_sociale)').in('id', [...new Set(inv.map((i: any) => i.utente_id))])
  const u = new Map<string, any>((us || []).map((x: any) => [x.id, x]))
  for (const i of inv) {
    const l = per.get(i.evento_id) || []
    l.push({ utente_id: i.utente_id, nome: nomeDi(u.get(i.utente_id)), ruolo: String(u.get(i.utente_id)?.ruolo || ''), stato: i.stato })
    per.set(i.evento_id, l)
  }
  for (const l of per.values()) l.sort((a, b) => a.nome.localeCompare(b.nome))
  return per
}

// IL CALENDARIO: le voci di una persona nel periodo [dal, al)
export async function vociNelPeriodo(admin: any, utenteId: string, dal: Date, al: Date): Promise<VoceServer[]> {
  // nel calendario anche gli inviti rifiutati (in grigio, per poterci ripensare); avvisi e link per Google no
  const [mie, inv] = await Promise.all([righeMie(admin, utenteId, dal, al), invitiMiei(admin, utenteId, true)])
  const invitati = await invitatiDi(admin, mie.map((e) => e.id))
  const out: VoceServer[] = []
  for (const e of mie) out.push(...srotola(e, dal, al, 'mio', invitati.get(e.id) ? { invitati: invitati.get(e.id) } : {}))
  for (const i of inv.inviti) {
    const e = inv.eventi.get(i.evento_id)
    out.push(...srotola(e, dal, al, 'invitato', { invito: { stato: i.stato, organizzatore: inv.organizzatori.get(i.invitato_da) || 'Utente' } }))
  }
  return out.sort((a, b) => a.inizio.localeCompare(b.inizio))
}

// «DA FARE»: i promemoria propri non ancora fatti fino alla fine di oggi. Di quelli che si ripetono solo l'ultimo
// giorno rimasto da fare (negli ultimi 30): un «ogni giorno» mai spuntato non deve riempire la lista con 20 copie
export async function promemoriaDaFare(admin: any, utenteId: string): Promise<VoceServer[]> {
  const oggi = giornoRoma()
  const fineOggi = new Date(fineGiornoRomaISO(oggi))
  const da30 = new Date(inizioGiornoRomaISO(giornoRoma(new Date(Date.now() - 30 * 86400000))))
  const [singole, serie] = await Promise.all([
    admin.from('calendario_eventi').select(COLONNE_EVENTO).eq('utente_id', utenteId).is('eliminato_il', null).is('ricorrenza', null)
      .eq('tipo', 'promemoria').eq('fatto', false).lte('inizio', fineOggi.toISOString()).order('inizio', { ascending: true }).limit(200),
    admin.from('calendario_eventi').select(COLONNE_EVENTO).eq('utente_id', utenteId).is('eliminato_il', null).not('ricorrenza', 'is', null)
      .eq('tipo', 'promemoria').lte('inizio', fineOggi.toISOString()).limit(200),
  ])
  if (singole.error) throw new Error('promemoria non letti: ' + singole.error.message)
  if (serie.error) throw new Error('promemoria che si ripetono non letti: ' + serie.error.message)
  const out: VoceServer[] = []
  for (const e of singole.data || []) out.push(...srotola(e, new Date(0), new Date(fineOggi.getTime() + 1), 'mio'))
  for (const e of serie.data || []) {
    const ultima = srotola(e, da30, new Date(fineOggi.getTime() + 1), 'mio').filter((v) => !v.fatto).pop()
    if (ultima) out.push(ultima)
  }
  return out.sort((a, b) => a.inizio.localeCompare(b.inizio)).slice(0, 200)
}

// LA CAMPANELLA: gli avvisi arrivati (ultimi 7 giorni, non fatti) e gli inviti ancora senza risposta
export type CartaCampanella = { id: string; oggetto: string; messaggio: string; created_at: string; link: string; categoria: string }
export async function cartePerCampanella(admin: any, utenteId: string, href: string, esc: (s: any) => string): Promise<CartaCampanella[]> {
  const ora = Date.now()
  const dal = new Date(ora - 7 * 86400000 - 86400000), al = new Date(ora + 7 * 86400000 + 60000)
  const [mie, inv] = await Promise.all([righeMie(admin, utenteId, dal, al), invitiMiei(admin, utenteId)])
  const carte: CartaCampanella[] = []
  const quando = (v: VoceServer) => {
    const d = new Date(v.inizio)
    const g = d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' })
    return v.tutto_il_giorno ? `${g}, tutto il giorno` : `${g}, alle ${d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}`
  }
  // di ogni voce l'avviso più recente arrivato e non fatto: una serie quotidiana non mette una carta al giorno
  const avvisi = (voci: VoceServer[], extra: (v: VoceServer) => string | null) => {
    let ultima: { v: VoceServer; m: Date } | null = null
    for (const v of voci) {
      if (v.fatto || v.avviso_minuti == null) continue
      const m = momentoAvviso(v)
      if (!m || m.getTime() > ora || ora - m.getTime() > 7 * 86400000) continue
      if (!ultima || m > ultima.m) ultima = { v, m }
    }
    if (!ultima) return
    const { v, m } = ultima
    // il messaggio della campanella è HTML: i testi scritti dagli utenti si scappano
    carte.push({ id: `cal-${v.id}-${v.occorrenza || ''}`, oggetto: v.titolo, messaggio: [quando(v), v.luogo, extra(v)].filter(Boolean).map(esc).join(' · '), created_at: m.toISOString(), link: href, categoria: 'promemoria' })
  }
  for (const e of mie) avvisi(srotola(e, dal, al, 'mio'), (v) => v.collegamento?.etichetta || null)
  for (const i of inv.inviti) {
    const e = inv.eventi.get(i.evento_id), org = inv.organizzatori.get(i.invitato_da) || 'Utente'
    avvisi(srotola(e, dal, al, 'invitato'), () => `invito di ${org}`)
    // l'invito senza risposta, finché la voce (o la prossima occorrenza) non è passata
    if (i.stato === 'in_attesa') {
      const prossima = occorrenze(e, new Date(ora), new Date(ora + 400 * 86400000), 1)[0]
      if (prossima) carte.push({ id: `inv-${i.id}`, oggetto: `Invito: ${e.titolo}`, messaggio: [`${org} ti ha invitato`, quando({ inizio: prossima.inizio.toISOString(), tutto_il_giorno: !!e.tutto_il_giorno } as VoceServer)].map(esc).join(' · '), created_at: i.creato_il, link: href, categoria: 'promemoria' })
    }
  }
  return carte
}
