import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import TestGls from './TestGls'
import TestEcosmos from './TestEcosmos'
import TestSpring from './TestSpring'

async function salvaCorriere(formData: FormData) {
  'use server'
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) redirect('/dashboard/corrieri')

  const tipo = formData.get('tipo') as string
  const corriereId = formData.get('corriere_id') as string
  const credenziali: Record<string,string> = {}
  const settings: Record<string,string|boolean> = {}

  // INTEGRAZIONI RISERVATE (dielle, poste-diretto/KSync, ecosmos): le può aggiungere/modificare solo un master in
  // masters.integrazioni_riservate (difesa server, oltre a non mostrarle nel menu). Così non ci si aggancia
  // indovinando l'URL ?tipo=. La lista la decide il super master (colonna protetta dal trigger).
  if (tipo === 'dielle' || tipo === 'poste' || tipo === 'ecosmos') {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { data: m } = await createAdminSupabase().from('masters').select('integrazioni_riservate').eq('id', utente.master_id).maybeSingle()
    const ris = (m as any)?.integrazioni_riservate
    if (!(Array.isArray(ris) && ris.includes(tipo))) redirect('/dashboard/corrieri?error=' + encodeURIComponent('Integrazione non disponibile'))
  }

  // Circuito interno: non c'e' nessun provider a cui chiedere le chiavi, il corriere siamo noi.
  // Il contratto serve comunque, perche' e' quello che porta zone, listino, credito e cascata.
  if (tipo === 'interno') {
    settings.filiale = formData.get('filiale') as string || ''
  } else if (tipo === 'spedisci') {
    credenziali.utente = formData.get('utente') as string || ''
    credenziali.password = formData.get('password') as string || ''
    credenziali.master_domain = formData.get('master_domain') as string || ''
    credenziali.codice_contratto = formData.get('codice_contratto') as string || ''
  } else if (tipo === 'gls') {
    credenziali.sigla_sede = formData.get('sigla_sede') as string || ''
    credenziali.user_webservice = formData.get('user_webservice') as string || ''
    credenziali.password_webservice = formData.get('password_webservice') as string || ''
    credenziali.codice_contratto = formData.get('codice_contratto') as string || ''
    // Facoltativa: serve solo allo svincolo delle giacenze (servizio GLS a parte, lib/gls.svincolaGiacenzaGls).
    credenziali.password_weblabeling = formData.get('password_weblabeling') as string || ''
    // Facoltativi: sede e codice con cui si entra nell'area personale, se diversi da Sigla Sede e User
    // Webservice (lib/gls.profiloAreaGls). Quick, 19/11/2026: password giusta, profilo diverso.
    credenziali.sede_area_gls = ((formData.get('sede_area_gls') as string) || '').trim().toUpperCase()
    credenziali.codice_area_gls = ((formData.get('codice_area_gls') as string) || '').trim()
    settings.tipo_collo = formData.get('tipo_collo') as string || 'Normale'
    // Nazionale (Italia) o Parcel (Europa): e' un altro servizio GLS con le stesse credenziali, e
    // decide dove il contratto puo' spedire (lib/gls.ts, servizioGls).
    settings.tipo_spedizione = formData.get('tipo_spedizione') === 'P' ? 'P' : 'N'
  } else if (tipo === 'sda') {
    credenziali.utente = formData.get('utente') as string || ''
    credenziali.password = formData.get('password') as string || ''
    credenziali.cod_cliente = formData.get('cod_cliente') as string || ''
    credenziali.postazione = formData.get('postazione') as string || ''
    settings.tipo_contratto = formData.get('tipo_contratto_sda') as string || 'ZERO_TRE'
  } else if (tipo === 'brt') {
    // Web service BRT: credenziali del contratto diretto (form del mockup).
    credenziali.user = formData.get('user') as string || ''
    credenziali.password = formData.get('password') as string || ''
    credenziali.cod_cliente = formData.get('cod_cliente') as string || ''
    credenziali.cod_filiale = formData.get('cod_filiale') as string || ''
    credenziali.codice_tariffa = formData.get('codice_tariffa') as string || ''
    credenziali.orm_api_key = formData.get('orm_api_key') as string || ''
    settings.network = (formData.get('network') as string) || 'Italia'
    settings.sms_destinatario = formData.get('sms_destinatario') === 'on'
  } else if (tipo === 'fedex') {
    // FedEx REST diretto: chiavi OAuth del progetto Ship + conto; chiavi Track SEPARATE facoltative.
    credenziali.api_key = formData.get('api_key') as string || ''
    credenziali.api_secret = formData.get('api_secret') as string || ''
    credenziali.account_number = formData.get('account_number') as string || ''
    credenziali.track_api_key = formData.get('track_api_key') as string || ''
    credenziali.track_api_secret = formData.get('track_api_secret') as string || ''
    // serviceType/pickupType/test governano la creazione: stanno nel contratto (settings).
    settings.tipo_servizio = (formData.get('tipo_servizio') as string) || 'FEDEX_REGIONAL_ECONOMY'
    settings.tipo_ritiro = (formData.get('tipo_ritiro') as string) || 'USE_SCHEDULED_PICKUP'
    settings.test_mode = formData.get('test_mode') === 'on'
  } else if (tipo === 'dielle') {
    // Dielle/TWS (mydielle): aggregatore. UN account (username/password/ambiente) = una credenziale; OGNI
    // riga corrieri = un corriere reale, identificato dai suoi codici servizio nelle settings (lib/dielle.ts).
    credenziali.username = formData.get('username') as string || ''
    credenziali.password = formData.get('password') as string || ''
    credenziali.ambiente = (formData.get('ambiente') as string) === 'prod' ? 'prod' : 'staging'
    settings.servizio = formData.get('servizio') as string || ''
    settings.codiceServizio = formData.get('codiceServizio') as string || ''
    settings.accessorio_crono = formData.get('accessorio_crono') as string || ''
  } else if (tipo === 'poste') {
    // Poste Delivery Business DIRETTO via KSync/ParcelPilot. UN account (clientId/secretId/costCenterCode/
    // ambiente) = una credenziale; OGNI riga corrieri = un PRODOTTO Poste, nel settings.product (lib/ksync.ts).
    // Ambiente 'demo' = auth disabilitata (prove); 'prod' = OAuth con le chiavi. baseUrl override facoltativo.
    credenziali.clientId = formData.get('clientId') as string || ''
    credenziali.secretId = formData.get('secretId') as string || ''
    credenziali.scope = formData.get('scope') as string || ''
    credenziali.costCenterCode = formData.get('costCenterCode') as string || ''
    credenziali.ambiente = (formData.get('ambiente') as string) === 'prod' ? 'prod' : 'demo'
    credenziali.baseUrl = formData.get('baseUrl') as string || ''
    // Utente e password del web service di KSync: se ci sono, la lettera si crea direttamente su KSync
    // invece che dal ponte (lib/ksync.ts, creaKsyncDiretto). Il ponte si e' fermato l'11/11/2026.
    credenziali.wsUtente = ((formData.get('wsUtente') as string) || '').trim()
    credenziali.wsPassword = formData.get('wsPassword') as string || ''
    settings.product = formData.get('product') as string || ''
    settings.codice_contrassegno = formData.get('codice_contrassegno') as string || ''
    settings.modalita_pagamento_cod = formData.get('modalita_pagamento_cod') as string || ''
    settings.codice_assicurazione = formData.get('codice_assicurazione') as string || ''
  } else if (tipo === 'ecosmos') {
    // Ecosmos (corriere elettrico di Roma): una chiave API per account (lib/ecosmos.ts). Un contratto per
    // SERVIZIO (in giornata, 24 ore, 72 ore): ognuno ha copertura e prezzi suoi. Il servizio e' una scelta
    // fra tre codici fissi, non un testo: un codice scritto male fermerebbe tutte le spedizioni.
    credenziali.api_key = ((formData.get('api_key') as string) || '').trim()
    // La chiave ha una forma fissa (eco_live_… / eco_test_…). Il 19/11 e' stata salvata la password del sito
    // ecosmos.app al suo posto, e il contratto e' rimasto fermo senza che nessuno lo vedesse: si ferma qui.
    const { chiaveEcosmosValida } = await import('@/lib/ecosmos')
    if (!chiaveEcosmosValida(credenziali.api_key)) {
      redirect('/dashboard/corrieri?error=' + encodeURIComponent('Chiave API Ecosmos non valida: deve iniziare con eco_live_. Non è la password del sito ecosmos.app: la chiave per l\'integrazione te la dà Ecosmos.'))
    }
    const srvEc = formData.get('servizio_ecosmos') as string
    settings.servizio = ['same_day', 'express_24h', 'standard_72h'].includes(srvEc) ? srvEc : 'express_24h'
  } else if (tipo === 'spring') {
    // Spring GDS (XBS): una chiave API per account (lib/spring.ts). Un contratto per AMBITO (Italia, Europa,
    // Internazionale), ognuno col suo servizio Spring e il suo listino. L'ambiente si sceglie apposta: la
    // stessa chiave crea spedizioni di prova o vere a seconda di dove si chiama, e una spedizione di prova
    // pagata dal cliente non partirebbe mai.
    credenziali.api_key = ((formData.get('api_key') as string) || '').trim()
    const amb = String(formData.get('ambiente_spring') || '')
    credenziali.ambiente = amb === 'produzione' ? 'produzione' : 'prova'
    const ambito = String(formData.get('spring_ambito') || '')
    settings.spring_ambito = ['italia', 'europa', 'internazionale'].includes(ambito) ? ambito : ''
    settings.spring_servizio = String(formData.get('spring_servizio') || '').trim().toUpperCase()
    // Si controlla con Spring PRIMA di salvare: una chiave sbagliata o un servizio non attivo sull'account
    // fermerebbero ogni spedizione del contratto, e lo si scoprirebbe solo con un cliente davanti.
    // (redirect fuori dal try: Next lo realizza lanciando un errore, che il catch inghiottirebbe.)
    let erroreSpring = ''
    if (!['prova', 'produzione'].includes(amb)) erroreSpring = 'Spring: scegli l\'ambiente (Prova o Produzione).'
    else if (!settings.spring_ambito) erroreSpring = 'Spring: scegli l\'ambito del contratto (Italia, Europa o Internazionale).'
    else if (!settings.spring_servizio) erroreSpring = 'Spring: scegli il servizio del contratto.'
    else {
      try {
        const { serviziSpring } = await import('@/lib/spring')
        const srv = await serviziSpring({ api_key: credenziali.api_key, ambiente: credenziali.ambiente })
        if (!srv.consentiti.includes(String(settings.spring_servizio))) {
          erroreSpring = `Spring: il servizio ${settings.spring_servizio} non è attivo sul tuo account. Servizi attivi: ${srv.consentiti.join(', ') || 'nessuno'}.`
        }
      } catch (e: any) {
        erroreSpring = e?.message || 'Spring: verifica della chiave non riuscita, riprova.'
      }
    }
    if (erroreSpring) redirect('/dashboard/corrieri?error=' + encodeURIComponent(erroreSpring))
  } else if (tipo === 'inpost') {
    // InPost diretto — Global API OAuth2 (merchant.inpost-group.com). Un account = clientId/secretId/
    // organizationId + ambiente (stage per collaudo, prod per il live). Le spedizioni verso locker usano
    // il selettore punti; a domicilio l'indirizzo. NIENTE brand/productVariant (lib/inpost.ts).
    credenziali.clientId = formData.get('clientId') as string || ''
    credenziali.secretId = formData.get('secretId') as string || ''
    credenziali.organizationId = formData.get('organizationId') as string || ''
    credenziali.ambiente = (formData.get('ambiente') as string) === 'prod' ? 'prod' : 'stage'
  } else {
    credenziali.utente = formData.get('utente') as string || ''
    credenziali.password = formData.get('password') as string || ''
  }

  if (corriereId) {
    // *** MODIFICA: aggiorna il corriere esistente ***
    // SOLO IL PROPRIETARIO (proprio=true) puo' modificare le credenziali. Un sotto-master ha una
    // COPIA propagata (proprio=false) del contratto: non deve poter vederne/cambiarne le chiavi.
    // Le impostazioni generali (settings) NON si toccano qui: le gestisce il popup Impostazioni;
    // sovrascriverle con i soli campi di questa form cancellerebbe misure/limiti configurati.
    const { data: esistente } = await supabase.from('corrieri').select('proprio,settings,nome_contratto').eq('id', corriereId).eq('master_id', utente.master_id).maybeSingle()
    if (!esistente) redirect('/dashboard/corrieri?error=' + encodeURIComponent('Contratto non trovato'))
    if (!(esistente as any)?.proprio) redirect('/dashboard/corrieri?error=' + encodeURIComponent('Solo il proprietario del contratto puo\' modificarlo'))
    const settingsUniti = { ...((esistente as any)?.settings || {}), ...settings }

    // RINOMINA SICURA DI UN CONTRATTO CONDIVISO: il nome e' la chiave con cui la catena-condivisione
    // aggancia le copie dei sotto-master (corrieriPerNome). Cambiare solo la propria copia spezzava la
    // catena (owner non piu' trovato -> costo/COD/reso/rettifiche persi). Propago il nuovo nome a TUTTE
    // le copie col VECCHIO nome (lo catturo PRIMA dell'update dell'owner). Se la propagazione rifiuta
    // (nome ambiguo/gia' in uso) NON cambio il nome: tengo il vecchio (catena intatta) e salvo solo
    // credenziali/settings, avvisando.
    const oldNome = String((esistente as any)?.nome_contratto || '')
    const nuovoNome = formData.get('nome_contratto') as string
    let nomeDaSalvare = nuovoNome
    let avvisoNome = ''
    if (oldNome.trim().toLowerCase() !== (nuovoNome || '').trim().toLowerCase()) {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const { propagaNomeContrattoAlleCopie } = await import('@/lib/propaga-nome-contratto')
      const r = await propagaNomeContrattoAlleCopie(createAdminSupabase(), { oldNome, nuovoNome, ownerMaster: utente.master_id }).catch(() => ({ ok: false, rinominati: 0, motivo: 'errore' }))
      if (!(r as any).ok) { nomeDaSalvare = oldNome; avvisoNome = (r as any).motivo || 'non rinominabile' }
    }

    const { error } = await supabase.from('corrieri').update({
      nome_contratto: nomeDaSalvare,
      credenziali, settings: settingsUniti,
    }).eq('id', corriereId).eq('master_id', utente.master_id).eq('proprio', true)

    if (error) redirect(`/dashboard/corrieri?error=${encodeURIComponent(error.message)}`)
    // Propaga le credenziali aggiornate alle COPIE rivendute nella discendenza (come le zone): stesso
    // contratto = stesso account = stesse chiavi. Senza, quando il proprietario rinnova le API key i
    // sotto-master che lo rivendono restano con quelle scadute e i loro CLIENTI non spediscono più
    // (bug FedEx 21/09/2026: 401 sui sotto-master, la "propria" del master passava, il cliente no).
    try {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const { sincronizzaCredenzialiAiDiscendenti } = await import('@/lib/propaga-credenziali')
      await sincronizzaCredenzialiAiDiscendenti(createAdminSupabase(), corriereId)
    } catch (e) { console.error('propaga credenziali ai sotto-master:', e) }
    // Nome rifiutato (contratto condiviso ambiguo): credenziali salvate, nome tenuto al vecchio -> avviso.
    if (avvisoNome) redirect('/dashboard/corrieri?error=' + encodeURIComponent('Credenziali salvate. Nome NON cambiato (contratto condiviso: ' + avvisoNome + ').'))
    redirect('/dashboard/corrieri?success=corriere_aggiornato')
  } else {
    // CREAZIONE: nuovo corriere
    const { error } = await supabase.from('corrieri').insert({
      master_id: utente.master_id,
      tipo, nome_contratto: formData.get('nome_contratto') as string,
      // Spring: un collo per spedizione, la loro API non conosce il multicollo (lib/spring.ts). Niente ritiro
      // da prenotare: i pacchi arrivano a Spring fuori dall'API.
      credenziali, settings, multicollo: tipo !== 'spring', inserimento_ritiri: tipo !== 'spring', attivo: true, livello: 1,
    })

    // Un solo contratto attivo per nome e master (scripts/stacca-contratto-vincolo.sql): due righe omonime facevano
    // scegliere a caso la catena dei costi (GTS aveva tre "GLS CASERTA", 26/11/2026). Il messaggio è per il master.
    if (error) {
      const doppio = /corrieri_un_attivo_per_nome/.test(error.message || '')
      redirect(`/dashboard/corrieri?error=${encodeURIComponent(doppio ? 'Hai già un contratto con questo nome: scegline un altro.' : error.message)}`)
    }
    redirect('/dashboard/corrieri?success=corriere_aggiunto')
  }
}

// Servizi Spring che creano un'etichetta di consegna (elenco del loro comando GetServices, manuale 2026-09-02).
// Fuori elenco apposta: i resi (BACK, BACKT), quelli senza etichetta (IMPRT, NOLABEL), il ritiro a un punto
// (CLLCT, PPLCS, HEDCS: vogliono il codice del punto, che oggi non passiamo) e le merci pericolose (UDGS,
// UPDG, UPDGS, UPPDG: vogliono i dati ADR per articolo). Quali sono attivi lo dice Spring, conto per conto.
const SERVIZI_SPRING: [string, string][] = [
  ['TRCK', 'Spring Tracked (sceglie Spring il vettore migliore, tracciato)'],
  ['SIGN', 'Spring Signature (sceglie Spring il vettore, con firma)'],
  ['UNTR', 'Spring Untracked (sceglie Spring il vettore, non tracciato)'],
  ['ITCR', 'Poste Italiane Crono'], ['ITCRX', 'Poste Italiane Crono Express'],
  ['PPLEU', 'PostNL Parcel EU'], ['PPTT', 'PostNL Packet Tracked'], ['PPTR', 'PostNL Packet Registered'],
  ['PPNT', 'PostNL Packet Non Tracked'], ['PPBTT', 'PostNL Packet Boxable Tracked'], ['PPBNT', 'PostNL Packet Boxable Non Tracked'],
  ['PPBT', 'PostNL Packet Bag & Trace'], ['PPBBT', 'PostNL Packet Boxable Bag & Trace'],
  ['PPND', 'PostNL Parcel Benelux, senza firma'], ['PPNDS', 'PostNL Parcel Benelux, con firma'],
  ['PPHD', 'PostNL Parcel Benelux, senza firma, no vicino'], ['PPHDS', 'PostNL Parcel Benelux, con firma, no vicino'],
  ['PPLUP', 'PostNL Parcel Benelux UPU'], ['PPLEP', 'PostNL Parcel EPG'], ['PPNEU', 'PostNL Parcel EPG extra-UE'],
  ['PPLGE', 'PostNL Parcel GlobalPack EMS'], ['PPLGU', 'PostNL Parcel GlobalPack UPU'], ['PPLLW', 'PostNL Lightweight China'],
  ['RM24', 'Royal Mail Tracked 24, senza firma'], ['RM24S', 'Royal Mail Tracked 24, con firma'],
  ['RM48', 'Royal Mail Tracked 48, senza firma'], ['RM482', 'Royal Mail Tracked 48, senza firma (2)'], ['RM48S', 'Royal Mail Tracked 48, con firma'],
  ['SEND', 'Sending (Spagna e Portogallo continentali)'], ['SEND2', 'Sending (isole)'],
  ['DPDDE', 'DPD Germania'], ['HEHDS', 'Hermes Germania, con firma'],
  ['CPHD', 'Colis Privé Francia, senza firma'], ['CPHDS', 'Colis Privé Francia, con firma'],
  ['PACHD', 'Packeta'], ['ATEHD', 'Austrian Post Eurodis'], ['MABNT', 'MailAlliance Boxable Non Tracked'],
  ['SCST', 'Spring Com Standard, senza firma'], ['SCSTS', 'Spring Com Standard, con firma'],
  ['SCEX', 'Spring Com Express, senza firma'], ['SCEXS', 'Spring Com Express, con firma'],
  ['UPGR', 'USA Parcel Ground, senza firma'], ['UPGRS', 'USA Parcel Ground, con firma'],
  ['UPEX', 'USA Parcel Express, senza firma'], ['UPEXS', 'USA Parcel Express, con firma'],
  ['UPMA', 'USA Parcel Max, senza firma'], ['UPMAS', 'USA Parcel Max, con firma'],
  ['EXPR', 'Spring Express'],
]

const CONFIGS: Record<string,{titolo:string,info:string,campi:[string,string,string,string,boolean?][],extra?:string}> = {
  interno: {
    titolo: 'Circuito interno',
    info: 'La tua rete di consegna: i pacchi li ritiri e li consegni tu, con i tuoi autisti. Nessuna credenziale da chiedere a nessuno. Dopo averlo creato imposta le Zone di consegna e i prezzi in Listini Prezzi, poi attivalo per i clienti.',
    campi: [
      ['nome_contratto','Nome del servizio','es. Consegne Città','text'],
      ['filiale','Filiale / deposito principale','es. Napoli Est','text'],
    ],
  },
  spedisci: {
    titolo: 'Spedisci.online',
    info: 'Vai su spedisci.online → Impostazioni → API Key per ottenere le credenziali.',
    campi: [
      ['nome_contratto','Nome Contratto','es. Ecomize GLS via Spedisci','text'],
      ['utente','Utente (email account spedisci.online)','tua@email.com','email'],
      ['password','Password (= API Key da Impostazioni → API Key)','incolla qui la API Key','text'],
      ['master_domain','Master Domain','es. ecomizell.spedisci.online','text'],
      ['codice_contratto','Codice Contratto','codice del contratto specifico','text'],
    ],
  },
  gls: {
    titolo: 'GLS',
    info: 'Credenziali fornite da GLS al momento della stipula del contratto.',
    campi: [
      ['nome_contratto','Nome Contratto','es. GLS TR','text'],
      ['sigla_sede','Sigla Sede','es. MI','text'],
      ['user_webservice','User Webservice (API)','username','text'],
      ['password_webservice','Password Webservice (API)','••••••••','password'],
      ['codice_contratto','Codice Contratto','es. 123456','text'],
      // Lo svincolo vuole la password dell'AREA PERSONALE del sito GLS, non quella del Weblabeling. Il campo
      // nel DB si chiama ancora password_weblabeling (le password salvate restano valide), ma l'etichetta no:
      // il 16/11/2026 M.C. LOGISTICA, seguendo la scritta "Weblabeling", ne ha messe due che GLS ha rifiutato,
      // con 12 giacenze ferme dal 12/11.
      ['password_weblabeling','Password area personale sito GLS (svincolo giacenze)','quella con cui entri su gls-italy.com, non il Weblabeling','password',true],
      // Lo svincolo si chiede col profilo dell'area personale: di solito Sigla Sede + User Webservice, ma non
      // sempre. Quick (sede CK) entra nell'area personale con un altro codice, e GLS rispondeva "Profilo GLS
      // inesistente" alla password giusta (19/11/2026). Vuoti = come prima.
      ['sede_area_gls','Sede area personale sito GLS','solo se diversa dalla Sigla Sede','text',true],
      ['codice_area_gls','Codice cliente area personale sito GLS','solo se diverso dallo User Webservice','text',true],
    ],
  },
  sda: {
    titolo: 'SDA Express',
    info: 'Credenziali fornite da SDA/Poste Italiane.',
    campi: [
      ['nome_contratto','Nome Contratto','es. SDA Express','text'],
      ['utente','Utente','username SDA','text'],
      ['password','Password','••••••••','password'],
      ['cod_cliente','Cod Cliente','codice cliente SDA','text'],
      ['postazione','Postazione','codice postazione','text'],
    ],
  },
  brt: {
    titolo: 'BRT',
    info: 'Credenziali del web service BRT (fornite da BRT alla stipula del contratto diretto).',
    campi: [
      ['nome_contratto','Nome Contratto','es. BRT Standard','text'],
      ['user','User API','username web service BRT','text'],
      ['password','Password API','••••••••','password'],
      ['cod_cliente','Cod Cliente','codice cliente BRT','text'],
      ['cod_filiale','Cod Filiale partenza','es. 123','text',true],
      ['codice_tariffa','Codice tariffa','codice tariffa contrattuale','text',true],
      ['orm_api_key','ORM API Key','chiave ORM (facoltativa)','text',true],
    ],
  },
  fedex: {
    titolo: 'FedEx',
    info: 'Credenziali API FedEx (developer.fedex.com → progetto Ship): API Key, Secret Key e numero conto. Le chiavi Track sono facoltative (solo se hai un progetto Track separato).',
    campi: [
      ['nome_contratto','Nome Contratto','es. FedEx Italia','text'],
      ['api_key','API Key','client_id del progetto Ship','text'],
      ['api_secret','Secret Key','••••••••','password'],
      ['account_number','Numero conto spedizione','es. 123456789','text'],
      ['track_api_key','Tracking API Key','solo se progetto Track separato','text',true],
      ['track_api_secret','Tracking Secret Key','••••••••','password',true],
    ],
  },
  dhl: {
    titolo: 'DHL Express',
    info: 'Credenziali API DHL dal portale MyDHL+.',
    campi: [
      ['nome_contratto','Nome Contratto','es. DHL Express','text'],
      ['account_number','Account Number','es. 123456789','text'],
      ['api_key','API Key','chiave API','text'],
      ['api_secret','API Secret','••••••••','password'],
    ],
  },
  dielle: {
    titolo: 'Dielle',
    info: 'Un account (username/password) con dentro più corrieri. Crea un contratto per OGNI corriere reale (BRT, GLS, UPS…) indicando il suo codice servizio. Scegli l’ambiente: Test per collaudare, Produzione quando è tutto pronto.',
    campi: [
      ['nome_contratto','Nome del contratto','es. BRT, GLS, UPS','text'],
      ['username','Username','fornito dal fornitore','text'],
      ['password','Password','••••••••','password'],
      ['servizio','Codice servizio','es. ESPRESSOBRT, ESPRESSOGLS, STANDARD','text'],
      ['codiceServizio','Codice servizio opzioni','es. T09, PIA, SAT','text',true],
      ['accessorio_crono','Accessorio crono','es. LK, FP','text',true],
    ],
  },
  ecosmos: {
    titolo: 'Ecosmos',
    info: 'Consegne con mezzi elettrici a Roma e nei comuni vicini. Incolla la chiave API per l\'integrazione che ti ha dato Ecosmos (inizia con eco_live_: non è la password con cui entri sul sito ecosmos.app) e scegli il servizio: crea un contratto per ogni servizio che vuoi vendere. Il ritiro lo fa Ecosmos dal mittente, senza prenotarlo: le spedizioni fatte entro le 13 partono in giornata. Ritiro e consegna devono essere entrambi nella zona coperta.',
    campi: [
      ['nome_contratto','Nome del contratto','es. Ecosmos 24 ore','text'],
      ['api_key','Chiave API','eco_live_…','password'],
    ],
  },
  spring: {
    titolo: 'Spring',
    info: 'Spring GDS (gruppo PostNL): spedizioni in Italia, in Europa e nel resto del mondo. La chiave API la trovi nel portale Spring (mailingtechnology.com) in Profilo → API-key. Crea un contratto per ogni ambito che vuoi vendere (Italia, Europa, Internazionale): ognuno ha il suo servizio e il suo listino. Spring accetta un collo per spedizione, il contrassegno solo verso Ungheria, Romania e Bulgaria e non prevede l\'assicurazione. Fuori dall\'UE servono i dati doganali degli articoli (descrizione, codice HS, valore, peso, origine) dal catalogo. Il ritiro non si prenota da qui: vale l\'accordo che hai con Spring.',
    campi: [
      ['nome_contratto','Nome del contratto','es. Spring Europa','text'],
      ['api_key','Chiave API','dal portale Spring, Profilo → API-key','password'],
    ],
  },
  poste: {
    titolo: 'Poste Delivery Business',
    info: 'Contratto Poste Delivery Business diretto. Un account (Client ID/Secret ID/centro di costo) con dentro più prodotti: crea un contratto per OGNI prodotto Poste indicando il suo codice. Scegli l’ambiente: Demo per collaudare, Produzione quando è tutto pronto.',
    campi: [
      ['nome_contratto','Nome del contratto','es. Poste Delivery Business Standard','text'],
      ['clientId','Client ID','fornito dal fornitore','text'],
      ['secretId','Secret ID','••••••••','password'],
      ['scope','Scope OAuth','es. api://…/.default (se richiesto)','text',true],
      ['costCenterCode','Codice centro di costo','es. CDC-00073352','text'],
      ['product','Codice prodotto','es. APT000901','text'],
      ['codice_contrassegno','Codice servizio contrassegno','es. APT000918','text',true],
      ['modalita_pagamento_cod','Modalità pagamento contrassegno','es. CON','text',true],
      ['codice_assicurazione','Codice servizio assicurazione','opzionale','text',true],
      ['wsUtente','Utente web service','se compilato, le lettere di vettura si creano direttamente','text',true],
      ['wsPassword','Password web service','••••••••','password',true],
      ['baseUrl','URL server (override)','solo se diverso dal default','text',true],
    ],
  },
  inpost: {
    titolo: 'InPost',
    info: 'InPost diretto. Un account (Client ID/Secret ID/ID organizzazione) dal Merchant Portal InPost (sezione API → Crea app, Client Credentials Flow). Scegli l’ambiente: Stage per collaudare, Produzione per spedire davvero. Le consegne possono essere a locker/punto (il cliente sceglie dal selettore) o a domicilio.',
    campi: [
      ['nome_contratto','Nome del contratto','es. InPost Locker','text'],
      ['clientId','Client ID','es. app-i0ccwqmxuf','text'],
      ['secretId','Client Secret','••••••••','password'],
      ['organizationId','ID organizzazione','es. c28bfc02-fad0-44c7-8207-b6867535dae2','text'],
    ],
  },
}

export default async function AggiungiCorrierePage({ searchParams }: { searchParams: Promise<{tipo?:string,id?:string}> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { tipo, id } = await searchParams
  const config = CONFIGS[tipo||'spedisci'] || CONFIGS['spedisci']

  // Se c'è un id, carica i dati esistenti per la modifica.
  // SOLO IL PROPRIETARIO (proprio=true) può vedere/modificare le credenziali: un sotto-master ha una
  // COPIA propagata del contratto e non deve vederne le chiavi. Se non è suo (proprio) → torna indietro.
  let corriereEsistente: any = null
  if (id) {
    const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
    // Le CREDENZIALI non sono leggibili da 'authenticated' (il grant SELECT su corrieri e' per-colonna
    // e le tiene fuori apposta): un select('*') qui falliva l'INTERA query -> `c` null -> la pagina
    // rimbalzava sempre a /dashboard/corrieri (il pulsante Modifica sembrava non funzionare). Leggo
    // prima i campi non-segreti (RLS + proprieta'), poi le credenziali via admin SOLO dopo aver
    // verificato che il contratto e' del proprio master ed e' proprio.
    const { data: c } = await supabase.from('corrieri')
      .select('id,nome_contratto,tipo,settings,proprio,master_id')
      .eq('id', id).eq('master_id', utente?.master_id).maybeSingle()
    if (!c) redirect('/dashboard/corrieri')
    if (!(c as any)?.proprio) redirect('/dashboard/corrieri?error=' + encodeURIComponent('Solo il proprietario del contratto può modificarlo'))
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { data: credRow } = await createAdminSupabase().from('corrieri').select('credenziali').eq('id', id).maybeSingle()
    corriereEsistente = { ...(c as any), credenziali: (credRow as any)?.credenziali || {} }
  }

  const credenzialiEsistenti = corriereEsistente?.credenziali || {}
  const settingsEsistenti = corriereEsistente?.settings || {}

  return (
    <div>
      <div style={{marginBottom:'20px',fontSize:'13px',color:'#666'}}>
        ← <a href="/dashboard/corrieri" style={{color:'#f97316',textDecoration:'none'}}>Corrieri</a> / {corriereEsistente ? 'Modifica' : 'Aggiungi'} {config.titolo}
      </div>

      <h1 style={{fontSize:'20px',fontWeight:'800',color:'#1a1a1a',marginBottom:'20px'}}>{corriereEsistente ? 'Modifica' : 'Aggiungi'} {config.titolo}</h1>

      <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'12px 16px',marginBottom:'20px',fontSize:'13px',color:'#ea580c',maxWidth:'520px'}}>
        {config.info}
      </div>

      <div style={{maxWidth:'520px',background:'#fff',borderRadius:'10px',border:'1px solid #e8e8e8',overflow:'hidden'}}>
        <div style={{padding:'14px 18px',background:'#fafafa',borderBottom:'1px solid #e8e8e8',fontSize:'13.5px',fontWeight:'700',color:'#1a1a1a'}}>
          Credenziali {config.titolo}
        </div>
        <form action={salvaCorriere} style={{padding:'20px',display:'flex',flexDirection:'column',gap:'14px'}}>
          <input type="hidden" name="tipo" value={tipo||'spedisci'}/>
          {corriereEsistente && <input type="hidden" name="corriere_id" value={corriereEsistente.id}/>}
          {config.campi.map(([name,label,placeholder,inputType,opzionale]) => (
            <div key={name}>
              <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>{label}{opzionale && <span style={{color:'#9ca3af',fontWeight:400}}> (facoltativo)</span>}</label>
              <input name={name} type={inputType} placeholder={placeholder} required={!opzionale}
                defaultValue={name === 'nome_contratto' ? (corriereEsistente?.nome_contratto || '') : (credenzialiEsistenti[name] ?? settingsEsistenti[name] ?? '')}
                style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box'}}/>
            </div>
          ))}
          {tipo === 'brt' && (
            <>
              <div>
                <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Network</label>
                <select name="network" defaultValue={settingsEsistenti.network || 'Italia'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                  <option>Italia</option><option>Europa</option><option>Internazionale</option>
                </select>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>
                <input type="checkbox" name="sms_destinatario" defaultChecked={!!settingsEsistenti.sms_destinatario}/> Notifiche via SMS al destinatario
              </label>
            </>
          )}
          {tipo === 'gls' && (
            <>
              <div>
                <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Tipo Collo</label>
                <select name="tipo_collo" defaultValue={settingsEsistenti.tipo_collo || 'Normale'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                  <option>Normale</option><option>Fragile</option>
                </select>
              </div>
              <div>
                <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Tipo spedizione</label>
                <select name="tipo_spedizione" defaultValue={settingsEsistenti.tipo_spedizione === 'P' ? 'P' : 'N'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                  <option value="N">Nazionale (solo Italia)</option>
                  <option value="P">Parcel Europa (solo estero UE)</option>
                </select>
              </div>
            </>
          )}
          {tipo === 'ecosmos' && (
            <div>
              <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Servizio</label>
              <select name="servizio_ecosmos" defaultValue={['same_day','express_24h','standard_72h'].includes(settingsEsistenti.servizio) ? settingsEsistenti.servizio : 'express_24h'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                <option value="express_24h">Consegna in 24 ore (giorno lavorativo dopo il ritiro)</option>
                <option value="same_day">Consegna in giornata (solo parte della zona)</option>
                <option value="standard_72h">Consegna entro 72 ore</option>
              </select>
            </div>
          )}
          {tipo === 'spring' && (
            <>
              <div>
                <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Ambito</label>
                <select name="spring_ambito" required defaultValue={['italia','europa','internazionale'].includes(settingsEsistenti.spring_ambito) ? settingsEsistenti.spring_ambito : ''} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                  <option value="" disabled>Scegli…</option>
                  <option value="italia">Italia</option>
                  <option value="europa">Europa (paesi UE, Italia esclusa)</option>
                  <option value="internazionale">Internazionale (fuori UE: Regno Unito, Svizzera, Stati Uniti…)</option>
                </select>
              </div>
              <div>
                <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Servizio Spring</label>
                <select name="spring_servizio" required defaultValue={SERVIZI_SPRING.some(([c]) => c === settingsEsistenti.spring_servizio) ? settingsEsistenti.spring_servizio : ''} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                  <option value="" disabled>Scegli…</option>
                  {SERVIZI_SPRING.map(([c, d]) => <option key={c} value={c}>{c} — {d}</option>)}
                </select>
                <div style={{fontSize:'11px',color:'#9ca3af',marginTop:'4px'}}>Al salvataggio controlliamo con Spring che il servizio sia attivo sul tuo account.</div>
              </div>
              <div>
                <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Ambiente</label>
                <select name="ambiente_spring" required defaultValue={['prova','produzione'].includes(credenzialiEsistenti.ambiente) ? credenzialiEsistenti.ambiente : ''} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                  <option value="" disabled>Scegli…</option>
                  <option value="prova">Prova (le spedizioni non partono)</option>
                  <option value="produzione">Produzione (spedizioni vere)</option>
                </select>
              </div>
            </>
          )}
          {tipo === 'sda' && (
            <div>
              <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Tipo Contratto</label>
              <select name="tipo_contratto_sda" defaultValue={settingsEsistenti.tipo_contratto || 'ZERO_TRE'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                <option value="ZERO_TRE">ZERO TRE</option><option value="STANDARD">STANDARD</option>
              </select>
            </div>
          )}
          {tipo === 'fedex' && (
            <>
              <div>
                <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Tipo Servizio</label>
                <select name="tipo_servizio" defaultValue={settingsEsistenti.tipo_servizio || 'FEDEX_REGIONAL_ECONOMY'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                  <option value="FEDEX_REGIONAL_ECONOMY">FedEx Regional Economy (Italia)</option>
                  <option value="FIRST_OVERNIGHT">FedEx First</option>
                  <option value="PRIORITY_OVERNIGHT">FedEx Priority</option>
                  <option value="STANDARD_OVERNIGHT">FedEx Standard Overnight</option>
                  <option value="FEDEX_2_DAY">FedEx 2Day</option>
                  <option value="FEDEX_GROUND">FedEx Ground</option>
                  <option value="GROUND_HOME_DELIVERY">FedEx Home Delivery</option>
                  <option value="FEDEX_INTERNATIONAL_PRIORITY">FedEx International Priority</option>
                  <option value="INTERNATIONAL_ECONOMY">FedEx International Economy</option>
                  <option value="FEDEX_INTERNATIONAL_CONNECT_PLUS">FedEx International Connect Plus</option>
                </select>
              </div>
              <div>
                <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Tipo Ritiro</label>
                <select name="tipo_ritiro" defaultValue={settingsEsistenti.tipo_ritiro || 'USE_SCHEDULED_PICKUP'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                  <option value="USE_SCHEDULED_PICKUP">Usa ritiro programmato</option>
                  <option value="CONTACT_FEDEX_TO_SCHEDULE">Contatta FedEx per programmare</option>
                  <option value="DROPOFF_AT_FEDEX_LOCATION">Deposita presso punto FedEx</option>
                </select>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#1a1a1a',cursor:'pointer'}}>
                <input type="checkbox" name="test_mode" defaultChecked={!!settingsEsistenti.test_mode}/> Modalità test (sandbox FedEx)
              </label>
            </>
          )}
          {tipo === 'dielle' && (
            <div>
              <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Ambiente</label>
              <select name="ambiente" defaultValue={credenzialiEsistenti.ambiente || 'staging'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                <option value="staging">Test</option>
                <option value="prod">Produzione</option>
              </select>
            </div>
          )}
          {tipo === 'poste' && (
            <div>
              <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Ambiente</label>
              <select name="ambiente" defaultValue={credenzialiEsistenti.ambiente || 'demo'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                <option value="demo">Demo</option>
                <option value="prod">Produzione</option>
              </select>
            </div>
          )}
          {tipo === 'inpost' && (
            <div>
              <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Ambiente</label>
              <select name="ambiente" defaultValue={credenzialiEsistenti.ambiente || 'stage'} style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'7px',fontSize:'13px',background:'#fff'}}>
                <option value="stage">Stage (test)</option>
                <option value="prod">Produzione</option>
              </select>
            </div>
          )}
          <div style={{display:'flex',gap:'10px',justifyContent:'flex-end',marginTop:'8px'}}>
            <a href="/dashboard/corrieri" style={{padding:'9px 18px',background:'#f5f5f5',border:'1px solid #e8e8e8',borderRadius:'8px',fontSize:'13px',fontWeight:'600',color:'#666',textDecoration:'none'}}>Annulla</a>
            <button type="submit" style={{padding:'9px 22px',background:'#f97316',color:'#fff',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>{corriereEsistente ? 'Salva Modifiche' : 'Salva Contratto'}</button>
          </div>
        </form>
      </div>

      {/* Test connessione: solo per un contratto GLS diretto già salvato (proprietario). */}
      {tipo === 'gls' && corriereEsistente && <TestGls corriereId={corriereEsistente.id} />}
      {tipo === 'ecosmos' && corriereEsistente && <TestEcosmos corriereId={corriereEsistente.id} />}
      {tipo === 'spring' && corriereEsistente && <TestSpring corriereId={corriereEsistente.id} />}
    </div>
  )
}
