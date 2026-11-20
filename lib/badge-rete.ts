// CONTEGGI PER I DUE BADGE DELLA RETE (pollati dalla sidebar come assistenza/logistica).
//  - daAccettare : cosa aspetta una DECISIONE nel "Dal mio network" (rettifiche/contrassegni/resi
//                  ricevuti dal livello di sopra e non ancora accettati). Finché nessuno lo vede,
//                  resta parcheggiato in silenzio: è il motivo per cui centinaia di rettifiche non
//                  arrivavano mai al cliente. Il badge lo rende visibile — la decisione resta al master.
//  - daConfermare: rettifiche MIE ancora in attesa nella "Rettifica Costi" (propagate/caricate ma mai
//                  confermate → il credito del destinatario NON è ancora stato scalato). È il secondo
//                  passo che si lasciava a metà.
// Solo conteggi (head:true) + due somme leggere sul solo insieme del master: nessun dato pesante,
// adatto a un poll ogni 30s. `adminDb` e' il client di servizio: le righe con target=mio le possiede
// il padre e la RLS non le mostrerebbe. L'autorizzazione (il master della sessione, staff di rete) la
// fa la rotta PRIMA di chiamare qui, esattamente come /api/network/ricevuti.
//
// TRE DOMANDE INDIPENDENTI, IN PARALLELO.
// Le letture andavano una dietro l'altra: per il master con 3.706 rettifiche da accettare (20/10/2026)
// erano 4 pagine + 10 blocchi di figlie + 3 conteggi = 17 viaggi al database in fila, a ogni giro di
// 30 secondi di ogni sua scheda aperta — e' da li' che veniva il p95 di 540 ms della rotta. Le tre
// domande (rettifiche da accettare, contrassegni+resi da accettare, rettifiche da confermare) non
// dipendono l'una dall'altra, e i blocchi delle figlie nemmeno fra loro: partono insieme. Le domande
// sono le stesse di prima, una per una, e la risposta e' identica: provato su master veri, vecchio
// contro nuovo, prima del rilascio.
export async function contaBadgeRete(adminDb: any, mio: string) {
  // ── DA ACCETTARE (Dal mio network) ──
  // Rettifiche ricevute, confermate dal livello sopra (mi è già stato scalato), ancora da decidere.
  // Escludo quelle che HANNO già una figlia (propagate a metà da un giro interrotto): non sono "da
  // decidere", darebbero "già propagata" — è la stessa esclusione del self-heal di ricevuti.
  const rettificheDaAccettare = async () => {
    // SI PAGINA: senza .range il database ne torna mille e basta, e il numero sul badge diventa una
    // bugia — il 29/09/2026 un sotto-master ne aveva 2.215 e ne vedeva 1.000. Le pagine restano in
    // fila: si sa che sono finite solo quando ne arriva una corta.
    // FUORI LE RIGHE "SOLO A TUO CARICO" (master_id = target_master_id): sono il costo del detentore
    // quando sotto non c'e' niente da recuperare, non vengono da sopra e la pagina non le mostra. Il
    // 28/10/2026 il file Poste di MULTI ne ha lasciate 1.786: il pallino diceva 1.787, la pagina 1.
    const rettPend: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await adminDb.from('rettifiche')
        .select('id,differenza,fuori_sagoma')
        .eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true).is('propagazione', null)
        .order('id').range(da, da + 999)
      if (error) { console.error('[BADGE] rettifiche da accettare:', error.message); break }
      rettPend.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    const idsPend = rettPend.map((r: any) => r.id)
    const blocchi: string[][] = []
    for (let i = 0; i < idsPend.length; i += 400) blocchi.push(idsPend.slice(i, i + 400))
    const figlie = await Promise.all(blocchi.map(b =>
      adminDb.from('rettifiche').select('origine_rettifica_id').in('origine_rettifica_id', b)))
    const conFiglia = new Set<string>()
    for (const { data } of figlie) {
      for (const f of (data || [])) if ((f as any).origine_rettifica_id) conFiglia.add((f as any).origine_rettifica_id)
    }
    return rettPend.filter((r: any) => !conFiglia.has(r.id))
  }

  // ── DA CONFERMARE (Rettifica Costi) ── rettifiche MIE ancora in attesa: il credito non è sceso.
  // SI PAGINA anche qui, come per quelle da accettare: il 20/11/2026 MULTIEXPRESS ne aveva 2.582 per 147,43 EUR e il
  // pallino (e la plancia nuova) diceva 1.000 per 92,28. Il database ne torna mille per volta; .order('id') perché
  // senza un ordine le pagine non sono stabili e una riga può comparire due volte o mai.
  const rettificheDaConfermare = async () => {
    const rettDaConf: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await adminDb.from('rettifiche')
        .select('differenza,fuori_sagoma')
        .eq('master_id', mio).eq('confermata', false)
        .order('id').range(da, da + 999)
      if (error) { console.error('[BADGE] rettifiche da confermare:', error.message); break }
      rettDaConf.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return rettDaConf
  }

  const [rettDaAccettare, [cod, resi], rettDaConf] = await Promise.all([
    rettificheDaAccettare(),
    // Contrassegni e resi ricevuti e non ancora accettati (stesso posto, stessa decisione).
    Promise.all([
      adminDb.from('distinte_contrassegni').select('id', { count: 'exact', head: true })
        .eq('target_master_id', mio).not('accettata_target', 'is', true),
      adminDb.from('distinte_resi').select('id', { count: 'exact', head: true })
        .eq('target_master_id', mio).not('accettata_target', 'is', true),
    ]),
    rettificheDaConfermare(),
  ])

  const rettAccettareImporto = rettDaAccettare.reduce((a: number, r: any) =>
    a + (Number(r.differenza) < 0 ? -Number(r.differenza) : 0) + (Number(r.fuori_sagoma) || 0), 0)
  const confermaImporto = (rettDaConf || []).reduce((a: number, r: any) =>
    a + (Number(r.differenza) < 0 ? -Number(r.differenza) : 0) + (Number(r.fuori_sagoma) || 0), 0)

  const daAccettare = rettDaAccettare.length + (cod.count || 0) + (resi.count || 0)
  return {
    daAccettare,
    daAccettareRettifiche: rettDaAccettare.length,
    daAccettareImporto: Math.round(rettAccettareImporto * 100) / 100,
    daConfermare: (rettDaConf || []).length,
    daConfermareImporto: Math.round(confermaImporto * 100) / 100,
  }
}
