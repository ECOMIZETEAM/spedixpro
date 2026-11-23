// Chiusura al vettore di una distinta MISTA (piu' contratti dello stesso vettore fisico, es. tutti GLS:
// diretto tipo='gls' + via provider tipo='spedisci'). La distinta mista ha corriere_id = NULL; le
// spedizioni portano ognuna il proprio corriere_id. Qui le RAGGRUPPO per contratto reale e chiudo ogni
// gruppo con le SUE credenziali (CloseWorkDay per il GLS diretto, borderò provider per Spedisci, ecc.).
// Attesto la distinta (confermata_vettore + bordero_id) SOLO se TUTTI i gruppi vanno a buon fine;
// altrimenti bordero_id='ERRORE: …' e la distinta resta ritentabile (la guardia lascia ripassare gli
// ERRORE). Questa e' la regola-soldi messa "dove passano tutte le porte": nessuna spedizione puo' finire
// trasmessa col contratto/credenziali sbagliati, ne' restare non trasmessa in silenzio.
//
// Le chiud* mono-contratto (chiudiBorderoSpedisci/chiudiGiornataGls/…) restano invariate per le distinte
// con un solo corriere_id: questa gira SOLO sulle miste (corriere_id NULL) e sui gruppi usa gli STESSI
// core di trasmissione, cosi' la logica vive in un posto solo.

import { chiudiSpedizioniGls, numeroNudoGls } from '@/lib/gls'
import { raggruppaPerContractCodeSpedisci, trasmettiBorderoSpedisci } from '@/lib/spedisci'
import { confermaSpedizioniBrt } from '@/lib/brt'

// CONDIVISIONE: una gamba-ponte ('moovexpress') NON ha borderò/manifest da trasmettere — l'handover al
// corriere vero è già avvenuto all'OWNER alla creazione della LDV (Poste/KSync in fondo alla catena). La
// distinta del ponte è solo un documento interno: si attesta subito (come FedEx/SDA), senza chiamare
// nessuno, così non resta "In attesa" per sempre (prima solo la conferma MANUALE la sbloccava; cron e
// creazione la lasciavano arancio). Guardia tipo==='moovexpress': non tocca gli altri corrieri.
export async function chiudiDistintaMoovexpress(supabase: any, distintaId: string) {
  try {
    const { data: distinta } = await supabase
      .from('distinte').select('id, corriere_id, bordero_id').eq('id', distintaId).maybeSingle()
    if (!distinta || !distinta.corriere_id) return { skip: true }
    if (distinta.bordero_id && !String(distinta.bordero_id).startsWith('ERRORE')) return { skip: true }
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { data: corriere } = await createAdminSupabase()
      .from('corrieri').select('id, tipo').eq('id', distinta.corriere_id).maybeSingle()
    if (!corriere || corriere.tipo !== 'moovexpress') return { skip: true }
    await supabase.from('distinte').update({
      bordero_id: 'N/A', confermata_vettore: true, data_conferma: new Date().toISOString(),
    }).eq('id', distintaId)
    return { ok: true }
  } catch (e: any) {
    return { errore: String(e?.message || e) }
  }
}

// Contratti SENZA manifest/borderò giornaliero da trasmettere: l'handover al corriere avviene alla
// CREAZIONE (il ritiro è prenotato nell'ordine, lo shipment è registrato alla create), non con una
// chiusura di giornata — easyparcel non ha proprio un endpoint di chiusura. Senza un gestore la loro
// distinta restava "In attesa" (arancio) per SEMPRE: 8.100+ così, e quel rumore MASCHERAVA i veri
// fallimenti di chi invece DEVE trasmettere (un GLS/BRT non trasmesso era indistinguibile). Si attesta
// subito (come FedEx/moovexpress), senza chiamare nessuno.
// ALLOWLIST ESPLICITA, non "tutti gli altri": un corriere DIRETTO futuro che richiede trasmissione reale
// non dev'essere mai auto-attestato per sbaglio (merce ignota al corriere mascherata da verde = il
// contrario del bug, e più pericoloso). Un tipo nuovo resta fuori e lo si gestisce apposta.
// ecosmos: la spedizione e' registrata da loro alla create e il ritiro e' automatico (lib/ecosmos.ts),
// la loro API non ha una chiusura di giornata.
export const TIPI_SENZA_MANIFEST = ['easyparcel', 'interno', 'inpost', 'poste', 'dielle', 'ecosmos']

// Stati in cui una spedizione NON va affidata al corriere: annullata, o in coda di annullo (per Dielle
// l'annullo lo fa a mano il detentore: confermarla nel frattempo la farebbe partire).
const STATI_NON_DA_AFFIDARE = ['annullata', 'annullamento_pending', 'annullamento_manuale']

// Le credenziali Dielle del contratto. Oggi le copie dei sotto-master le hanno copiate; se una copia non
// le ha (le chiavi restano del detentore) si risale la catena dei fornitori fino a chi le ha.
async function credenzialiDielle(admin: any, corriereId: string): Promise<any | null> {
  let id: string | null = corriereId
  for (let giro = 0; id && giro < 10; giro++) {
    const { data: c }: { data: any } = await admin.from('corrieri').select('id, credenziali, fornitore_corriere_id').eq('id', id).maybeSingle()
    if (!c) return null
    const cr = c.credenziali || {}
    if (cr.username && cr.password) return { username: String(cr.username), password: String(cr.password), ambiente: cr.ambiente === 'staging' ? 'staging' : 'prod' }
    id = c.fornitore_corriere_id || null
  }
  return null
}

// DIELLE: è l'unico dei "senza manifest" che una trasmissione ce l'ha. Le spedizioni create via API
// restano NUOVA sul fornitore e non partono finché non si confermano (lib/dielle, confermaSpedizioniDielle).
// Si fa qui, alla chiusura della distinta, così vale per tutte le porte: portale master e cliente, giro
// serale, conferma e ritentativo, API pubblica.
async function confermaGruppoDielle(admin: any, corriereId: string, spedizioni: any[]): Promise<{ ok: boolean; errore?: string }> {
  const ldv = spedizioni
    .filter((s: any) => !STATI_NON_DA_AFFIDARE.includes(String(s.stato || '')))
    .map((s: any) => String(s.raw_response?.ldv || s.tracking_number || s.numero || '').trim())
    .filter(Boolean)
  if (!ldv.length) return { ok: true }
  const cred = await credenzialiDielle(admin, corriereId)
  if (!cred) return { ok: false, errore: 'contratto senza credenziali: conferma al corriere non inviata' }
  const { confermaSpedizioniDielle } = await import('@/lib/dielle')
  const r = await confermaSpedizioniDielle(cred, ldv)
  return r.ok ? { ok: true } : { ok: false, errore: 'conferma al corriere: ' + (r.errore || 'non riuscita') }
}

export async function chiudiDistintaSenzaManifest(supabase: any, distintaId: string) {
  try {
    const { data: distinta } = await supabase
      .from('distinte').select('id, corriere_id, bordero_id').eq('id', distintaId).maybeSingle()
    if (!distinta || !distinta.corriere_id) return { skip: true }
    if (distinta.bordero_id && !String(distinta.bordero_id).startsWith('ERRORE')) return { skip: true }
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: corriere } = await admin
      .from('corrieri').select('id, tipo').eq('id', distinta.corriere_id).maybeSingle()
    if (!corriere || !TIPI_SENZA_MANIFEST.includes(corriere.tipo)) return { skip: true }
    if (corriere.tipo === 'dielle') {
      const { data: speds } = await admin
        .from('spedizioni').select('id, numero, tracking_number, raw_response, stato').eq('distinta_id', distintaId)
      const r = await confermaGruppoDielle(admin, corriere.id, speds || [])
      if (!r.ok) {
        // La distinta resta da ritentare (le guardie lasciano ripassare gli ERRORE) e il problema si vede:
        // attestarla come le altre vorrebbe dire pacchi mai affidati con la distinta in verde.
        console.error('[DISTINTE][DIELLE] conferma non riuscita', distintaId, r.errore)
        await supabase.from('distinte').update({ bordero_id: 'ERRORE: ' + String(r.errore).slice(0, 200) }).eq('id', distintaId)
        return { errore: r.errore }
      }
    }
    await supabase.from('distinte').update({
      bordero_id: 'N/A', confermata_vettore: true, data_conferma: new Date().toISOString(),
    }).eq('id', distintaId)
    return { ok: true }
  } catch (e: any) {
    return { errore: String(e?.message || e) }
  }
}

export async function chiudiDistintaMista(supabase: any, distintaId: string) {
  try {
    const { data: distinta } = await supabase
      .from('distinte').select('id, corriere_id, bordero_id').eq('id', distintaId).maybeSingle()
    if (!distinta) return { skip: true }
    // Solo distinte MISTE: quelle con un corriere unico le chiudono le chiud* dedicate.
    if (distinta.corriere_id) return { skip: true }
    // Gia' confermata: skip. Se era finita in ERRORE si RITENTA.
    if (distinta.bordero_id && !String(distinta.bordero_id).startsWith('ERRORE')) return { skip: true }

    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const admin = createAdminSupabase()
    const { data: speds } = await admin
      .from('spedizioni').select('id, numero, tracking_number, raw_response, corriere_id, stato').eq('distinta_id', distintaId)
    if (!speds?.length) return { errore: 'distinta senza spedizioni' }

    // Raggruppo per il corriere REALE di ogni spedizione (non per la distinta, che qui non ne ha uno).
    const perCorr = new Map<string, any[]>()
    for (const s of speds) {
      const cid = (s as any).corriere_id
      if (!cid) continue
      if (!perCorr.has(cid)) perCorr.set(cid, [])
      perCorr.get(cid)!.push(s)
    }
    const { data: corrieri } = await admin.from('corrieri').select('id, tipo, credenziali').in('id', Array.from(perCorr.keys()))
    const byId = new Map<string, any>((corrieri || []).map((c: any) => [c.id, c]))

    const borderoIds: string[] = []
    const errori: string[] = []
    for (const [cid, gruppo] of perCorr) {
      const corr = byId.get(cid)
      if (!corr) { errori.push('contratto sconosciuto'); continue }
      const cred = (corr.credenziali || {}) as any
      if (corr.tipo === 'gls') {
        // Le annullate non si mandano: su GLS sono gia' cancellate e la chiusura le rifiuterebbe (vedi
        // lib/gls, chiudiGiornataGls). Un gruppo tutto annullato non ha niente da affidare a GLS.
        const numeri = gruppo.filter((s: any) => s.stato !== 'annullata').map(numeroNudoGls).filter(Boolean)
        if (!numeri.length) continue
        const r = await chiudiSpedizioniGls(cred, numeri)
        if (!r.ok) errori.push('GLS: ' + (r.errore || 'chiusura non confermata'))
        else if (r.riassunto) console.error('[DISTINTE][GLS] mista chiusa con pacchi non chiusi', distintaId, r.riassunto)
      } else if (corr.tipo === 'spedisci') {
        const gruppi = raggruppaPerContractCodeSpedisci(gruppo)
        if (!gruppi.size) { errori.push('Spedisci: nessuna spedizione con shipmentId/contractCode'); continue }
        const r = await trasmettiBorderoSpedisci(cred, gruppi)
        if (r.ok) borderoIds.push(...r.ids)
        else errori.push('Spedisci: ' + (r.errore || 'chiusura non confermata'))
      } else if (corr.tipo === 'brt') {
        // Le annullate non si mandano: BRT le rifiuta e l'errore faceva fallire tutta la mista (lib/brt,
        // chiudiDistintaBrt; caso 81418 di Wave). Un gruppo tutto annullato non ha niente da confermare.
        const refs = gruppo.filter((s: any) => s.stato !== 'annullata').map((s: any) => s.raw_response).filter((r: any) => r && r.numericRef)
          .map((r: any) => ({ numericRef: Number(r.numericRef), alphaRef: r.alphaRef || null }))
        const r = await confermaSpedizioniBrt(cred, refs)
        if (!r.ok) errori.push('BRT: ' + (r.errore || 'conferma non riuscita'))
      } else if (corr.tipo === 'dielle') {
        // Dielle va confermato anche dentro una mista: senza conferma le spedizioni restano NUOVA e non partono.
        const r = await confermaGruppoDielle(admin, cid, gruppo)
        if (!r.ok) errori.push(r.errore || 'conferma al corriere non riuscita')
      } else if (corr.tipo === 'fedex') {
        // FedEx auto-conferma alla creazione e il ritiro è programmato a parte sul conto: nessuna
        // trasmissione da fare qui, il gruppo è già "chiuso" lato corriere (come SDA).
      } else if (TIPI_SENZA_MANIFEST.includes(corr.tipo) || corr.tipo === 'spediamopro' || corr.tipo === 'moovexpress') {
        // Nessuna trasmissione da fare per questo gruppo: handover alla creazione (easyparcel/interno/
        // inpost/poste/dielle), bordereau = solo documento (spediamopro), gamba-ponte già attestata
        // all'owner (moovexpress). Senza questi rami la MISTA cadeva nell'else e bollava ERRORE l'INTERA
        // distinta anche quando il gruppo del corriere VERO (GLS/BRT/Spedisci) era stato trasmesso:
        // sono i 51 chiudiDistintaMista in ERRORE (40 easyparcel + 11 spediamopro).
      } else {
        // Difensivo: non deve capitare (il merge e' vincolato a un solo vettore fisico), ma se un tipo
        // non e' gestito lo diciamo forte invece di far finta di aver trasmesso.
        errori.push(`tipo ${corr.tipo} non gestito nel merge`)
      }
    }

    const ok = errori.length === 0
    await supabase.from('distinte').update({
      bordero_id: ok ? (borderoIds.length ? Array.from(new Set(borderoIds)).join(',') : 'N/A') : ('ERRORE: ' + errori.join(' | ').slice(0, 200)),
      ...(ok ? { confermata_vettore: true, data_conferma: new Date().toISOString() } : {}),
    }).eq('id', distintaId)
    return { ok, errore: ok ? null : errori.join(' | ') }
  } catch (e: any) {
    try { await supabase.from('distinte').update({ bordero_id: 'ERRORE: ' + String(e?.message || e).slice(0, 150) }).eq('id', distintaId) } catch {}
    return { errore: String(e?.message || e) }
  }
}
