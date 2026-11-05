import { pesoSuReale, descriviAgevolazione } from '@/lib/agevolazione-misure'
import { corriereDiMasterPerNome } from '@/lib/contratto-per-nome'
import type { EsitoRipesatura } from '@/lib/ripesature-calcolo'

// IL CONTROLLO CON ONETRACKING PRIMA CHE UNA RETTIFICA NASCA (Lorenzo, 05/11/2026).
//
// OneTracking e' il portale ufficiale di Poste: quello che dice lui sul pacco — peso e lati misurati in
// filiale — e' legge. Il file di un fornitore no. Il 04/11 i file "RETTIFICHE CONTRATTO M 0411" di MULTI
// (Poste Express M) hanno fatto pagare il VOLUME su 2.295 pacchi che per OneTracking stavano nell'agevolazione
// (un collo, peso reale fino a 5 kg, dentro la scatola): 3UW1UHA217512, 0,9 kg 39,5×24,5×14,5 cm, nel file
// 2,81 kg — la fascia fino a 5 kg invece di quella fino a 2. Confermate, sono scese fino ai clienti: 1.812,55 €.
// Le rettifiche nate dal portale sulle stesse misure davano il peso reale, tutte.
//
// Qui ogni riga del file si confronta con OneTracking PRIMA di diventare una rettifica. Il peso giusto e'
// quello che il contratto fa pagare sulla misura vera: il reale se il pacco sta nell'agevolazione (la stessa
// regola del portale, pesoSuReale, con la scatola e il tetto del contratto di chi carica), altrimenti il
// maggiore fra reale e volume col suo divisore. Se il file porta il pacco in una fascia piu' alta di quella,
// la riga nasce IN CONTESTAZIONE: la Conferma non la prende e sotto non scende niente.
//
// Le letture di OneTracking sono piu' d'una (lo stesso pacco misurato a Civitanova 0,9 kg e a Bologna 1 kg):
// si prende la piu' favorevole al fornitore, cosi' una riga si ferma solo quando il file supera ANCHE quella.
// Senza misura, o su piu' colli (OneTracking misura il pacco, non i colli), non si decide niente: la riga
// passa come oggi e si conta a parte, perche' chi carica sappia quante non sono state verificate.

export type EsitoControllo = 'buona' | 'senza_agevolazione' | 'peso_sbagliato' | 'senza_misura' | 'non_verificabile'
export type Controllo = {
  esito: EsitoControllo
  motivo: string
  peso_file: number
  peso_onetracking?: number
  misura?: { peso: number; lunghezza: number; larghezza: number; altezza: number; dove?: string | null; quando?: string | null }
}

// Fermano la riga: il fornitore fa pagare piu' di quello che dice OneTracking.
export const FERMA = new Set<EsitoControllo>(['senza_agevolazione', 'peso_sbagliato'])

// Solo i contratti del gruppo Poste (anche SDA): sono quelli che OneTracking misura.
const DI_POSTE = /^(poste|sda)\b|\bpdb\b/i

// Acceso per master, dalle sue impostazioni. Per ora lo ha solo MULTIEXPRESS (Lorenzo, 05/11/2026).
export async function controlloAttivo(admin: any, masterId: string): Promise<boolean> {
  const { data } = await admin.from('masters').select('impostazioni').eq('id', masterId).maybeSingle()
  return (data as any)?.impostazioni?.controllo_onetracking === true
}

const kg = (x: number) => `${(Math.round(x * 100) / 100).toLocaleString('it-IT')} kg`
const cm = (x: any) => (Number(x) || 0).toLocaleString('it-IT')
const lati = (l: any) => `${cm(l.lunghezza)}×${cm(l.larghezza)}×${cm(l.altezza)} cm`

export async function controllaConOneTracking(admin: any, masterId: string, esiti: EsitoRipesatura[]): Promise<Map<string, Controllo>> {
  const out = new Map<string, Controllo>()
  const ids = Array.from(new Set(esiti.filter(e => e.trovata && e.spedizioneId).map(e => e.spedizioneId as string)))
  const sped = new Map<string, any>(), misure = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 200) {
    const fetta = ids.slice(i, i + 200)
    const [s, m] = await Promise.all([
      admin.from('spedizioni').select('id,colli,corrieri(nome_contratto)').in('id', fetta),
      admin.from('ripesature_misure').select('spedizione_id,esito,peso,lunghezza,larghezza,altezza,misurata_il,filiale,righe').in('spedizione_id', fetta),
    ])
    if (s.error || m.error) throw new Error('controllo OneTracking: ' + (s.error?.message || m.error?.message))
    for (const x of (s.data || []) as any[]) sped.set(x.id, x)
    for (const x of (m.data || []) as any[]) if (x.esito === 'misurata') misure.set(x.spedizione_id, x)
  }

  // Il contratto di CHI CARICA: e' il suo accordo col fornitore a dire scatola, tetto, divisore e fasce.
  const contratti = new Map<string, { settings: any; divisore: number; soglie: number[] } | null>()
  const contrattoDi = async (nome: string) => {
    if (contratti.has(nome)) return contratti.get(nome)!
    const corrId = await corriereDiMasterPerNome(admin, masterId, nome)
    let c: { settings: any; divisore: number; soglie: number[] } | null = null
    if (corrId) {
      const [{ data: co }, { data: ll }] = await Promise.all([
        admin.from('corrieri').select('settings').eq('id', corrId).maybeSingle(),
        admin.from('listini_corrieri').select('id,fattore_volume').eq('master_id', masterId).eq('corriere_id', corrId),
      ])
      const listini = (ll || []) as any[]
      const { data: ff } = listini.length
        ? await admin.from('listini_corrieri_fasce').select('peso_max').in('listino_id', listini.map(l => l.id))
        : { data: [] }
      const soglie = Array.from(new Set(((ff || []) as any[]).map(f => Number(f.peso_max)).filter(n => n > 0))).sort((a, b) => a - b)
      c = { settings: (co as any)?.settings || {}, divisore: Number(listini[0]?.fattore_volume) || 5000, soglie }
    }
    contratti.set(nome, c)
    return c
  }

  for (const e of esiti) {
    if (!e.trovata || !e.spedizioneId) continue
    const s = sped.get(e.spedizioneId)
    const corr: any = Array.isArray(s?.corrieri) ? s.corrieri[0] : s?.corrieri
    const nome = String(corr?.nome_contratto || '')
    if (!DI_POSTE.test(nome)) continue
    const c = await contrattoDi(nome)
    if (!c) continue
    const colliFile = (e.colli_ripesati || []) as any[]
    const reale = colliFile.reduce((a, p) => a + (Number(p.weight) || 0), 0)
    const volFile = colliFile.reduce((a, p) => a + (Number(p.length) || 0) * (Number(p.width) || 0) * (Number(p.height) || 0), 0) / c.divisore
    // Il peso che il file fa pagare: quello che il motore usera' per la fascia (il reale se il collo del file
    // sta nell'agevolazione, altrimenti il maggiore col volume; senza misure nel file e' il peso scritto).
    const pesoFile = pesoSuReale(c.settings, colliFile, reale) ? reale : Math.max(reale, volFile)
    // PIU' COLLI: OneTracking misura il pacco, non i colli. Sui 157 multicollo Poste Express M rettificati fino al 05/11
    // ha una lettura sola su 15 (esito 'multicollo') e il portale filiali nessuna: non c'e' una misura collo per collo da
    // mettere accanto al file, quindi non si decide niente.
    if ((Number(s?.colli) || 1) > 1 || colliFile.length > 1) {
      out.set(e.idOrdine, { esito: 'non_verificabile', motivo: 'Più colli: Poste misura il pacco, non i singoli colli', peso_file: pesoFile })
      continue
    }
    const m = misure.get(e.spedizioneId)
    if (!m) {
      out.set(e.idOrdine, { esito: 'senza_misura', motivo: 'Spedizione non misurata da Poste', peso_file: pesoFile })
      continue
    }
    const fascia = (x: number) => {
      const f = c.soglie.find(t => x <= t + 1e-9)
      return f ?? (c.soglie.length ? Infinity : x)
    }
    const tutte = [m, ...(Array.isArray(m.righe) ? m.righe : [])]
      .map((l: any) => ({ peso: Number(l.peso) || 0, lunghezza: Number(l.lunghezza) || 0, larghezza: Number(l.larghezza) || 0, altezza: Number(l.altezza) || 0, dove: l.dove ?? l.filiale ?? null, quando: l.quando ?? l.misurata_il ?? null }))
      // LETTURE CHE NON SONO MISURE: "43×33×1 cm" e' la lettura principale di 14.117 pacchi in 68 filiali, con 0,08 kg di
      // media — un valore di comodo, non una misura; e ci sono 1×1×1 cm a 99 kg, 15×1,5×0,5 cm a 14 kg. Un lato di un
      // centimetro e mezzo o meno vuol dire che la lettura non e' buona: non si usa ne' per il peso ne' per il volume.
      // Le letture senza lati (0×0×0) restano, per il solo peso.
      .filter(l => !([l.lunghezza, l.larghezza, l.altezza].some(x => x > 0) && Math.min(l.lunghezza, l.larghezza, l.altezza) <= 1.5))
    // UNA LETTURA SERVE SOLO SE HA PESO E TUTTI E TRE I LATI. Col solo peso il volume non si conosce, e un pacco grande e
    // leggero lo si fermerebbe come "peso sbagliato" senza prova: fino al 05/11 sono 80 rettifiche Poste Express M con la
    // lettura principale senza lati (e 253 senza peso). Col solo peso si puo' dire una cosa sola: se il file non supera la
    // fascia del peso pesato da Poste, il fornitore non ha chiesto troppo.
    const letture = tutte.filter(l => l.peso > 0 && l.lunghezza > 0 && l.larghezza > 0 && l.altezza > 0)
    if (!letture.length) {
      const pesate = tutte.filter(l => l.peso > 0)
      if (!pesate.length) {
        out.set(e.idOrdine, { esito: 'senza_misura', motivo: 'Spedizione non misurata da Poste', peso_file: pesoFile })
        continue
      }
      const piuPesante = pesate.reduce((a, b) => (b.peso > a.peso ? b : a))
      const nonSupera = c.soglie.length ? fascia(pesoFile) <= fascia(piuPesante.peso + 0.2) : pesoFile <= piuPesante.peso * 1.1 + 0.2
      out.set(e.idOrdine, nonSupera
        ? { esito: 'buona', motivo: 'Il peso del file non supera quello pesato da Poste', peso_file: Math.round(pesoFile * 100) / 100, peso_onetracking: piuPesante.peso, misura: { ...piuPesante } }
        : { esito: 'non_verificabile', motivo: 'Poste ha pesato il pacco ma non ne ha misurato i lati: il volume non si può verificare', peso_file: Math.round(pesoFile * 100) / 100, peso_onetracking: piuPesante.peso, misura: { ...piuPesante } })
      continue
    }
    // I LATI SI ARROTONDANO AL CENTIMETRO SOPRA, come fa il fornitore: 3UW1UHA267901 misurato 61,5×41,5×19,5 cm fa 9,95 kg
    // di volume (fascia fino a 10), il file dice 10,21 — e con 62×42×20 sono 10,42. Senza arrotondare lo si fermava a torto.
    // Anche la scatola dell'agevolazione si guarda sui lati arrotondati: in dubbio, si da' ragione al fornitore.
    const conti = letture.map(l => {
      const L = Math.ceil(l.lunghezza - 1e-9), W = Math.ceil(l.larghezza - 1e-9), H = Math.ceil(l.altezza - 1e-9)
      const volume = L * W * H / c.divisore
      const agevolata = pesoSuReale(c.settings, [{ length: L, width: W, height: H }], l.peso)
      return { l, volume, agevolata, giusto: agevolata ? l.peso : Math.max(l.peso, volume) }
    })
    // IL PESO PESATO DA POSTE CONTA SEMPRE, anche in una lettura senza lati: 3UW1UHA259494 ha la lettura principale a
    // 4,05 kg senza lati — il peso del file — e in un altro hub una "0,05 kg 43×33×1 cm". Senza questa riga si fermava
    // sulla seconda. Poste non tassa mai sotto il peso che ha pesato, quindi una lettura col solo peso alza il minimo.
    for (const l of tutte.filter(x => x.peso > 0 && !(x.lunghezza > 0 && x.larghezza > 0 && x.altezza > 0))) {
      conti.push({ l, volume: 0, agevolata: false, giusto: l.peso })
    }
    const migliore = conti.reduce((a, b) => (b.giusto > a.giusto ? b : a))
    // MARGINE SULLA BILANCIA: lo stesso pacco pesa 0,9 kg a Civitanova e 1 kg a Bologna. Il file si ferma solo se supera
    // la fascia anche con 0,2 kg in piu' sul peso di Poste (3UW1UHA249134: 1,95 kg a Trapani, file 2,11: non si ferma).
    // Senza fasce nel listino si confrontano i chili, con un margine per gli arrotondamenti del fornitore.
    const MARGINE_KG = 0.2
    const sopra = c.soglie.length ? fascia(pesoFile) > fascia(migliore.giusto + MARGINE_KG) : pesoFile > migliore.giusto * 1.1 + MARGINE_KG
    // Se il peso piu' alto viene da una lettura senza lati, i lati da mostrare sono quelli della lettura completa piu'
    // grande: "1,15 kg, 0×0×0 cm" non dice niente a chi deve contestare.
    const conLati = conti.filter(k => k.l.lunghezza > 0).reduce((a: any, b: any) => (!a || b.volume > a.volume ? b : a), null)
    const latiDa = migliore.l.lunghezza > 0 ? migliore.l : (conLati?.l || migliore.l)
    const misura = { peso: migliore.l.peso, lunghezza: latiDa.lunghezza, larghezza: latiDa.larghezza, altezza: latiDa.altezza, dove: migliore.l.dove, quando: migliore.l.quando }
    const base = { peso_file: Math.round(pesoFile * 100) / 100, peso_onetracking: Math.round(migliore.giusto * 100) / 100, misura }
    if (!sopra) { out.set(e.idOrdine, { esito: 'buona', motivo: 'Il peso del file è quello misurato da Poste', ...base }); continue }
    const fasciaTxt = (x: number) => (Number.isFinite(fascia(x)) ? `fascia fino a ${fascia(x)} kg` : 'oltre l\'ultima fascia')
    // Il file si spiega col volume di una delle letture, ma OneTracking dice che il pacco sta nell'agevolazione: si
    // doveva pagare il reale. Il volume si cerca su TUTTE le letture: 3UW1UHA256121 (0,5 kg) fa 1,99 kg di volume
    // nella lettura col peso piu' alto e 2,28 kg — quello del file — in un'altra.
    if (migliore.agevolata && conti.some(k => fascia(pesoFile) <= fascia(Math.max(k.l.peso, k.volume)))) {
      out.set(e.idOrdine, {
        esito: 'senza_agevolazione', ...base,
        motivo: `Misura di Poste: ${kg(misura.peso)}, ${lati(misura)}${misura.dove ? ` (${misura.dove})` : ''} — collo singolo nella scatola ${descriviAgevolazione(c.settings)}`
          + `${Number(c.settings?.agevolazione_peso_max) > 0 ? ` e fino a ${c.settings.agevolazione_peso_max} kg` : ''}: si paga il peso reale, ${fasciaTxt(misura.peso)}. `
          + `Il file fa pagare ${kg(pesoFile)}, cioè il volume: ${fasciaTxt(pesoFile)}.`,
      })
      continue
    }
    out.set(e.idOrdine, {
      esito: 'peso_sbagliato', ...base,
      motivo: `Misura di Poste: ${kg(misura.peso)}, ${lati(misura)}${misura.dove ? ` (${misura.dove})` : ''}, tassabile ${kg(migliore.giusto)} (${fasciaTxt(migliore.giusto)}). `
        + `Il file fa pagare ${kg(pesoFile)}: ${fasciaTxt(pesoFile)}.`,
    })
  }
  return out
}

// LA LETTURA DI POSTE SU CUI SI PUO' FAR PAGARE (motore automatico, app/api/tracking/ripesature-auto). Lorenzo, 05/11/2026.
// Il motore prendeva la lettura che il Mac salva in cima, anche quando e' finta: 3UW1UHA322721 ha «11,65 kg, 1,5×1×0,5 cm»
// a Napoli 1 alle 18:20 e «0,24 kg, 23,5×10×10 cm» all'Hub Napoli alle 20:11; il 01/11 al cliente sono stati chiesti 3,91 €
// come per 11,65 kg. Dal 07/08 cosi' circa 260 rettifiche di MULTI e 61 di Wave (Lorenzo: si lasciano come sono).
// CORREZIONE MINIMA, decisa con Lorenzo: la lettura in cima resta quella di sempre quando e' buona; se ha un lato di un
// centimetro e mezzo o meno (stessa regola del controllo qui sopra) si usa, fra le altre letture complete e buone, quella
// su cui Poste tassa di piu'; se non ce n'e' nessuna, non si fa pagare niente (null).
export function letturaPerIlMotore(m: any): { peso: number; lunghezza: number; larghezza: number; altezza: number; dove?: string; quando?: string } | null {
  if (!m) return null
  const leggi = (x: any, dove?: string, quando?: string) => ({ peso: Number(x?.peso) || 0, lunghezza: Number(x?.lunghezza) || 0, larghezza: Number(x?.larghezza) || 0, altezza: Number(x?.altezza) || 0, dove, quando })
  const finta = (l: any) => [l.lunghezza, l.larghezza, l.altezza].some((x: number) => x > 0 && x <= 1.5)
  const cima = leggi(m, m.filiale, m.misurata_il)
  if (!finta(cima)) return cima
  const buone = (Array.isArray(m.righe) ? m.righe : []).map((x: any) => leggi(x, x?.dove, x?.quando))
    .filter((l: any) => l.peso > 0 && l.lunghezza > 0 && l.larghezza > 0 && l.altezza > 0 && !finta(l))
  if (!buone.length) return null
  const tassato = (l: any) => Math.max(l.peso, Math.ceil(l.lunghezza - 1e-9) * Math.ceil(l.larghezza - 1e-9) * Math.ceil(l.altezza - 1e-9) / 5000)
  return buone.reduce((a: any, b: any) => (tassato(b) > tassato(a) ? b : a))
}

// LO STESSO CONTROLLO SULLE RIGHE GIA' SCRITTE: le rettifiche nate prima che il controllo fosse acceso (alla Conferma e
// per lo storico). I colli sono quelli della riga, cioe' quello che diceva il file del fornitore.
export async function controllaRighe(admin: any, masterId: string, righe: any[]): Promise<Map<string, Controllo>> {
  const esiti = righe.filter(r => r?.spedizione_id).map(r => ({
    trovata: true, spedizioneId: r.spedizione_id, idOrdine: r.id, ldv: r.numero_spedizione,
    colli_ripesati: Array.isArray(r.colli_ripesati) ? r.colli_ripesati : [], livelli: [],
  })) as any[]
  return controllaConOneTracking(admin, masterId, esiti)
}

// Il riepilogo per chi carica: quante buone, quante ferme e perche'. I conti sono sui PACCHI del file controllati;
// "ferme" e "nonGirato" sulle righe che sono nate davvero in contestazione (le altre non avevano niente da chiedere).
export function riepilogoControllo(controlli: Map<string, Controllo>, esiti: EsitoRipesatura[], righeScritte: any[]) {
  const conta = { buone: 0, senzaAgevolazione: 0, pesoSbagliato: 0, senzaMisura: 0, nonVerificabili: 0 }
  for (const [, c] of controlli) {
    if (c.esito === 'buona') conta.buone++
    else if (c.esito === 'senza_agevolazione') conta.senzaAgevolazione++
    else if (c.esito === 'peso_sbagliato') conta.pesoSbagliato++
    else if (c.esito === 'senza_misura') conta.senzaMisura++
    else conta.nonVerificabili++
  }
  const ferme = righeScritte.filter(r => r.stato === 'in_contestazione')
  const ldvPerOrdine = new Map(esiti.map(e => [e.idOrdine, e.ldv]))
  return {
    ...conta,
    ferme: ferme.length,
    nonGirato: Math.round(ferme.reduce((a, r) => a + Math.max(0, -Number(r.differenza || 0)), 0) * 100) / 100,
    esempi: ferme.slice(0, 5).map(r => ({ ldv: ldvPerOrdine.get(r.rif_fornitore) || r.numero_spedizione, esito: r.controllo?.esito, motivo: r.controllo?.motivo })),
  }
}
