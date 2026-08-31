import { marchioCorriere } from '@/lib/corriere-logo'

// Righe del REPORT SPEDIZIONI con le colonne del template richiesto dai master (34), piu' le nostre extra.
// UNICO builder per master e cliente/agente cosi' l'ordine e i nomi delle colonne coincidono sempre e il
// portale cliente/agente NON puo' includere per sbaglio le colonne che sono affari del MASTER
// (prezzo_corriere = costo del corriere = margine; Margine; Rettifica): con master=false quelle colonne
// non vengono proprio create.
//
// I dati arrivano gia' pronti dai route report: il route MASTER rinomina costo_totale nel PREZZO CLIENTE
// calcolato (di rete) e aggiunge prezzo_corriere/rettifica; il route CLIENTE porta costo_totale grezzo
// (quello che paga lui) e NON porta prezzo_corriere. Entrambi aggiungono corrieri(nome_contratto),
// distinte(data,bordero_id) e data_consegna.

function dataIT(v: any): string {
  if (!v) return ''
  const d = new Date(v)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('it-IT')
}
function statoLabel(s: any): string {
  const t = String(s || '').replace(/_/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''
}
// Consegnata = consegna AVVENUTA, non "in consegna" (uscita in consegna): quest'ultima non ha una data
// di consegna vera. Serve a decidere se valorizzare Data_consegna.
function eConsegnata(s: any): boolean {
  const t = String(s || '')
  return /conseg/i.test(t) && !/in[\s_]?conseg/i.test(t)
}
function servicesTxt(v: any): string {
  if (!v) return ''
  if (Array.isArray(v)) return v.map((x: any) => (x?.nome || x?.tipo || x?.descrizione || x)).filter(Boolean).join(', ')
  if (typeof v === 'object') return Object.values(v).filter(Boolean).join(', ')
  return String(v)
}

export function righeReportSpedizioni(spedizioni: any[], opts?: { master?: boolean }): any[] {
  const master = !!opts?.master
  return (spedizioni || []).map((s: any) => {
    const contratto = s.corrieri?.nome_contratto || ''
    const riga: Record<string, any> = {
      ldv: s.tracking_number || s.numero || '',
      Corriere: marchioCorriere(contratto),          // brand pubblico, mai il provider tecnico
      Contratto: contratto,
      Cliente: s.clienti?.ragione_sociale || s.mitt_nome || '',
      RiferimentoMittente: s.mitt_nome || '',
      CittaMittente: s.mitt_citta || '',
      CAPMittente: s.mitt_cap || '',
      destinatario: s.dest_nome || '',
      cap: s.dest_cap || '',
      citta: s.dest_citta || '',
      provincia: s.dest_provincia || '',
      country_id: s.dest_paese || '',
      RiferimentoDestinatario: s.rif_destinatario || '',
      colli: s.colli ?? '',
      peso: s.peso_reale ?? '',
      peso_volume: s.peso_volume ?? '',
      peso_tassabile: s.peso_fatturato ?? '',
      costo_cliente: Number(s.costo_totale || 0),
    }
    // COLONNA DEL MASTER: costo del corriere (= margine). NON esce a cliente/agente-cliente.
    if (master) riga.prezzo_corriere = s.prezzo_corriere != null ? Number(s.prezzo_corriere) : ''
    riga.contrassegno = Number(s.contrassegno || 0)
    riga.valore_assicurazione = Number(s.assicurazione || 0)
    riga.bda = s.distinte?.bordero_id || ''
    riga.order_id = s.rif_ordine || s.id_ordine_esterno || ''
    riga.canale = s.canale || ''
    riga.Data_spedizione = dataIT(s.created_at)
    riga.Data_distinta = dataIT(s.distinte?.data)
    riga.status = statoLabel(s.stato)
    riga.Data_consegna = eConsegnata(s.stato) ? dataIT(s.data_consegna || s.updated_at) : ''
    riga.Ultimo_aggiornamento = dataIT(s.updated_at)
    riga.contenuto = s.contenuto || ''
    riga.note = s.note || ''
    riga.order_tags = ''
    riga.costo = Number(s.costo_totale || 0)
    riga.Services = servicesTxt(s.servizi_accessori)
    // EXTRA nostri (dopo le 34 del template), solo per il MASTER (sono i suoi numeri).
    if (master) {
      riga.Margine = s.prezzo_corriere != null ? Math.round((Number(s.costo_totale || 0) - Number(s.prezzo_corriere || 0)) * 100) / 100 : ''
      riga.Rettifica = Number(s.rettifica || 0)
    }
    return riga
  })
}
