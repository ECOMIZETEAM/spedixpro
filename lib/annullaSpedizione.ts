import { registraMovimento, registraMovimentoMaster } from '@/lib/movimenti'
import { spediamoproCancelShipment } from '@/lib/spediamopro'

// Il corriere considera la spedizione GIÀ eliminata/inesistente → possiamo cancellarla anche da Moove.
export function giaEliminataSulCorriere(text: string, status?: number): boolean {
  if (status === 404) return true
  const t = (text || '').toLowerCase()
  return /non trovat|not found|inesistent|does not exist|gi[àa] ?(elimin|annull|cancell)|already ?(delet|cancel|removed)|no longer exists/.test(t)
}

// Invia l'annullo al corriere (SpediamoPro/Spedisci). Ritorna ok=true se annullata (o già
// inesistente sul corriere); ok=false col motivo se il corriere rifiuta (es. già spedita/chiusa).
export async function annullaSpedizioneSulCorriere(
  admin: any,
  sped: { corriere_id: string; raw_response: any; tracking_number: string | null }
): Promise<{ ok: boolean; reason?: string }> {
  const { data: corr } = await admin.from('corrieri').select('tipo,credenziali').eq('id', sped.corriere_id).maybeSingle()
  if (!corr) return { ok: true } // corriere non trovato: procedo lato Moove (nessun orfano gestibile)
  const cred: any = corr.credenziali || {}
  const raw: any = sped.raw_response || {}

  if (corr.tipo === 'spediamopro') {
    const spid = raw.id || raw?.shipmentId || raw?.data?.id || raw?.raw?.data?.id
    if (spid && cred.authcode) {
      const r = await spediamoproCancelShipment(cred.authcode, Number(spid))
      if (!r.ok && !giaEliminataSulCorriere(r.error || '')) {
        return { ok: false, reason: (r.error || '').slice(0, 160) }
      }
    }
    return { ok: true }
  }

  if (corr.tipo === 'spedisci') {
    const shipId = raw.shipmentId || raw.id
    if ((shipId || sped.tracking_number) && cred.master_domain) {
      let status = 0, body = ''
      try {
        const del = await fetch(`https://${cred.master_domain}/api/v2/shipping/delete`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${cred.password}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ increment_id: shipId, trackingNumber: sped.tracking_number }),
        })
        status = del.status
        body = await del.text().catch(() => '')
      } catch (e: any) { body = String(e?.message || e) }
      const ok = status >= 200 && status < 300
      if (!ok && !giaEliminataSulCorriere(body, status)) {
        let msg = ''
        try { msg = JSON.parse(body)?.error || '' } catch {}
        return { ok: false, reason: String(msg || body).slice(0, 160) }
      }
    }
    return { ok: true }
  }

  return { ok: true }
}

// Storno del credito speso per la spedizione: per ogni addebito reale ('spedizione') legato
// alla LDV crea un rimborso dello STESSO importo, a OGNI livello (cliente + master catena).
// Idempotente: se esistono già rimborsi per questa spedizione non li ricrea.
export async function rimborsaAnnulloSpedizione(
  admin: any,
  sped: { id: string; numero: string; dest_nome?: string | null },
  createdBy: string | null
): Promise<void> {
  try {
    const { data: giaRimborsati } = await admin.from('movimenti')
      .select('id').eq('spedizione_id', sped.id).eq('tipo', 'rimborso').limit(1)
    if (giaRimborsati?.length) return
    const { data: addebiti } = await admin.from('movimenti')
      .select('cliente_id,master_id,master_target_id,importo')
      .eq('spedizione_id', sped.id).eq('tipo', 'spedizione')
    const desc = `Rimborso ${sped.numero} - ${sped.dest_nome || ''}`.trim()
    for (const a of (addebiti || [])) {
      const importo = Math.abs(Number(a.importo || 0))
      if (!(importo > 0)) continue
      try {
        if (a.cliente_id) {
          await registraMovimento(admin, {
            masterId: a.master_id, clienteId: a.cliente_id,
            tipo: 'rimborso', descrizione: desc, riferimento: sped.numero,
            importo, spedizioneId: sped.id, createdBy,
          })
        } else if (a.master_target_id) {
          await registraMovimentoMaster(admin, {
            masterOwnerId: a.master_id, masterTargetId: a.master_target_id,
            tipo: 'rimborso', descrizione: desc, riferimento: sped.numero,
            importo, spedizioneId: sped.id, createdBy,
          })
        }
      } catch (e) { console.error('Errore storno movimento su annullo:', e) }
    }
  } catch (e) { console.error('Errore rimborso su annullo:', e) }
}
