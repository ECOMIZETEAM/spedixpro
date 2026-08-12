// SEED di un master DEMO: riempie il suo tenant isolato di dati FINTI ma verosimili, così il
// potenziale cliente trova un gestionale "vivo" — corriere, listino, prezzi, clienti, spedizioni in
// vari stati, qualche contrassegno. Tutto interno al tenant demo: niente esce, niente si addebita.
//
// Struttura clonata da un contratto INTERNO reale (che non chiama provider): corriere interno +
// listino_corrieri + zona "Italia" con zone_cap jolly (prezza ogni CAP) + fasce di peso. In più un
// listino cliente (vendita) assegnato a clienti finti, così anche "Nuova Spedizione per un cliente"
// mostra i prezzi e funziona. Le spedizioni finte usano lo stesso corriere interno.

type Admin = any

// Fasce COSTO (quello che "paga" il master demo) e VENDITA (quello che vede il suo cliente demo).
const FASCE = [
  { min: 0, max: 5, costo: 4.5, vendita: 6.9 },
  { min: 5, max: 10, costo: 6.0, vendita: 8.9 },
  { min: 10, max: 30, costo: 9.5, vendita: 13.9 },
  { min: 30, max: 50, costo: 15.0, vendita: 21.0 },
]

const CLIENTI_DEMO = [
  { rag: 'Bottega del Caffè Srl', citta: 'Milano', prov: 'MI', cap: '20121', ind: 'Via Dante 12' },
  { rag: 'TechParts Italia', citta: 'Torino', prov: 'TO', cap: '10121', ind: 'Corso Francia 45' },
  { rag: 'Moda Nova Boutique', citta: 'Napoli', prov: 'NA', cap: '80121', ind: 'Via Chiaia 88' },
]

// Destinatari finti sparsi per l'Italia (nomi verosimili, email/telefono NON reali).
const DEST = [
  { nome: 'Giulia Ferrari', ind: 'Via Garibaldi 3', citta: 'Bologna', prov: 'BO', cap: '40121' },
  { nome: 'Marco Russo', ind: 'Via Etnea 210', citta: 'Catania', prov: 'CT', cap: '95124' },
  { nome: 'Elena Bianchi', ind: 'Corso Vittorio 9', citta: 'Bari', prov: 'BA', cap: '70122' },
  { nome: 'Luca Romano', ind: 'Via Mazzini 17', citta: 'Firenze', prov: 'FI', cap: '50123' },
  { nome: 'Sara Conti', ind: 'Piazza Verdi 2', citta: 'Genova', prov: 'GE', cap: '16121' },
  { nome: 'Davide Greco', ind: 'Via Roma 55', citta: 'Palermo', prov: 'PA', cap: '90133' },
  { nome: 'Chiara Marino', ind: 'Via Veneto 8', citta: 'Roma', prov: 'RM', cap: '00187' },
  { nome: 'Andrea Costa', ind: 'Via del Corso 30', citta: 'Padova', prov: 'PD', cap: '35122' },
  { nome: 'Francesca Rizzo', ind: 'Via Indipendenza 14', citta: 'Verona', prov: 'VR', cap: '37121' },
  { nome: 'Matteo Gallo', ind: 'Corso Umberto 100', citta: 'Rimini', prov: 'RN', cap: '47921' },
]

// Stati verosimili con la loro "età" (giorni fa) tipica, per una lista credibile.
const SCENARI: { stato: string; giorniFa: number; cod?: boolean; statoCod?: string }[] = [
  { stato: 'consegnata', giorniFa: 12 },
  { stato: 'consegnata', giorniFa: 10, cod: true, statoCod: 'pagato' },
  { stato: 'consegnata', giorniFa: 9 },
  { stato: 'consegnata', giorniFa: 8, cod: true, statoCod: 'pagato' },
  { stato: 'in_consegna', giorniFa: 2 },
  { stato: 'in_transito', giorniFa: 3 },
  { stato: 'in_transito', giorniFa: 1, cod: true, statoCod: 'in_attesa' },
  { stato: 'spedita', giorniFa: 1 },
  { stato: 'spedita', giorniFa: 0 },
  { stato: 'in_giacenza', giorniFa: 4 },
  { stato: 'in_lavorazione', giorniFa: 0 },
  { stato: 'consegnata', giorniFa: 15, cod: true, statoCod: 'pagato' },
  { stato: 'in_transito', giorniFa: 2 },
  { stato: 'spedita', giorniFa: 0 },
  { stato: 'consegnata', giorniFa: 6 },
  { stato: 'in_consegna', giorniFa: 1 },
]

// Genera un numero LDV finto univoco (prefisso DMO + coda dell'id master + progressivo).
function numeroDemo(masterId: string, i: number): string {
  const short = masterId.replace(/-/g, '').slice(-6).toUpperCase()
  return `DMO${short}${String(i).padStart(3, '0')}`
}

export async function seminaDemo(admin: Admin, masterId: string): Promise<{ corriereId: string; clienti: number; spedizioni: number }> {
  const mitt = { nome: 'MoovExpress Demo', ind: 'Via Roma 1', citta: 'Milano', prov: 'MI', cap: '20100', tel: '0200000000', email: 'demo@moovexpress.com' }

  // 1) Corriere INTERNO (non chiama provider): numero + etichetta locali.
  const { data: corr } = await admin.from('corrieri').insert({
    master_id: masterId, tipo: 'interno', nome_contratto: 'MoovExpress Express',
    attivo: true, livello: 1, credenziali: {}, multicollo: true, condivisibile: false, proprio: false,
    inserimento_ritiri: true,
    settings: { misure_max: { altezza: null, larghezza: null, lunghezza: null } },
  }).select('id').single()
  const corriereId = corr!.id

  // 2) Zona "Italia" nazionale con zone_cap JOLLY (paese IT, provincia * e cap *): prezza ogni CAP.
  const { data: zona } = await admin.from('zone').insert({
    master_id: masterId, corriere_id: corriereId, nome: 'Italia', con_fuel: false, descrizione: 'Tutta Italia',
  }).select('id').single()
  const zonaId = zona!.id
  await admin.from('zone_cap').insert({ zona_id: zonaId, paese: 'IT', provincia: '*', cap: '*', citta: '*' })

  // 3) Listino CORRIERI (costo del master) + fasce di peso sulla zona Italia.
  const { data: lc } = await admin.from('listini_corrieri').insert({
    master_id: masterId, corriere_id: corriereId, nome: 'MoovExpress Express', attivo: true, fattore_volume: 5000, solo_peso_reale: false,
  }).select('id').single()
  const listinoCorrieriId = lc!.id
  await admin.from('listini_corrieri_corrieri').insert({ listino_id: listinoCorrieriId, corriere_id: corriereId, fattore_volume: 5000 })
  await admin.from('listini_corrieri_fasce').insert(FASCE.map(f => ({
    listino_id: listinoCorrieriId, corriere_id: corriereId, zona_id: zonaId, tipo: 'fino_a', peso_min: f.min, peso_max: f.max, prezzo: f.costo, fuel: 0,
  })))
  await admin.from('masters_corrieri_abilitati').insert({ master_id: masterId, corriere_id: corriereId, abilitato: true, settings: {} })

  // 4) Listino CLIENTI (vendita) + fasce (costo + margine): lo assegniamo ai clienti finti.
  const { data: lcl } = await admin.from('listini_clienti').insert({
    master_id: masterId, nome: 'Listino Demo', attivo: true, fattore_volume: 5000, solo_peso_reale: false,
  }).select('id').single()
  const listinoClientiId = lcl!.id
  await admin.from('listini_clienti_corrieri').insert({ listino_id: listinoClientiId, corriere_id: corriereId, abilitato: true, fattore_volume: 5000 })
  await admin.from('listini_clienti_fasce').insert(FASCE.map(f => ({
    listino_id: listinoClientiId, corriere_id: corriereId, zona_id: zonaId, tipo: 'fino_a', peso_min: f.min, peso_max: f.max, prezzo: f.vendita, fuel: 0,
  })))

  // 5) Clienti finti (con listino di vendita assegnato + corriere abilitato + credito finto).
  const clientiIds: string[] = []
  for (const c of CLIENTI_DEMO) {
    const { data: cli } = await admin.from('clienti').insert({
      master_id: masterId, ragione_sociale: c.rag, email: `demo-${c.rag.toLowerCase().replace(/[^a-z0-9]+/g, '')}@example.com`,
      listino_cliente_id: listinoClientiId, tipo_contratto: 'credito_scalare', credito: 2500, attivo: true,
      so_indirizzo: c.ind, so_citta: c.citta, so_provincia: c.prov, so_cap: c.cap, so_paese: 'Italia',
      sl_indirizzo: c.ind, sl_citta: c.citta, sl_provincia: c.prov, sl_cap: c.cap, sl_paese: 'Italia',
      // In demo niente notifiche reali al destinatario, doppia cintura oltre alle guardie di codice.
      impostazioni: { notifica_email_dest: false, notifica_sms: false },
    }).select('id').single()
    if (cli?.id) {
      clientiIds.push(cli.id)
      await admin.from('clienti_corrieri_abilitati').insert({ cliente_id: cli.id, corriere_id: corriereId, abilitato: true, settings: {} })
    }
  }

  // 6) Spedizioni finte in vari stati, sparse negli ultimi giorni; alcune di clienti, alcune "proprie".
  const oggi = Date.now()
  const righe = SCENARI.map((s, i) => {
    const d = DEST[i % DEST.length]
    const fascia = FASCE[i % 2]  // pesi leggeri, restano nelle prime due fasce
    const peso = fascia.max - 1
    const clienteId = i % 3 === 0 ? null : clientiIds[i % clientiIds.length] || null  // ~1/3 proprie
    const created = new Date(oggi - s.giorniFa * 86400000).toISOString()
    const numero = numeroDemo(masterId, i + 1)
    return {
      master_id: masterId, cliente_id: clienteId, corriere_id: corriereId, numero,
      mitt_nome: mitt.nome, mitt_indirizzo: mitt.ind, mitt_citta: mitt.citta, mitt_provincia: mitt.prov, mitt_cap: mitt.cap, mitt_paese: 'IT',
      mitt_email: mitt.email, mitt_telefono: mitt.tel,
      dest_nome: d.nome, dest_indirizzo: d.ind, dest_citta: d.citta, dest_provincia: d.prov, dest_cap: d.cap, dest_paese: 'IT',
      dest_email: null, dest_telefono: null,
      colli: 1, peso_reale: peso, peso_fatturato: peso,
      contrassegno: s.cod ? Math.round((30 + i * 7) * 100) / 100 : 0,
      tracking_number: numero, stato: s.stato,
      stato_contrassegno: s.cod ? (s.statoCod || 'in_attesa') : 'in_attesa',
      costo_spedizione: fascia.costo, costo_totale: clienteId ? fascia.vendita : fascia.costo,
      raw_response: { _interno: true, _demo: true }, canale: 'Demo',
      created_at: created, updated_at: created,
    }
  })
  const { data: sped } = await admin.from('spedizioni').insert(righe).select('id')

  return { corriereId, clienti: clientiIds.length, spedizioni: (sped || []).length }
}
