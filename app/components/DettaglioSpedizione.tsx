'use client'
import React from 'react'

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', overflow: 'hidden' }
const cardH: React.CSSProperties = { padding: '11px 15px', borderBottom: '1px solid #f0f0f0', fontSize: '13px', fontWeight: 700, color: '#1a1a1a', background: '#fafafa' }
const cardB: React.CSSProperties = { padding: '14px 15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 18px' }
const lblS: React.CSSProperties = { fontSize: '10.5px', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '2px' }
const valS: React.CSSProperties = { fontSize: '13px', color: '#1a1a1a', fontWeight: 500, wordBreak: 'break-word' }

function F({ label, value, full }: { label: string; value: any; full?: boolean }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <div style={lblS}>{label}</div>
      <div style={valS}>{value != null && value !== '' ? value : '—'}</div>
    </div>
  )
}

export default function DettaglioSpedizione({ s, onClose, etichettaHref }: { s: any; onClose: () => void; etichettaHref?: string }) {
  if (!s) return null
  const eur = (x: any) => '€ ' + Number(x || 0).toFixed(2)
  const dims = [s.lunghezza, s.larghezza, s.altezza].every((x: any) => Number(x) > 0) ? `${s.lunghezza} × ${s.larghezza} × ${s.altezza} cm` : '—'
  const accessori = (s.servizi_accessori || []).map((e: any) => `${e.nome}${e.importo ? ' (€' + Number(e.importo).toFixed(2) + ')' : ''}`).join(', ')

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '30px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#f6f7f8', borderRadius: '12px', width: '100%', maxWidth: '760px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', borderRadius: '12px 12px 0 0' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#1a1a1a' }}>Dettaglio spedizione</div>
            <div style={{ fontSize: '12px', color: '#f97316', fontWeight: 700, marginTop: '2px' }}>{s.numero}{s.tracking_number ? ` · ${s.tracking_number}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={card}>
              <div style={cardH}>Mittente</div>
              <div style={cardB}>
                <F label="Nome" value={s.mitt_nome} full />
                <F label="Indirizzo" value={s.mitt_indirizzo} full />
                <F label="Città" value={s.mitt_citta} />
                <F label="Prov / CAP" value={`${s.mitt_provincia || ''} ${s.mitt_cap || ''}`.trim()} />
                <F label="Paese" value={s.mitt_paese} />
                <F label="Telefono" value={s.mitt_telefono} />
                <F label="Email" value={s.mitt_email} full />
              </div>
            </div>
            <div style={card}>
              <div style={cardH}>Destinatario</div>
              <div style={cardB}>
                <F label="Nome" value={s.dest_nome} full />
                <F label="Indirizzo" value={s.dest_indirizzo} full />
                <F label="Città" value={s.dest_citta} />
                <F label="Prov / CAP" value={`${s.dest_provincia || ''} ${s.dest_cap || ''}`.trim()} />
                <F label="Paese" value={s.dest_paese} />
                <F label="Telefono" value={s.dest_telefono} />
                <F label="Email" value={s.dest_email} full />
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={cardH}>Spedizione</div>
            <div style={{ ...cardB, gridTemplateColumns: '1fr 1fr 1fr' }}>
              <F label="Corriere" value={s.corrieri?.nome_contratto} />
              <F label="Stato" value={String(s.stato || '').replace(/_/g, ' ')} />
              <F label="Data" value={s.created_at ? new Date(s.created_at).toLocaleString('it-IT') : '—'} />
              <F label="Colli" value={s.colli} />
              <F label="Peso reale" value={s.peso_reale != null ? `${s.peso_reale} kg` : '—'} />
              <F label="Dimensioni" value={dims} />
              <F label="Contrassegno" value={Number(s.contrassegno) > 0 ? eur(s.contrassegno) : '—'} />
              <F label="Assicurazione" value={Number(s.assicurazione) > 0 ? eur(s.assicurazione) : '—'} />
              <F label="Valore merce" value={Number(s.valore_merce) > 0 ? eur(s.valore_merce) : '—'} />
              <F label="Contenuto" value={s.contenuto} full />
              <F label="Servizi accessori" value={accessori || '—'} full />
              <F label="Note" value={s.note} full />
            </div>
          </div>

          <div style={card}>
            <div style={cardH}>Costo</div>
            <div style={cardB}>
              <F label="Prezzo" value={<span style={{ fontWeight: 800, color: '#16a34a', fontSize: '15px' }}>{eur(s.costo_totale)}</span>} />
              {s.richiedi_ritiro ? <F label="Ritiro richiesto" value={`${s.data_ritiro || ''} ${s.intervallo_ritiro || ''}`.trim() || 'Sì'} /> : <div />}
            </div>
          </div>
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid #e8e8e8', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: '#fff', borderRadius: '0 0 12px 12px' }}>
          {etichettaHref && <a href={etichettaHref} download style={{ padding: '9px 16px', background: '#fff7ed', color: '#ea580c', border: '1px solid #fed7aa', borderRadius: '7px', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>🖨️ Etichetta</a>}
          <button onClick={onClose} style={{ padding: '9px 18px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Chiudi</button>
        </div>
      </div>
    </div>
  )
}
