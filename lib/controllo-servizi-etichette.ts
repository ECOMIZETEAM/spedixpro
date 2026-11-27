/* LE ETICHETTE DI IERI: SERVIZI CHE NESSUNO HA CHIESTO (Lorenzo, 27/11/2026).
 *
 * Dal 2/9 al 30/10 ogni contrassegno GLS partiva con «ENTRO ORE 12» stampato sull'etichetta: la modalità del
 * contrassegno (contanti = 01) era finita nei servizi accessori, e per GLS 01 è la consegna entro le 12, che si
 * paga. Lo si è visto solo il 30/10 dai clienti, e il conto è arrivato con la fattura: 362 € che Wave ha pagato a
 * GLS per un errore della piattaforma (vedi lib/controllo-fattura-gls, FINE_ERRORE_ENTRO_12). Lorenzo: «facciamo sì
 * che quando colleghiamo un contratto di verificare bene, altrimenti facciamo danni ai master».
 *
 * Qui, ogni mattina nella Sentinella: le etichette create ieri si leggono e si cercano le scritte dei servizi a
 * pagamento che il corriere stampa (GLS: «ENTRO ORE 12», «ORA FISSA», «SERVIZIO AL SABATO»…). Se c'è una scritta e
 * nella spedizione nessuno ha chiesto quel servizio, è un allarme. Un codice sbagliato colpisce tutte le spedizioni
 * con la stessa combinazione di opzioni: non serve leggerle tutte, bastano le ultime di ogni combinazione (contratto,
 * contrassegno sì o no, servizi chiesti). L'errore di settembre sarebbe uscito la mattina dopo.
 *
 * Per ora GLS: è il corriere di cui conosciamo le scritte, verificate il 30/10 su spedizioni vere (memoria
 * gls-codice-01-entro-ore-12). «LAGUNA 08» non è un servizio (è la zona di Venezia centro storico). Solo lettura. */
import { giorniFaRoma, inizioGiornoRomaISO, fineGiornoRomaISO } from '@/lib/date-roma'

type Riga = { area: string; controllo: string; valore: number; atteso: string; allarme: boolean }

// Le scritte dei servizi a pagamento sull'etichetta GLS, e i nomi di servizio (servizi_accessori della spedizione)
// che le giustificano. Oggi il catalogo GLS di Moove ha solo Exchange: tutte queste, se compaiono, non sono chieste.
export const SCRITTE_GLS: { scritta: RegExp; nome: string; giustificata: RegExp }[] = [
  { scritta: /ENTRO\s*ORE\s*12/i, nome: 'ENTRO ORE 12', giustificata: /entro\s*(le\s*)?(ore\s*)?12/i },
  { scritta: /ENTRO\s*ORE\s*13/i, nome: 'ENTRO ORE 13', giustificata: /entro\s*(le\s*)?(ore\s*)?13/i },
  { scritta: /ORA\s*FISSA/i, nome: 'ORA FISSA', giustificata: /ora\s*fissa|appuntamento/i },
  { scritta: /\bANTICIPATO\b/i, nome: 'ANTICIPATO', giustificata: /anticipat/i },
  { scritta: /SERVIZIO\s*AL\s*SABATO/i, nome: 'SERVIZIO AL SABATO', giustificata: /sabato|saturday/i },
  { scritta: /EXPRESS\s*12/i, nome: 'EXPRESS 12', giustificata: /express\s*12/i },
]

// Le scritte di servizio sull'etichetta che la spedizione non ha chiesto.
export function serviziNonChiesti(testo: string, chiesti: string[]): string[] {
  return SCRITTE_GLS.filter(s => s.scritta.test(testo) && !chiesti.some(c => s.giustificata.test(String(c || '')))).map(s => s.nome)
}

async function testoPdf(bytes: Uint8Array): Promise<string> {
  const mod: any = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = mod.getDocument ? mod : (mod.default || mod)
  // isEvalSupported: false chiude la falla di pdfjs-dist 3 (CVE-2024-4367), come nelle altre letture.
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise
  let t = ''
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) t += ' ' + (await (await doc.getPage(p)).getTextContent()).items.map((i: any) => i.str).join(' ')
  await doc.destroy()
  return t
}

// L'etichetta salvata alla creazione: quella del primo collo, poi quella della spedizione. Può essere un data URL, un
// percorso nel bucket «etichette», o un indirizzo del nostro storage. Un PDF si legge col testo; un'etichetta
// termica (ZPL) è già testo.
async function testoEtichetta(admin: any, s: any): Promise<string | null> {
  const c0 = Array.isArray(s.colli_dettaglio) ? s.colli_dettaglio[0] : null
  const nostro = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  for (const x of [c0?.etichetta_path, c0?.etichetta_url, s.etichetta_path, s.etichetta_url]) {
    if (!x) continue
    const v = String(x)
    let bytes: Uint8Array | null = null
    const m = /^data:[^;]+;base64,([\s\S]*)$/.exec(v)
    if (m) bytes = new Uint8Array(Buffer.from(m[1], 'base64'))
    else if (/^https?:\/\//.test(v)) {
      if (!nostro || !v.startsWith(nostro + '/')) continue   // solo il nostro storage: niente indirizzi di fuori
      const r = await fetch(v, { signal: AbortSignal.timeout(5000) }).catch(() => null)
      if (r?.ok) bytes = new Uint8Array(await r.arrayBuffer())
    } else {
      const { data } = await admin.storage.from('etichette').download(v)
      if (data) bytes = new Uint8Array(await data.arrayBuffer())
    }
    if (!bytes?.length) continue
    const inizio = Buffer.from(bytes.slice(0, 5)).toString('latin1')
    return inizio === '%PDF-' ? await testoPdf(bytes) : Buffer.from(bytes).toString('latin1')
  }
  return null
}

export async function controlloServiziEtichette(admin: any, opt: { giorno?: string; tempoMaxMs?: number; perCombinazione?: number; massimo?: number } = {}): Promise<Riga[]> {
  const avvio = Date.now()
  const giorno = opt.giorno || giorniFaRoma(1)
  const area = 'etichette'
  const quando = giorno.split('-').reverse().join('/')

  const { data: corr, error: ec } = await admin.from('corrieri').select('id,nome_contratto').eq('tipo', 'gls')
  if (ec) throw new Error('lettura dei contratti GLS non riuscita: ' + ec.message)
  const nome = new Map<string, string>((corr || []).map((c: any) => [c.id, String(c.nome_contratto || 'GLS')]))
  if (!nome.size) return [{ area, controllo: `etichette GLS del ${quando}: nessun contratto GLS`, valore: 0, atteso: 'informativa', allarme: false }]

  // Le spedizioni di ieri sui contratti GLS (anche le copie dei sotto-master), senza le etichette: sono pesanti e
  // se ne legge solo un campione. La riga di chi spedisce ha numero = tracking; le gambe (…-1d6ac50d) no.
  const sped: any[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await admin.from('spedizioni').select('id,numero,tracking_number,corriere_id,contrassegno,servizi_accessori,created_at')
      .in('corriere_id', Array.from(nome.keys())).gte('created_at', inizioGiornoRomaISO(giorno)).lte('created_at', fineGiornoRomaISO(giorno))
      .order('created_at', { ascending: false }).range(da, da + 999)
    if (error) throw new Error('lettura delle spedizioni non riuscita: ' + error.message)
    sped.push(...(data || [])); if ((data || []).length < 1000) break
  }
  const principali = sped.filter(s => s.tracking_number && s.numero === s.tracking_number && !String(s.numero).startsWith('TMP-'))
  if (!principali.length) return [{ area, controllo: `etichette GLS del ${quando}: nessuna spedizione GLS`, valore: 0, atteso: 'informativa', allarme: false }]

  // Le ultime di ogni combinazione di contratto e opzioni.
  const chiesti = (s: any) => (Array.isArray(s.servizi_accessori) ? s.servizi_accessori : []).map((x: any) => String(typeof x === 'string' ? x : x?.nome || x?.name || '')).filter(Boolean)
  const combinazione = (s: any) => `${nome.get(s.corriere_id)} · ${Number(s.contrassegno) > 0 ? 'contrassegno' : 'senza contrassegno'}${chiesti(s).length ? ' · ' + chiesti(s).sort().join(' + ') : ''}`
  const perComb = new Map<string, any[]>()
  for (const s of principali) { const k = combinazione(s); const l = perComb.get(k) || []; if (l.length < (opt.perCombinazione ?? 3)) l.push(s); perComb.set(k, l) }
  const scelte = Array.from(perComb.values()).flat().slice(0, opt.massimo ?? 60)

  let lette = 0, senza = 0, illeggibili = 0, nonFinite = 0
  const trovate: { s: any; scritte: string[] }[] = []
  for (let i = 0; i < scelte.length; i += 5) {
    if (opt.tempoMaxMs && Date.now() - avvio > opt.tempoMaxMs) { nonFinite = scelte.length - i; break }
    const blocco = scelte.slice(i, i + 5)
    const { data: piene, error } = await admin.from('spedizioni').select('id,etichetta_path,etichetta_url,colli_dettaglio').in('id', blocco.map(s => s.id))
    if (error) throw new Error('lettura delle etichette non riuscita: ' + error.message)
    const per = new Map<string, any>((piene || []).map((p: any) => [p.id, p]))
    await Promise.all(blocco.map(async s => {
      let t: string | null = null
      try { t = per.has(s.id) ? await testoEtichetta(admin, per.get(s.id)) : null } catch { illeggibili++; return }
      if (t == null) { senza++; return }
      lette++
      const scritte = serviziNonChiesti(t, chiesti(s))
      if (scritte.length) trovate.push({ s, scritte })
    }))
  }

  const righe: Riga[] = []
  // Un controllo che non legge niente non si distingue da uno che non trova niente: se la maggior parte delle
  // etichette scelte non si è letta, è un allarme anche quello.
  const pocheLette = lette < Math.ceil(scelte.length / 2)
  righe.push({ area, controllo: `etichette GLS del ${quando}: lette ${lette} su ${scelte.length} (le ultime di ${perComb.size} combinazioni di contratto e opzioni, su ${principali.length} spedizioni)`
    + (senza ? `, ${senza} senza etichetta salvata` : '') + (illeggibili ? `, ${illeggibili} illeggibili` : '') + (nonFinite ? `, ${nonFinite} non lette per tempo` : ''),
    valore: lette, atteso: `almeno ${Math.ceil(scelte.length / 2)}`, allarme: pocheLette })
  righe.push({ area, controllo: `etichette GLS del ${quando} con un servizio a pagamento che nessuno ha chiesto («ENTRO ORE 12», «ORA FISSA», «SERVIZIO AL SABATO»…)`,
    valore: trovate.length, atteso: '0', allarme: trovate.length > 0 })
  for (const x of trovate.slice(0, 10)) {
    const c = chiesti(x.s)
    righe.push({ area, controllo: `${x.s.tracking_number} (${combinazione(x.s)}): sull'etichetta «${x.scritte.join('», «')}», servizi chiesti: ${c.length ? c.join(', ') : 'nessuno'}. Il corriere lo farà pagare: controlla i codici mandati per questo contratto`,
      valore: 1, atteso: '0', allarme: true })
  }
  return righe
}
