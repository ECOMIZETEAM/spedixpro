// Legge la GRIGLIA COMPLETA di un listino (per il preventivo): per ogni corriere, le fasce con il
// prezzo PER ZONA (Italia, SCS, Zone Disagiate, Isole…) + i supplementi. Usato dall'anteprima
// dell'editor e dalla pagina pubblica del preventivo, cosi' mostrano gli stessi numeri del listino.

function fmtSupplemento(s: any): { nome: string; dettaglio: string } {
  let d: any = s.descrizione
  if (typeof d === 'string') { try { d = JSON.parse(d) } catch { d = {} } }
  d = d || {}
  const parti: string[] = []
  const perc = Number(d.perc ?? 0)
  const fisso = Number(d.prezzo_fisso ?? s.valore ?? 0)
  if (perc > 0) parti.push(`${perc}%`)
  if (fisso > 0) parti.push(`€ ${fisso.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  if (d.prezzo_kg) parti.push(`€ ${Number(d.prezzo_kg).toFixed(2)}/kg`)
  const nome = s.nome || ({ contrassegno: 'Contrassegno', assicurazione: 'Assicurazione', sponda: 'Sponda idraulica', accessorio: 'Servizio accessorio' } as any)[s.tipo] || s.tipo || 'Supplemento'
  return { nome, dettaglio: parti.join(' — ') || (d.calcolo_su ? `su ${d.calcolo_su}` : '') }
}

export async function leggiGrigliaListino(admin: any, listinoId: string) {
  if (!listinoId) return { corrieri: [] as any[] }
  const [{ data: lcc }, { data: fasce }, { data: supp }] = await Promise.all([
    admin.from('listini_clienti_corrieri').select('corriere_id, corrieri(nome_contratto)').eq('listino_id', listinoId),
    admin.from('listini_clienti_fasce').select('corriere_id, peso_max, prezzo, tipo, zona_id, zone(nome)').eq('listino_id', listinoId).order('peso_max'),
    admin.from('listini_clienti_supplementi').select('corriere_id, tipo, descrizione, valore, tipo_calcolo, nome').eq('listino_id', listinoId),
  ])

  const nomeCorr = new Map<string, string>()
  for (const c of (lcc || [])) nomeCorr.set(c.corriere_id, (c as any).corrieri?.nome_contratto || 'Corriere')

  // Per corriere: zone (ordine di prima apparizione) + fasce (tipo+peso) con prezzi per zona.
  type Corr = { corriere_id: string; nome: string; zone: string[]; fasce: { label: string; peso: number; tipo: string; prezzi: Record<string, number> }[]; supplementi: { nome: string; dettaglio: string }[] }
  const corr = new Map<string, Corr>()
  const getCorr = (cid: string) => {
    if (!corr.has(cid)) corr.set(cid, { corriere_id: cid, nome: nomeCorr.get(cid) || 'Corriere', zone: [], fasce: [], supplementi: [] })
    return corr.get(cid)!
  }
  const fasciaKey = (f: any) => `${f.tipo === 'oltre' ? 'oltre' : 'fino_a'}_${Number(f.peso_max)}`
  const idxFascia = new Map<string, number>()   // "cid|key" -> index in c.fasce

  for (const f of (fasce || [])) {
    const c = getCorr(f.corriere_id)
    const zona = (f as any).zone?.nome || 'Italia'
    if (!c.zone.includes(zona)) c.zone.push(zona)
    const key = `${f.corriere_id}|${fasciaKey(f)}`
    let i = idxFascia.get(key)
    if (i === undefined) {
      i = c.fasce.length
      idxFascia.set(key, i)
      c.fasce.push({ label: f.tipo === 'oltre' ? `oltre ${Number(f.peso_max)} kg` : `fino a ${Number(f.peso_max)} kg`, peso: Number(f.peso_max), tipo: f.tipo === 'oltre' ? 'oltre' : 'fino_a', prezzi: {} })
    }
    const pr = Number(f.prezzo)
    if (isFinite(pr)) c.fasce[i].prezzi[zona] = pr
  }
  for (const s of (supp || [])) getCorr(s.corriere_id).supplementi.push(fmtSupplemento(s))

  // Ordina le fasce (fino_a per peso, oltre in fondo) e le zone (Italia prima).
  const out = Array.from(corr.values()).map(c => ({
    ...c,
    zone: [...c.zone].sort((a, b) => a === 'Italia' ? -1 : b === 'Italia' ? 1 : a.localeCompare(b)),
    fasce: [...c.fasce].sort((a, b) => a.tipo === 'oltre' ? 1 : b.tipo === 'oltre' ? -1 : a.peso - b.peso),
  }))
  return { corrieri: out }
}
