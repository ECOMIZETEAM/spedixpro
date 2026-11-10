'use client'
import { useEffect, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import SelectCercabile from '@/app/components/SelectCercabile'

// ESTRATTO CONTO (lib/contabilita-estratti): il master carica il PDF della banca e il portale gli dice, a
// blocchi, quali bonifici pagano quali ricariche, quali sono da confermare, di chi sono quelli sconosciuti,
// quali ricariche aspettano ancora il bonifico, cliente per cliente quanto ha ricaricato e pagato, e dove
// sono andati i soldi in uscita. Solo titolare e admin, in prova per Ecomize Solution.

const eur = (n: any) => `€ ${Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const it = (d: string) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''
const ARANCIO = '#f97316', ROSSO = '#dc2626', VERDE = '#16a34a', NERO = '#1a1a1a'

export default function EstrattoConto() {
  const dialog = useDialog()
  const [estratti, setEstratti] = useState<any[]>([])
  const [r, setR] = useState<any>(null)
  const [periodo, setPeriodo] = useState<{ dal: string, al: string } | null>(null)
  const [carico, setCarico] = useState(true)
  const [errore, setErrore] = useState('')
  const [esito, setEsito] = useState('')
  const [occupato, setOccupato] = useState('')
  const [aperti, setAperti] = useState<Record<string, boolean>>({})
  const [scelte, setScelte] = useState<Record<string, string>>({})
  const [soloDiff, setSoloDiff] = useState(true)

  async function leggi(p = periodo) {
    setCarico(true); setErrore('')
    try {
      const q = p ? `?dal=${p.dal}&al=${p.al}` : ''
      const res = await fetch('/api/contabilita/estratti' + q)
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) { setErrore(d.error || 'Non riesco a leggere l\'estratto'); return }
      setEstratti(d.estratti || []); setR(d.resoconto)
      if (d.resoconto) setPeriodo(d.resoconto.periodo)
    } catch { setErrore('Errore di rete') } finally { setCarico(false) }
  }
  useEffect(() => { leggi(null) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function caricaPdf(file: File) {
    setErrore(''); setEsito(''); setOccupato('pdf')
    try {
      const base64 = await new Promise<string>((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = ko; fr.readAsDataURL(file) })
      const res = await fetch('/api/contabilita/estratti', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfBase64: base64, nomeFile: file.name }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) { setErrore(d.error || 'Caricamento non riuscito'); return }
      setEsito(`Letto l'estratto dal ${it(d.dal)} al ${it(d.al)}: ${d.righe} movimenti (${d.nuove} nuovi${d.giaPresenti ? `, ${d.giaPresenti} già caricati prima` : ''}), saldo da ${eur(d.saldoIniziale)} a ${eur(d.saldoFinale)} — torna movimento per movimento. Abbinati da soli: ${d.assegnati} bonifici, ${d.abbinati} ricariche.`)
      const p = { dal: d.dal, al: d.al }; setPeriodo(p); await leggi(p)
    } catch { setErrore('Errore di rete nel caricamento') } finally { setOccupato('') }
  }

  async function azione(chiave: string, corpo: any) {
    if (occupato) return false
    setOccupato(chiave); setErrore('')
    try {
      const res = await fetch('/api/contabilita/estratti/azione', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...corpo, ...periodo }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) { setErrore(d.error || 'Operazione non riuscita'); return false }
      await leggi(); return true
    } catch { setErrore('Errore di rete'); return false } finally { setOccupato('') }
  }

  const escludi = async (g: any) => {
    if (await dialog.confirm({ title: `«${g.nome}» non è un cliente?`, message: 'I suoi bonifici escono dai conti dei clienti (un rimborso, un giroconto…), anche nei prossimi estratti.', confirmText: 'Non è un cliente' })) {
      await azione('esc' + g.chiave, { azione: 'escludi', nome: g.nome, iban: g.iban })
    }
  }

  // Chi ha fatto il bonifico di una ricarica, scritto dopo: resta fra i nomi del cliente e, se in banca
  // c'e' un bonifico con quel nome, la ricarica si abbina subito.
  async function scriviMittente(x: any) {
    if (occupato) return
    const nome = await dialog.prompt({ title: `Chi ha fatto il bonifico per ${x.cliente}?`, placeholder: 'il nome come compare in banca', defaultValue: x.mittente || '' })
    if (nome === null) return
    setOccupato('mitt' + x.id); setErrore('')
    try {
      const res = await fetch('/api/statistiche/check-ricariche', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.id, azione: 'mittente', mittente: nome }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) { setErrore(d.error || 'Non salvato'); return }
    } catch { setErrore('Errore di rete'); return } finally { setOccupato('') }
    await leggi()
  }

  const apri = (k: string) => setAperti(a => ({ ...a, [k]: !a[k] }))
  const estrattoDelPeriodo = estratti.find(e => periodo && e.dal === periodo.dal && e.al === periodo.al)

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '22px 20px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: NERO, margin: 0 }}>Estratto conto</h1>
      <p style={{ color: '#666', fontSize: '13px', margin: '4px 0 16px' }}>
        Carica il PDF della banca: il portale abbina ogni bonifico alla ricarica che paga, ti dice quelli da confermare, quelli di cui non sa chi sia,
        le ricariche che aspettano ancora il bonifico e dove sono andati i soldi in uscita. Lo vedete solo tu e i tuoi admin.
      </p>

      {errore && <div style={avvisoErr}>⚠️ {errore}</div>}
      {esito && <div style={avvisoOk}>✅ {esito}</div>}

      <div style={{ ...card, padding: '14px 16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
        <label style={{ ...btn, opacity: occupato === 'pdf' ? 0.6 : 1 }}>
          {occupato === 'pdf' ? 'Leggo il PDF…' : '⬆ Carica estratto conto (PDF)'}
          <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} disabled={!!occupato}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) caricaPdf(f) }} />
        </label>
        <span style={{ fontSize: '12px', color: '#6b7280' }}>Per ora la «Lista movimenti» di Finom, un mese alla volta. Se ricarichi un periodo già caricato, i movimenti non si contano due volte.</span>
        {estratti.length > 0 && (
          <select value={periodo ? `${periodo.dal}|${periodo.al}` : ''} onChange={e => { const [dal, al] = e.target.value.split('|'); const p = { dal, al }; setPeriodo(p); leggi(p) }}
            style={{ marginLeft: 'auto', padding: '7px 10px', border: '1px solid #d5d5d5', borderRadius: '6px', fontSize: '13px' }}>
            {estratti.map(e => <option key={e.id} value={`${e.dal}|${e.al}`}>{it(e.dal)} – {it(e.al)} · {e.n_righe} movimenti</option>)}
          </select>
        )}
      </div>

      {carico && !r ? <div style={{ ...card, padding: '40px', textAlign: 'center', color: '#999' }}>Carico…</div>
        : !r ? <div style={{ ...card, padding: '40px', textAlign: 'center', color: '#8a8a8a', fontSize: '13px' }}>Nessun estratto caricato. Carica il PDF del conto per cominciare.</div>
        : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginBottom: '16px' }}>
              <Kpi t="Entrate" v={eur(r.totali.entrate)} s={`${r.totali.nEntrate} movimenti`} c={VERDE} />
              <Kpi t="Uscite" v={eur(r.totali.uscite)} s={`${r.totali.nUscite} movimenti`} c={ROSSO} />
              {estrattoDelPeriodo && <Kpi t="Saldo" v={eur(estrattoDelPeriodo.saldo_finale)} s={`dal ${eur(estrattoDelPeriodo.saldo_iniziale)} del ${it(estrattoDelPeriodo.dal)}`} c={NERO} />}
            </div>

            <Blocco icona="✅" titolo={`${r.abbinati.n} bonifici pagano ${r.abbinati.ricariche} ricariche`} totale={r.abbinati.totale} aperto={aperti.abb} onApri={() => apri('abb')}
              frase="Abbinati perché il nome di chi ha pagato corrisponde al cliente o a un nome salvato in «Chi paga i bonifici». Le ricariche risultano «arrivate» anche nel Check Ricariche, con la data della banca.">
              <Tabella teste={['Data', 'Bonifico da', 'Importo', 'Cliente', 'Ricariche pagate', '']} righe={r.abbinati.righe.map((x: any) => [
                it(x.data), <Nome x={x} />, eur(x.importo), x.cliente,
                x.ricariche.map((y: any) => `${it(y.giorno)} ${eur(y.importo)}`).join(' + '),
                <button style={btnLink} disabled={!!occupato} onClick={async () => { if (await dialog.confirm({ title: 'Togliere questo abbinamento?', message: 'Le ricariche tornano come erano prima nel Check Ricariche e il bonifico passa fra i «di chi è?»: lo riassegni tu.', confirmText: 'Scollega', danger: true })) azione('sc' + x.id, { azione: 'scollega', riga_id: x.id }) }}>Scollega</button>,
              ])} />
            </Blocco>

            <Blocco icona="❓" titolo={`${r.chiEe.length} pagatori: di chi sono questi bonifici?`} totale={r.chiEe.reduce((t: number, g: any) => t + g.totale, 0)} aperto={aperti.chi ?? true} onApri={() => apri('chi')}
              frase="Il nome di chi ha pagato non corrisponde a nessun cliente né a nessun nome salvato in «Chi paga i bonifici». Scegli il cliente una volta: il nome e l'IBAN restano salvati su di lui e da qui in poi i suoi bonifici si abbinano da soli.">
              {r.chiEe.map((g: any) => (
                <Gruppo key={g.chiave} g={g} aperto={aperti['g' + g.chiave]} onApri={() => apri('g' + g.chiave)}
                  testa={g.omonimi.length ? <span style={{ color: '#b45309' }}>· stesso nome di più clienti: {g.omonimi.join(', ')}</span> : null}
                  azioni={<>
                    <div style={{ minWidth: '240px' }}>
                      <SelectCercabile value={scelte[g.chiave] || ''} onChange={(e: any) => setScelte(s => ({ ...s, [g.chiave]: e.target.value }))} style={campo}>
                        <option value="">Di quale cliente è?</option>
                        {r.anagrafiche.map((a: any) => <option key={a.target} value={a.target}>{a.nome}</option>)}
                      </SelectCercabile>
                    </div>
                    <button style={btn} disabled={!!occupato || !scelte[g.chiave]} onClick={() => azione('c' + g.chiave, { azione: 'pagatore', nome: g.nome, iban: g.iban, target: scelte[g.chiave] })}>Salva</button>
                    <button style={btnSec} disabled={!!occupato} onClick={() => escludi(g)}>Non è un cliente</button>
                  </>} />
              ))}
              {!r.chiEe.length && <Vuoto>Tutti i bonifici hanno un cliente.</Vuoto>}
            </Blocco>

            <Blocco icona="❌" titolo={`${r.ricaricheSenzaBonifico.n} ricariche con il bonifico mai arrivato`} totale={r.ricaricheSenzaBonifico.totale} aperto={aperti.senza} onApri={() => apri('senza')}
              frase={`Ricariche fatte fino al ${it(r.ricaricheSenzaBonifico.dopoIl)} per cui in banca non c'è un bonifico.${r.ricaricheRecenti.n ? ` Le ${r.ricaricheRecenti.n} degli ultimi tre giorni (${eur(r.ricaricheRecenti.totale)}) non sono qui: il bonifico può arrivare nel prossimo estratto.` : ''} Se una non era un bonifico, dillo qui e non la si cerca più.`}>
              <Tabella teste={['Ricaricata il', 'Cliente', 'Importo', 'Bonifico da', 'Non era un bonifico?']} righe={r.ricaricheSenzaBonifico.righe.map((x: any) => [
                it(x.giorno), x.cliente, eur(x.importo),
                <span>{x.mittente || <span style={{ color: '#9ca3af' }}>—</span>} <button style={btnLink} disabled={!!occupato} onClick={() => scriviMittente(x)}>{x.mittente ? '✎' : '+ scrivi'}</button></span>,
                <select defaultValue="" disabled={!!occupato} onChange={e => { const v = e.target.value; if (v) azione('m' + x.id, { azione: 'metodo', ricarica_id: x.id, metodo: v }) }} style={{ ...campo, width: 'auto', padding: '4px 6px', fontSize: '12px' }}>
                  <option value="">—</option><option value="cod_compensati">Contrassegni compensati</option><option value="contanti">Contanti</option><option value="altro">Altro</option>
                </select>,
              ])} />
            </Blocco>

            <Blocco icona="👥" titolo="Cliente per cliente: ricaricato e pagato" aperto={aperti.cli ?? true} onApri={() => apri('cli')}
              frase={`Nel periodo: quanto gli avete ricaricato con bonifico e quanto ha pagato in banca. ${r.pagatiSenzaRicarica.n ? `${r.pagatiSenzaRicarica.n} bonifici (${eur(r.pagatiSenzaRicarica.totale)}) sono di un cliente ma non pagano una ricarica precisa: contano nel pagato.` : ''}`}
              azioni={<label style={{ fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={soloDiff} onChange={e => setSoloDiff(e.target.checked)} /> solo chi ha una differenza</label>}>
              <Tabella teste={['Cliente', 'Ricaricato', 'Pagato', 'Differenza']} destra={[1, 2, 3]} righe={r.perCliente.filter((x: any) => !soloDiff || Math.abs(x.differenza) >= 0.01).map((x: any) => [
                x.nome, `${eur(x.ricaricato)} (${x.ricariche})`, `${eur(x.pagato)} (${x.bonifici})`,
                <b style={{ color: x.differenza < 0 ? ROSSO : x.differenza > 0 ? '#2563eb' : VERDE }}>{x.differenza > 0 ? '+' : ''}{eur(x.differenza)}{x.differenza < 0 ? ' da pagare' : x.differenza > 0 ? ' pagato in più' : ''}</b>,
              ])} />
            </Blocco>

            <Blocco icona="💸" titolo={`Uscite: ${eur(-r.totali.uscite)}`} aperto={aperti.usc ?? true} onApri={() => apri('usc')}
              frase="Dove sono andati i soldi, per voce. Ai bonifici verso una controparte puoi dare una voce tua (es. «Fornitore spedizioni»): vale anche per i prossimi.">
              {r.uscite.map((v: any) => (
                <div key={v.voce} style={{ borderTop: '1px solid #f0f0f0', padding: '8px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={() => apri('u' + v.voce)} style={{ ...btnLink, padding: 0, color: NERO, fontWeight: 700, fontSize: '13px' }}>{aperti['u' + v.voce] ? '▾' : '▸'} {v.voce}</button>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>{v.n} movimenti</span>
                    <b style={{ marginLeft: 'auto', color: ROSSO, fontSize: '13px' }}>{eur(-v.totale)}</b>
                    {v.controparti.length === 1 && v.righe[0]?.iban && (
                      <button style={btnLink} disabled={!!occupato} onClick={async () => {
                        const voce = await dialog.prompt({ title: `Voce per i bonifici a «${v.controparti[0]}»`, placeholder: 'es. Fornitore spedizioni (vuoto = torna automatica)', defaultValue: v.voce.startsWith('Bonifici a ') ? '' : v.voce })
                        if (voce !== null) azione('v' + v.voce, { azione: 'voce', controparte: v.controparti[0], voce })
                      }}>Dai una voce</button>
                    )}
                  </div>
                  {aperti['u' + v.voce] && <Tabella teste={['Data', 'A chi', 'Causale', 'Importo']} destra={[3]} righe={v.righe.map((x: any) => [it(x.data), x.nome, x.causale || '—', eur(-x.importo)])} />}
                </div>
              ))}
            </Blocco>

            <div style={{ fontSize: '12px', color: '#6b7280', margin: '4px 2px 20px' }}>
              {r.altriMetodi.n > 0 && <>Ricariche pagate in altro modo (contanti, contrassegni compensati): {r.altriMetodi.n} per {eur(r.altriMetodi.totale)}, non si cercano in banca. </>}
              {r.esclusi.n > 0 && <>Bonifici di chi non è un cliente: {r.esclusi.n} per {eur(r.esclusi.totale)}. </>}
              {r.altreEntrate.n > 0 && <>Altre entrate senza IBAN (rimborsi della carta): {r.altreEntrate.n} per {eur(r.altreEntrate.totale)}.</>}
            </div>
          </>
        )}
    </div>
  )
}

function Kpi({ t, v, s, c }: any) {
  return (
    <div style={{ ...card, padding: '14px 16px' }}>
      <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>{t}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: c, marginTop: '4px' }}>{v}</div>
      {s && <div style={{ fontSize: '11.5px', color: '#8a8a8a', marginTop: '2px' }}>{s}</div>}
    </div>
  )
}

function Blocco({ icona, titolo, totale, frase, aperto, onApri, azioni, children }: any) {
  return (
    <div style={{ ...card, marginBottom: '14px' }}>
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', borderBottom: aperto ? '1px solid #f0f0f0' : 'none' }}>
        <button onClick={onApri} style={{ ...btnLink, padding: 0, color: NERO, fontSize: '14px', fontWeight: 700 }}>{aperto ? '▾' : '▸'} {icona} {titolo}</button>
        {totale !== undefined && <b style={{ fontSize: '14px', color: NERO }}>{eur(totale)}</b>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>{azioni}</span>
        {frase && <div style={{ flexBasis: '100%', fontSize: '12px', color: '#6b7280' }}>{frase}</div>}
      </div>
      {aperto && <div style={{ padding: '4px 16px 12px' }}>{children}</div>}
    </div>
  )
}

function Gruppo({ g, testa, azioni, aperto, onApri }: any) {
  return (
    <div style={{ borderTop: '1px solid #f0f0f0', padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontSize: '13px' }}><b>{g.nome || '(senza nome)'}</b> {testa}</div>
          <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>
            {g.n} bonifici · <b style={{ color: NERO }}>{eur(g.totale)}</b>{g.iban ? ` · IBAN ${g.iban}` : ''}{g.causali.length ? ` · «${g.causali.join('», «')}»` : ''}
            {' '}<button onClick={onApri} style={{ ...btnLink, padding: 0, fontSize: '11.5px' }}>{aperto ? 'nascondi' : 'vedi i bonifici'}</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>{azioni}</div>
      </div>
      {aperto && <Tabella teste={['Data', 'Causale', 'Importo']} destra={[2]} righe={g.righe.map((x: any) => [it(x.data), x.causale || '—', eur(x.importo)])} />}
    </div>
  )
}

function Nome({ x }: any) {
  return <span>{x.nome}{x.causale ? <span style={{ display: 'block', fontSize: '11px', color: '#9ca3af' }}>{x.causale}</span> : null}</span>
}

function Tabella({ teste, righe, destra = [] }: { teste: string[], righe: any[][], destra?: number[] }) {
  if (!righe.length) return <Vuoto>Niente.</Vuoto>
  return (
    <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto', marginTop: '6px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
        <thead><tr>{teste.map((h, i) => <th key={i} style={{ ...th, textAlign: destra.includes(i) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
        <tbody>{righe.map((rr, i) => <tr key={i}>{rr.map((c, j) => <td key={j} style={{ ...td, textAlign: destra.includes(j) ? 'right' : 'left' }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function Vuoto({ children }: any) { return <div style={{ padding: '12px 0', fontSize: '12.5px', color: '#9ca3af' }}>{children}</div> }

const card: any = { background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' }
const th: any = { padding: '7px 10px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#666', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff' }
const td: any = { padding: '7px 10px', color: NERO, borderTop: '1px solid #f3f3f3', verticalAlign: 'top' }
const btn: any = { background: ARANCIO, color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 12px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-block' }
const btnSec: any = { background: '#fff', color: '#555', border: '1px solid #d5d5d5', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
const btnLink: any = { background: 'none', border: 'none', color: ARANCIO, fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: '0 4px' }
const campo: any = { width: '100%', padding: '7px 10px', border: '1px solid #d5d5d5', borderRadius: '6px', fontSize: '13px', color: NERO, background: '#fff', boxSizing: 'border-box' }
const avvisoErr: any = { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }
const avvisoOk: any = { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }
