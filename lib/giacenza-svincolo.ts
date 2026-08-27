import { spediamoproSearchStocks, spediamoproReleaseStock } from '@/lib/spediamopro'
import { erroreSvincoloPulito } from '@/lib/errore-corriere'
import { registraMovimento } from '@/lib/movimenti'
import { addebitaServizioGiacenza } from '@/lib/giacenza-cascata'

// LA PORTA UNICA DELLO SVINCOLO. La usano tutte le strade — il portale (GiacenzaDettaglio →
// conferma_svincolo), l'svincolo massivo, l'API v1 — così la regola che decide CHI PAGA COSA e che
// PARLA COL CORRIERE sta in un posto solo, non copiata in ogni rotta (era il rischio: una porta
// aggiornata e le altre no). Estratta 1:1 dal flusso del portale che già funziona.
//
// Invia lo svincolo al corriere (SpediamoPro / DVA / Spedisci), addebita a cascata SOLO il servizio
// (l'apertura è già stata addebitata all'ENTRATA in giacenza dal cron), chiude la richiesta e marca
// la spedizione 'svincolata'. Se il corriere RIFIUTA lancia un Error col messaggio pulito: chi
// chiama lo trasforma in 400 e NON marca svincolata (niente 'svincolata' senza svincolo reale).
//
// Ritorna { addebito, distintaReso, avviso }. `avviso` è una segnalazione non bloccante (es. il
// corriere aveva registrato "rifiutato") da mostrare a chi opera.
export async function eseguiSvincolo(
  admin: any,
  sped: any,
  rich: any,
  nomeUtente: string,
): Promise<{ addebito: number; distintaReso: number | null; avviso: string | null }> {
  const id = sped.id

  const { data: costiManuali } = await admin.from('giacenza_costi').select('importo').eq('spedizione_id', id)
  const extra = (costiManuali || []).reduce((s: number, c: any) => s + (Number(c.importo) || 0), 0)
  const totale = +((Number(rich.costo_totale) || 0) + extra).toFixed(2)

  const opLabel: Record<string, string> = { riconsegna: 'Riconsegna', riconsegna_nuovo: 'Riconsegna a nuovo destinatario', reso: 'Reso al mittente' }
  const istr = `${opLabel[rich.operazione] || rich.operazione}${rich.data_operazione ? ' - data ' + rich.data_operazione : ''}${rich.note ? ' - ' + rich.note : ''}`

  // Invio dello svincolo al corriere.
  let avviso: string | null = null
  const cred = (sped.corrieri?.credenziali || {}) as Record<string, any>
  if (cred?.authcode) {
    // SpediamoPro: rilascio dello STOCK (giacenza). riconsegna=1, nuovo indirizzo=2, reso=3.
    const raw: any = sped.raw_response || {}
    const spid = raw.id || raw?.raw?.data?.id
    const code = raw.code || raw?.raw?.data?.code || sped.tracking_number
    const releaseAction = rich.operazione === 'reso' ? 3 : rich.operazione === 'riconsegna_nuovo' ? 2 : 1
    const extraSp: any = {}
    if (rich.note) extraSp.instructions = String(rich.note)
    if (releaseAction === 2) {
      const nd = rich.nuovo_destinatario || {}
      extraSp.alternativeAddress = {
        name: nd.nome || sped.dest_nome || '', address: nd.indirizzo || '', postalCode: nd.cap || '',
        city: nd.citta || '', province: nd.provincia || '', country: 'IT',
        ...(nd.telefono ? { phone: String(nd.telefono) } : {}),
      }
    }
    try {
      const stocks = await spediamoproSearchStocks(cred.authcode, String(code))
      const attivo = (stocks || []).find((st: any) => Number(st.status) === 1 && (!spid || Number(st.shipmentId) === Number(spid)))
      if (!attivo?.id) throw new Error('Giacenza non più attiva sul corriere (già svincolata o scaduta).')
      const motivo = String(attivo.reason || '')
      if (motivo) { try { await admin.from('spedizioni').update({ giacenza_motivo: motivo.slice(0, 200) }).eq('id', id) } catch {} }
      // NIENTE BLOCCHI sulla causale: i corrieri a volte registrano un motivo sbagliato. Si avvisa.
      if (/rifiut|refus|respint/i.test(motivo) && releaseAction !== 3) {
        avviso = `Il corriere aveva registrato "${motivo}": su un pacco rifiutato la riconsegna viene spesso respinta. Se non va a buon fine, resta il "Reso al mittente".`
      }
      if (/indirizzo\s*(errato|inesistente|incompleto)|sconosciut|manca civico|incompl/i.test(motivo) && releaseAction === 1) {
        avviso = `Il corriere aveva segnalato "${motivo}": la riconsegna allo stesso indirizzo potrebbe fallire di nuovo. Se non va a buon fine, usa "Riconsegna a nuovo indirizzo" o "Reso al mittente".`
      }
      await spediamoproReleaseStock(cred.authcode, Number(attivo.id), releaseAction, extraSp)
    } catch (e: any) {
      throw new Error(erroreSvincoloPulito(e))
    }
  } else if (sped.corrieri?.tipo === 'easyparcel' && cred?.apikey) {
    // DVA: lo svincolo si chiede con la LDV. riconsegna=D, reso=M, nuovo indirizzo=N.
    const { easyparcelSvincolo } = await import('@/lib/easyparcel')
    const azioneV = rich.operazione === 'reso' ? 'M' : rich.operazione === 'riconsegna_nuovo' ? 'N' : 'D'
    const nd = rich.nuovo_destinatario || {}
    try {
      const esito = await easyparcelSvincolo(cred.apikey, String(sped.numero || sped.tracking_number), azioneV as any, {
        note: istr,
        telefonoDestinatario: nd.telefono || sped.dest_telefono || '',
        nuovoIndirizzo: azioneV === 'N' ? {
          cognome: nd.nome || sped.dest_nome || '', indirizzo: nd.indirizzo || '',
          cap: nd.cap || '', localita: nd.citta || '', provincia: nd.provincia || '', telefono: nd.telefono || '',
        } : undefined,
      })
      try {
        await admin.from('giacenza_richieste')
          .update({ note: [rich.note, `[corriere: ${esito.azione} - € ${esito.importo.toFixed(2)}${esito.idGiacenza ? ' - rif ' + esito.idGiacenza : ''}]`].filter(Boolean).join(' ') })
          .eq('id', rich.id)
      } catch {}
    } catch (e: any) {
      throw new Error(erroreSvincoloPulito(e))
    }
  } else if (cred?.master_domain && cred?.password && (sped.tracking_number || sped.numero)) {
    // Spedisci.online: rilascio via POST /api/v2/stock/update (endpoint corretto). riconsegna=RETRY,
    // nuovo indirizzo=NEWADDRESS, reso=RETURN. Blocca sull'errore come gli altri.
    const ldvV = String(sped.tracking_number || sped.numero)
    const actionV = rich.operazione === 'reso' ? 'RETURN' : rich.operazione === 'riconsegna_nuovo' ? 'NEWADDRESS' : 'RETRY'
    let gg = rich.data_operazione ? new Date(rich.data_operazione) : new Date()
    if (isNaN(gg.getTime())) gg = new Date()
    const scheduledV = `${String(gg.getDate()).padStart(2, '0')}/${String(gg.getMonth() + 1).padStart(2, '0')}/${gg.getFullYear()}`
    const ndV = rich.nuovo_destinatario || {}
    const bodyV: any = { ldv: ldvV, action: actionV, scheduled_at: scheduledV, note: (rich.note || istr || '').slice(0, 200) }
    if (actionV === 'NEWADDRESS') {
      const telV = Number(String(ndV.telefono || sped.dest_telefono || '').replace(/\D/g, '')) || undefined
      bodyV.newaddress = {
        name: ndV.nome || sped.dest_nome || '', street1: ndV.indirizzo || '', city: ndV.citta || '',
        state: ndV.provincia || '', postalCode: ndV.cap || '', country: 'IT',
        ...(telV ? { phone: telV } : {}),
        email: ndV.email || sped.dest_email || 'noreply@moovexpress.com',
        notes: (rich.note || istr || '').slice(0, 200),
      }
    }
    try {
      const rv = await fetch(`https://${cred.master_domain}/api/v2/stock/update`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyV),
      })
      if (!rv.ok) {
        const t = await rv.text().catch(() => '')
        throw new Error(`Spedisci HTTP ${rv.status}${t ? ' - ' + t.slice(0, 140) : ''}`)
      }
    } catch (e: any) {
      throw new Error(erroreSvincoloPulito(e))
    }
  }

  // ADDEBITO: solo il servizio scelto (l'apertura è già stata addebitata all'ENTRATA in giacenza).
  // Il RESO non guarda giacenza_addebito_effettuato (un pacco può finire in giacenza due volte).
  let resoAddebitato = false
  let importoResoCliente = 0
  if (rich.operazione === 'reso') {
    const esito = await addebitaServizioGiacenza(
      { id, numero: sped.numero, cliente_id: sped.cliente_id, master_id: sped.master_id, corriere_id: sped.corriere_id },
      'reso', 0,
    )
    resoAddebitato = esito.addebitato
    importoResoCliente = esito.importoCliente
  }
  if (!sped.giacenza_addebito_effettuato) {
    if (rich.operazione !== 'reso') {
      await addebitaServizioGiacenza(
        { id, numero: sped.numero, cliente_id: sped.cliente_id, master_id: sped.master_id, corriere_id: sped.corriere_id },
        rich.operazione, Number(rich.costo_servizio) || 0,
      )
    }
    if (extra > 0) {
      await registraMovimento(admin, { masterId: sped.master_id, clienteId: sped.cliente_id, tipo: 'giacenza',
        descrizione: `Costi giacenza ${sped.numero}`, riferimento: sped.numero, importo: -Math.abs(extra), spedizioneId: id })
    }
  }

  await admin.from('giacenza_richieste').update({ stato: 'confermata', confermata_da: nomeUtente, confermata_at: new Date().toISOString() }).eq('id', rich.id)

  // RESO → distinta resi (già addebitata a cascata), così l'Elenco mostra "Distinta N" e la scansione
  // resi non riaddebita.
  let numeroDistintaReso: number | null = null
  if (rich.operazione === 'reso' && sped.cliente_id) {
    const { data: esistenti } = await admin.from('distinte_resi').select('voci').eq('master_id', sped.master_id)
    const gia = new Set<string>()
    for (const d of (esistenti || [])) for (const v of (Array.isArray((d as any).voci) ? (d as any).voci : [])) if (v?.id) gia.add(v.id)
    if (!gia.has(id)) {
      const { count } = await admin.from('distinte_resi').select('id', { count: 'exact', head: true }).eq('master_id', sped.master_id)
      numeroDistintaReso = (count || 0) + 1
      await admin.from('distinte_resi').insert({
        master_id: sped.master_id, cliente_id: sped.cliente_id, numero: numeroDistintaReso,
        totale_ldv: 1, totale: importoResoCliente,
        voci: [{ id, numero: sped.numero }], stato: 'chiusa',
      })
    }
  }

  await admin.from('spedizioni').update({
    giacenza_stato: 'svincolata', giacenza_istruzioni: istr, giacenza_addebito_effettuato: true,
    ...(rich.operazione === 'reso' ? { stato: 'reso_mittente', ...(resoAddebitato ? { giacenza_reso_addebitato: true } : {}) } : {}),
  }).eq('id', id)

  return { addebito: totale, distintaReso: numeroDistintaReso, avviso }
}
