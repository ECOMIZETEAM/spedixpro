// CONTROLLO PORTALE ↔ GLS, OGNI NOTTE.
//
// Il portale e GLS possono raccontare due storie diverse della stessa spedizione, e nessuno se ne
// accorge finché il cliente non chiama. Il 17/11/2026, su circa 4.800 spedizioni GLS di un mese:
// - 10 valide e pagate sul portale ma cancellate su GLS. Quasi tutte di DOLCE LUNA (Wave): il secondo
//   pacco allo stesso destinatario faceva cancellare da noi il primo (corretto il 16/11);
// - NI665682165 (MSM STUDIO), annullata e rimborsata sul portale, su GLS chiusa e in viaggio verso Foggia.
// Wave lo ha scoperto confrontando a mano l'elenco di Weblabeling con il portale.
//
// Qui si legge il registro di ogni conto GLS (lib/gls registroSpedizioniGls, sola lettura), giorno per
// giorno, e lo si confronta con le spedizioni del portale nate sugli stessi conti. Quelle che non
// tornano finiscono in `gls_disallineamenti` e le vede il master che DETIENE il contratto (Lorenzo
// 17/11: "devono arrivare al master che detiene il contratto"), in Spedizioni Cancellate. Non si
// rimborsa e non si annulla niente da soli: decide lui.
import { registroSpedizioniGls, giornoGls, type CredenzialiGls } from '@/lib/gls'

// Annullo chiesto e non ancora concluso: la spedizione è in mezzo al guado, non è un disallineamento.
const IN_ANNULLO = new Set(['annullamento_pending', 'annullamento_manuale', 'storno_richiesto'])

export type DisallineamentoGls = {
  spedizione_id: string
  master_id: string            // detentore del contratto
  tipo: 'cancellata_su_gls' | 'viva_su_gls'
  stato_gls: string | null
  tracking_number: string
}

export type EsitoRiconciliazioneGls = {
  conti: number
  contiNonLeggibili: { conto: string; motivo: string }[]
  controllate: number
  trovate: DisallineamentoGls[]
  nuove: number
  riaperte: number
  ancoraAperte: number
  riallineate: number
}

export async function riconciliaContiGls(
  admin: any, opz: { giorni?: number; scrivi?: boolean } = {},
): Promise<EsitoRiconciliazioneGls> {
  const giorni = Math.max(1, Math.min(35, opz.giorni ?? 14))
  const esito: EsitoRiconciliazioneGls = { conti: 0, contiNonLeggibili: [], controllate: 0, trovate: [], nuove: 0, riaperte: 0, ancoraAperte: 0, riallineate: 0 }

  const { data: corrieri } = await admin.from('corrieri')
    .select('id,master_id,nome_contratto,credenziali,masters(nome)').eq('tipo', 'gls')
  const { data: masters } = await admin.from('masters').select('id,parent_master_id')
  const padreDi = new Map<string, string | null>((masters || []).map((m: any) => [m.id, m.parent_master_id]))

  // Un conto GLS = sede + codice cliente. Wave e i suoi sotto-master (SMAV, Spedire semplice) hanno
  // contratti propri sullo STESSO conto: il registro è uno, e il detentore è chi sta più in alto.
  const conti = new Map<string, { cred: CredenzialiGls; corrieri: any[]; nome: string }>()
  for (const c of corrieri || []) {
    const k = (c as any).credenziali || {}
    if (!k.sigla_sede || !k.user_webservice || !k.password_webservice) continue
    const chiave = `${k.sigla_sede}|${k.user_webservice}`
    if (!conti.has(chiave)) conti.set(chiave, { cred: k, corrieri: [], nome: '' })
    conti.get(chiave)!.corrieri.push(c)
  }

  const oggi = new Date()
  const dal = new Date(oggi.getTime() - giorni * 86400000)
  // Il registro da un giorno prima, per le spedizioni nate a cavallo della mezzanotte.
  const giorniRegistro: string[] = []
  for (let i = -(giorni + 1); i <= 0; i++) giorniRegistro.push(giornoGls(oggi, i))

  for (const [, conto] of conti) {
    esito.conti++
    const mastersConto = new Set(conto.corrieri.map((c: any) => c.master_id))
    conto.nome = Array.from(new Set(conto.corrieri.map((c: any) => c.masters?.nome).filter(Boolean))).join(', ')
    // Detentore di ogni contratto del conto: l'antenato più alto che ha anch'esso un contratto sul conto.
    const detentoreDi = new Map<string, string>()
    for (const c of conto.corrieri) {
      let det = c.master_id, cur: string | null = c.master_id
      for (let i = 0; i < 20 && cur; i++) {
        cur = padreDi.get(cur) ?? null
        if (cur && mastersConto.has(cur)) det = cur
      }
      detentoreDi.set(c.id, det)
    }

    // Registro GLS, quattro giorni per volta: tutti insieme sarebbero quindici chiamate di colpo.
    const registro = new Map<string, { stato: string; data: string }>()
    let leggibile = true
    for (let i = 0; i < giorniRegistro.length && leggibile; i += 4) {
      const r = await registroSpedizioniGls(conto.cred, giorniRegistro.slice(i, i + 4))
      if (!r.ok) { leggibile = false; esito.contiNonLeggibili.push({ conto: conto.nome, motivo: r.motivo }); break }
      for (const [n, v] of r.spedizioni) registro.set(n, v)
    }
    if (!leggibile) continue

    // Le nostre, nate nella finestra, su tutti i contratti del conto. A pagine ordinate (vedi
    // fetchall senza ordine: pagine instabili) e senza raw_response, che pesa: il numero GLS è nel tracking.
    const nostre: any[] = []
    for (const c of conto.corrieri) {
      for (let da = 0; ; da += 1000) {
        const { data, error } = await admin.from('spedizioni')
          .select('id,tracking_number,stato,corriere_id')
          .eq('corriere_id', c.id).gte('created_at', dal.toISOString())
          .order('created_at').order('id').range(da, da + 999)
        if (error) throw new Error(`lettura spedizioni ${c.nome_contratto}: ${error.message}`)
        nostre.push(...(data || []))
        if (!data || data.length < 1000) break
      }
    }
    esito.controllate += nostre.length

    const trovateConto: DisallineamentoGls[] = []
    for (const s of nostre) {
      const numero = String(s.tracking_number || '').replace(/\D/g, '')
      if (!numero || IN_ANNULLO.has(s.stato)) continue
      const suGls = registro.get(numero)
      const master_id = detentoreDi.get(s.corriere_id) as string
      if (s.stato === 'annullata' && suGls) {
        trovateConto.push({ spedizione_id: s.id, master_id, tipo: 'viva_su_gls', stato_gls: suGls.stato || null, tracking_number: s.tracking_number })
      } else if (s.stato !== 'annullata' && !suGls) {
        trovateConto.push({ spedizione_id: s.id, master_id, tipo: 'cancellata_su_gls', stato_gls: null, tracking_number: s.tracking_number })
      }
    }
    esito.trovate.push(...trovateConto)
    if (!opz.scrivi) continue

    // ── Scrittura: nuove si inseriscono, aperte si aggiornano, quelle che il master ha già segnato
    //    "verificata" restano chiuse (le ha guardate lui), quelle tornate a posto da sole si riaprono
    //    se tornano a non quadrare. ──
    const ora = new Date().toISOString()
    const idsTrovate = trovateConto.map(t => t.spedizione_id)
    const esistenti = new Map<string, any>()
    for (let i = 0; i < idsTrovate.length; i += 300) {
      const { data, error } = await admin.from('gls_disallineamenti')
        .select('spedizione_id,risolta_il,risolta_come').in('spedizione_id', idsTrovate.slice(i, i + 300))
      if (error) throw new Error(`lettura gls_disallineamenti: ${error.message}`)
      for (const r of data || []) esistenti.set(r.spedizione_id, r)
    }
    const daInserire = trovateConto.filter(t => !esistenti.has(t.spedizione_id))
      .map(t => ({ spedizione_id: t.spedizione_id, master_id: t.master_id, tipo: t.tipo, stato_gls: t.stato_gls, rilevata_il: ora, controllata_il: ora }))
    if (daInserire.length) {
      const { error } = await admin.from('gls_disallineamenti').insert(daInserire)
      if (error) throw new Error(`scrittura gls_disallineamenti: ${error.message}`)
      esito.nuove += daInserire.length
    }
    for (const t of trovateConto) {
      const e = esistenti.get(t.spedizione_id)
      if (!e || e.risolta_come === 'verificata') continue
      const riapri = !!e.risolta_il   // era tornata a posto da sola e ora di nuovo no
      const { error } = await admin.from('gls_disallineamenti').update({
        master_id: t.master_id, tipo: t.tipo, stato_gls: t.stato_gls, controllata_il: ora,
        ...(riapri ? { risolta_il: null, risolta_come: null, risolta_da: null, rilevata_il: ora } : {}),
      }).eq('spedizione_id', t.spedizione_id)
      if (error) throw new Error(`aggiornamento gls_disallineamenti: ${error.message}`)
      if (riapri) esito.riaperte++; else esito.ancoraAperte++
    }

    // Aperte di questo conto che stavolta tornano: si chiudono da sole. Solo quelle controllate in
    // questo giro (nate nella finestra): le più vecchie restano finché il master non le guarda.
    const controllateQui = new Set(nostre.map(s => s.id))
    const trovateQui = new Set(idsTrovate)
    const detentori = Array.from(new Set(detentoreDi.values()))
    const { data: aperte, error: eAp } = await admin.from('gls_disallineamenti')
      .select('spedizione_id').in('master_id', detentori).is('risolta_il', null)
    if (eAp) throw new Error(`lettura aperte: ${eAp.message}`)
    const tornate = (aperte || []).map((r: any) => r.spedizione_id).filter((id: string) => controllateQui.has(id) && !trovateQui.has(id))
    for (let i = 0; i < tornate.length; i += 300) {
      const { error } = await admin.from('gls_disallineamenti')
        .update({ risolta_il: ora, risolta_come: 'riallineata' }).in('spedizione_id', tornate.slice(i, i + 300)).is('risolta_il', null)
      if (error) throw new Error(`chiusura riallineate: ${error.message}`)
    }
    esito.riallineate += tornate.length
  }
  return esito
}
