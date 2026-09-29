// IL CONTO DEL CORRIERE, RICONCILIATO DA SOLO.
//
// Oltre alle ripesature — che arrivano col file e hanno gia' la loro strada — il corriere addebita
// due cose che finora non registrava nessuno: il RESO (una riga per ogni ritorno) e l'APERTURA
// GIACENZA. Quei soldi escono davvero dal conto di chi detiene il contratto.
//
// Il guasto che questo file ripara: chi apre una giacenza incassava dalla rete senza mai pagare il
// corriere. Nei margini il detentore sembrava guadagnare tutto l'incasso, mentre una parte non fa
// che coprire il conto. Dal 2/07 al 29/09/2026 erano 2.795,09 EUR di resi e 313,95 di giacenze che
// non stavano scritti da nessuna parte. Il recupero c'e' gia' (le code degli addebiti girano la
// spesa a valle): mancava la spesa.
//
// SI PUO' RIFARE QUANTE VOLTE SI VUOLE. Il conto e' cumulativo e questo giro rilegge sempre le
// stesse righe: a impedire il doppio addebito e' l'indice unico sul riferimento
// (movimenti_un_costo_fornitore_per_master), non l'ordine in cui girano le cose.
import { registraMovimentoMaster } from '@/lib/movimenti'

const BASE = 'https://core.spediamopro.com/api/v2'

type RigaConto = { id?: number | string; reason: string; amount: number; createdAt?: string }

// Le due voci che ci interessano. Il codice e' quello del corriere (raw_response.code), non la
// lettera di vettura: "Reso spedizione: 6A..." e "Giacenza spedizione #6A...".
const VOCI: { tipo: 'reso' | 'giacenza'; re: RegExp; prefisso: string; testo: (ldv: string, eur: string) => string }[] = [
  {
    tipo: 'reso', re: /^\s*reso spedizione\s*[:#]/i, prefisso: 'RESOFORN',
    testo: (ldv, eur) => `Reso ${ldv} - costo addebitato dal corriere €${eur}`,
  },
  {
    tipo: 'giacenza', re: /^\s*giacenza spedizione\s*[:#]/i, prefisso: 'GIACFORN',
    testo: (ldv, eur) => `Apertura giacenza ${ldv} - costo addebitato dal corriere €${eur}`,
  },
]

const codiceDi = (t: string) => (String(t).match(/[:#]\s*([0-9A-Za-z]*\d[0-9A-Za-z]{7,})/) || [])[1] || null

async function token(authcode: string): Promise<string | null> {
  const r = await fetch(`${BASE}/auth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${authcode}:`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const j: any = await r.json().catch(() => null)
  return j?.access_token || null
}

// Le righe del conto, dalla piu' recente. `pagine` limita quanto si va indietro: al giro di ogni
// giorno bastano poche pagine (il conto fa ~1.100 righe al giorno), per un recupero di arretrato si
// alza e basta.
async function leggiConto(authcode: string, pagine: number): Promise<RigaConto[]> {
  const tk = await token(authcode)
  if (!tk) return []
  const out: RigaConto[] = []
  for (let p = 1; p <= pagine; p++) {
    const r = await fetch(`${BASE}/wallet/transactions/search?page=${p}&perPage=100`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    })
    if (!r.ok) break
    const j: any = await r.json().catch(() => null)
    const righe = j?.data || []
    out.push(...righe)
    if (righe.length < 100) break
  }
  return out
}

export type EsitoRiconciliazione = { lette: number; costi: number; scritti: number; euro: number; senzaSpedizione: number; inAttesa: number }

export async function riconciliaCostiConto(admin: any, opts: { pagine?: number; createdBy?: string | null } = {}): Promise<EsitoRiconciliazione> {
  const esito: EsitoRiconciliazione = { lette: 0, costi: 0, scritti: 0, euro: 0, senzaSpedizione: 0, inAttesa: 0 }

  // CHI PAGA IL CONTO E' CHI POSSIEDE IL CONTRATTO. Le credenziali sono le sue: i master che lo
  // rivendono usano la stessa chiave ma il conto non e' il loro. Una chiave = un pagatore.
  const { data: corr } = await admin.from('corrieri').select('master_id,credenziali,proprio').eq('tipo', 'spediamopro')
  const perChiave = new Map<string, string>()
  for (const c of (corr || [])) {
    const auth = (c as any)?.credenziali?.authcode
    if (!auth) continue
    if ((c as any).proprio || !perChiave.has(auth)) perChiave.set(auth, (c as any).master_id)
  }

  for (const [authcode, pagatore] of perChiave) {
    const righe = await leggiConto(authcode, Math.max(1, opts.pagine || 30))
    esito.lette += righe.length

    const costi: { tipo: string; prefisso: string; code: string; euro: number; riga: string; quando?: string; testo: (ldv: string, eur: string) => string }[] = []
    for (const m of righe) {
      const t = String(m?.reason || '')
      const voce = VOCI.find(v => v.re.test(t))
      if (!voce) continue
      const code = codiceDi(t)
      const euro = Math.abs(Number(m?.amount || 0)) / 100
      if (!code || !(euro > 0) || !m?.id) continue
      costi.push({ tipo: voce.tipo, prefisso: voce.prefisso, code, euro, testo: voce.testo, riga: String(m.id), quando: m.createdAt })
    }
    esito.costi += costi.length
    if (!costi.length) continue

    // La spedizione serve per agganciare il movimento (e per scrivere la lettera di vettura, che e'
    // quello che una persona riconosce).
    const sped = new Map<string, { id: string; numero: string }>()
    const codici = Array.from(new Set(costi.map(c => c.code)))
    for (let i = 0; i < codici.length; i += 200) {
      const { data } = await admin.from('spedizioni')
        .select('id,numero,code:raw_response->>code').in('raw_response->>code', codici.slice(i, i + 200))
      for (const s of (data || [])) if ((s as any).code) sped.set((s as any).code, { id: (s as any).id, numero: (s as any).numero })
    }

    // ── SI SCALA SOLO QUELLO CHE MANCA ──
    //
    // Il flusso dei resi e delle giacenze addebita GIA' al detentore il suo nolo per la stessa cosa
    // (movimento reso/giacenza con master_target_id = lui, e registra_movimento_master scala il
    // conto del TARGET). Registrando qui il costo per intero la spesa risultava DOPPIA: il
    // 29/09/2026 sono stati scalati 2.473,24 EUR di troppo a MULTIEXPRESS, stornati subito.
    // Si scala la DIFFERENZA fra quello che chiede il corriere e quello che il detentore ha gia'
    // pagato — che e' esattamente il supplemento che il corriere mette sul ritorno.
    const SETTIMANA = 7 * 24 * 60 * 60 * 1000
    const giaAddebitato = new Map<string, number>()
    {
      const idSped = Array.from(new Set(costi.map(c => sped.get(c.code)?.id).filter(Boolean))) as string[]
      for (let k = 0; k < idSped.length; k += 200) {
        const { data } = await admin.from('movimenti').select('spedizione_id,tipo,importo')
          .in('spedizione_id', idSped.slice(k, k + 200)).in('tipo', ['reso', 'giacenza'])
          .eq('master_target_id', pagatore)
        for (const m of (data || [])) {
          const key = `${(m as any).spedizione_id}|${(m as any).tipo}`
          giaAddebitato.set(key, (giaAddebitato.get(key) || 0) + Math.abs(Number((m as any).importo || 0)))
        }
      }
    }

    // QUATTRO ALLA VOLTA: qui si muove credito e tutte queste righe scalano lo stesso conto.
    let i = 0
    await Promise.all(Array.from({ length: Math.min(4, costi.length) }, async () => {
      while (i < costi.length) {
        const c = costi[i++]
        const s = sped.get(c.code)
        if (!s) { esito.senzaSpedizione++; continue }
        const gia = giaAddebitato.get(`${s.id}|${c.tipo}`) || 0
        const daScalare = Math.round((c.euro - gia) * 100) / 100
        if (daScalare < 0.01) {
          // Il detentore ha gia' pagato almeno quanto gli chiede il corriere: niente da aggiungere.
          // Se non ha pagato NULLA ed e' roba fresca, si aspetta il nostro addebito e si riprova al
          // giro dopo (il conto e' cumulativo).
          if (gia <= 0 && c.quando && Date.now() - new Date(c.quando).getTime() < SETTIMANA) esito.inAttesa++
          continue
        }
        try {
          await registraMovimentoMaster(admin, {
            masterOwnerId: pagatore, masterTargetId: pagatore, tipo: 'rettifica',
            descrizione: gia > 0
              ? `${c.testo(s.numero, c.euro.toFixed(2))} — gia' conteggiati €${gia.toFixed(2)} nel nolo, si scala la differenza`
              : c.testo(s.numero, c.euro.toFixed(2)),
            // IL RIFERIMENTO E' LA RIGA DEL CONTO, NON LA SPEDIZIONE. Lo stesso pacco puo' andare in
            // giacenza due volte (24 casi nel conto: due aperture in date diverse, 0,99 EUR
            // ciascuna): con la spedizione come chiave la seconda non si scalerebbe mai, e non solo
            // oggi — per sempre. L'id della riga del conto e' suo e non cambia.
            riferimento: `${c.prefisso}-${c.riga}`,
            importo: -Math.abs(daScalare),
            spedizioneId: s.id, createdBy: opts.createdBy ?? null,
          })
          esito.scritti++; esito.euro += daScalare
        } catch (err: any) {
          // Gia' scalato da un giro precedente: e' il comportamento voluto, non un guasto.
          const m = String(err?.message || '')
          if (!/23505|duplicate key|unique constraint/i.test(m)) console.error('[CONTO] costo non scalato', c.code, m)
        }
      }
    }))
  }
  return esito
}
