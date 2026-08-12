import { fetchAll } from '@/lib/fetch-all'
import { mappaPrimaLinea } from '@/lib/prima-linea'

// Sposta nella SOSTA (`cod_da_caricare`) i contrassegni delle rimesse ACCETTATE, già divisi per
// destinatario (cliente diretto o prima linea del sotto-master). È la stessa cosa per TUTTI i master
// (MULTIEXPRESS, Ecomize Solution, Ecomize LL…): dopo, dal verde "Contrassegni da caricare", il master
// sceglie A CHI e QUANDO far scendere i soldi. Qui NON si muove denaro: si consolida e basta.
//
// Estratta da /api/contrassegni/carica-ricevute così può essere richiamata anche dall'ACCETTAZIONE:
// accettare una rimessa la porta subito nel verde consolidato, senza il passaggio intermedio giallo
// (che confondeva — un sotto-master vedeva le rimesse spezzate per numero invece che unite per cliente).
export async function caricaRimesseInSosta(
  admin: any, mio: string, distintaIds: string[]
): Promise<{ rimesseCaricate: number; inAttesa: number; giaCaricate: number; senzaDestinatario: number }> {
  if (!distintaIds.length) return { rimesseCaricate: 0, inAttesa: 0, giaCaricate: 0, senzaDestinatario: 0 }

  // CLAIM ATOMICO: marco SUBITO caricata_target=true con le condizioni nel WHERE e lavoro solo sulle
  // righe ritornate. Due carichi concorrenti non possono caricare la stessa rimessa due volte.
  const { data: ricevute } = await admin.from('distinte_contrassegni')
    .update({ caricata_target: true, caricata_target_at: new Date().toISOString() })
    .in('id', distintaIds)
    .eq('target_master_id', mio).eq('accettata_target', true).eq('caricata_target', false)
    .select('id,numero')
  if (!ricevute?.length) return { rimesseCaricate: 0, inAttesa: 0, giaCaricate: 0, senzaDestinatario: 0 }
  const ricevuteIds = ricevute.map((r: any) => r.id)
  const annullaClaim = async () => {
    try { await admin.from('distinte_contrassegni').update({ caricata_target: false, caricata_target_at: null }).in('id', ricevuteIds) } catch {}
  }

  try {
    const righeRic = await fetchAll(() => admin.from('distinte_contrassegni_righe')
      .select('numero_spedizione').in('distinta_id', ricevuteIds).order('id', { ascending: true }))
    const numeri = Array.from(new Set((righeRic || []).map((r: any) => r.numero_spedizione).filter(Boolean)))
    if (!numeri.length) { await annullaClaim(); throw new Error('Nessuna LDV nelle rimesse selezionate') }

    const spedizioni: any[] = []
    for (let i = 0; i < numeri.length; i += 200) {
      const chunk = await fetchAll(() => admin.from('spedizioni')
        .select('id,master_id,cliente_id,contrassegno,numero')
        .in('numero', numeri.slice(i, i + 200)).gt('contrassegno', 0).order('id', { ascending: true }))
      spedizioni.push(...chunk)
    }
    if (!spedizioni.length) { await annullaClaim(); throw new Error('Spedizioni non trovate') }

    const primaLinea = await mappaPrimaLinea(admin, mio)

    // ANTI-DUPLICATO PER-MASTER: escludo le spedizioni già in una distinta creata da ME.
    const mieDist = await fetchAll(() => admin.from('distinte_contrassegni').select('id').eq('master_id', mio).order('id', { ascending: true }))
    const giaMie = new Set<string>()
    for (let i = 0; i < mieDist.length; i += 200) {
      const mieRighe = await fetchAll(() => admin.from('distinte_contrassegni_righe')
        .select('spedizione_id').in('distinta_id', mieDist.slice(i, i + 200).map((d: any) => d.id)).order('id', { ascending: true }))
      for (const r of mieRighe) if ((r as any).spedizione_id) giaMie.add((r as any).spedizione_id)
    }
    const daCaricare = spedizioni.filter((s: any) => !giaMie.has(s.id))
    const giaCaricate = spedizioni.length - daCaricare.length

    // DUE RAMI: spedizioni MIE → verso il cliente; di un SOTTO-MASTER → verso la sua prima linea.
    const clientiMap: Record<string, any[]> = {}
    const masterMap: Record<string, any[]> = {}
    let senzaDestinatario = 0
    for (const s of daCaricare) {
      if (s.master_id === mio) {
        if (!s.cliente_id) { senzaDestinatario++; continue }
        ;(clientiMap[s.cliente_id] = clientiMap[s.cliente_id] || []).push(s)
      } else {
        const fl = primaLinea.get(s.master_id)
        if (!fl) { senzaDestinatario++; continue }
        ;(masterMap[fl] = masterMap[fl] || []).push(s)
      }
    }

    const inSosta: any[] = []
    for (const [clienteId, sped] of Object.entries(clientiMap)) {
      for (const sp of sped) inSosta.push({ master_id: mio, spedizione_id: sp.id, importo: Number(sp.contrassegno) || 0,
        cliente_id: clienteId, target_master_id: null, origine: 'rimessa', origine_id: ricevuteIds[0] || null })
    }
    for (const [flId, sped] of Object.entries(masterMap)) {
      for (const sp of sped) inSosta.push({ master_id: mio, spedizione_id: sp.id, importo: Number(sp.contrassegno) || 0,
        cliente_id: null, target_master_id: flId, origine: 'rimessa', origine_id: ricevuteIds[0] || null })
    }
    let create = 0
    for (let i = 0; i < inSosta.length; i += 500) {
      const { data: ins } = await admin.from('cod_da_caricare')
        .upsert(inSosta.slice(i, i + 500), { onConflict: 'master_id,spedizione_id', ignoreDuplicates: true })
        .select('id')
      create += (ins || []).length
    }

    return { rimesseCaricate: ricevute.length, inAttesa: create, giaCaricate, senzaDestinatario }
  } catch (e) {
    await annullaClaim()
    throw e
  }
}
