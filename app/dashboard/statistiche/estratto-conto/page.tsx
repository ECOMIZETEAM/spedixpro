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
  // I blocchi che partono aperti hanno il valore iniziale qui e non in un `?? true` sul blocco, altrimenti il
  // primo clic per chiuderli li riapriva (!undefined = true).
  const [aperti, setAperti] = useState<Record<string, boolean>>({ chi: true, cli: true, usc: true, giro: true })
  // Le ricariche senza bonifico, di chi: tutte, del master ('mio') o di un sotto-master sul conto (il suo id).
  // Con Ecomize LL e Dg Express a ottobre passano da 191 a 407: tutte insieme non si leggono.
  const [filtroSenza, setFiltroSenza] = useState('')
  // I clienti scelti per ogni pagatore del "di chi e'?": uno, o piu' profili pagati con un bonifico solo.
  // Finche' il master non tocca, valgono quelli a cui l'IBAN e' gia' salvato (g.noti).
  const [scelte, setScelte] = useState<Record<string, string[]>>({})
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

  async function azione(chiave: string, corpo: any): Promise<any> {
    if (occupato) return null
    setOccupato(chiave); setErrore('')
    try {
      const res = await fetch('/api/contabilita/estratti/azione', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...corpo, ...periodo }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) { setErrore(d.error || 'Operazione non riuscita'); return null }
      await leggi(); return d
    } catch { setErrore('Errore di rete'); return null } finally { setOccupato('') }
  }

  const sceltiDi = (g: any): string[] => scelte[g.chiave] ?? (g.noti || []).map((n: any) => n.target)
  const nomeTarget = (t: string) => r?.anagrafiche.find((a: any) => a.target === t)?.nome || '—'

  // Dopo il salvataggio si dice subito cosa e' successo ai bonifici di quel pagatore: con piu' profili e'
  // l'unico modo di capire se la scelta torna senza andarla a cercare fra gli abbinati.
  async function salvaPagatore(g: any) {
    const targets = sceltiDi(g)
    if (!targets.length) return
    setEsito('')
    const d = await azione('c' + g.chiave, { azione: 'pagatore', nome: g.nome, iban: g.iban, targets })
    if (!d?.pagatore) return
    const p = d.pagatore
    const chi = targets.length > 1 ? `${targets.length} profili (${targets.map(nomeTarget).join(', ')})` : nomeTarget(targets[0])
    const unoMolti = (n: number, uno: string, molti: string) => `${n} ${n === 1 ? uno : molti}`
    setEsito(`«${g.nome}» salvato su ${chi}. ${p.conRicarica
      ? `${unoMolti(p.conRicarica, 'bonifico paga', 'bonifici pagano')} ${unoMolti(p.ricariche, 'ricarica', 'ricariche')}.` : 'Nessun bonifico trova una ricarica che torni.'}${p.senzaRicarica
      ? ` ${unoMolti(p.senzaRicarica, 'resta', 'restano')} senza una ricarica che torni: li trovi nel blocco «bonifici di un cliente senza una ricarica».` : ''}`)
  }

  const scollega = async (x: any) => {
    if (await dialog.confirm({ title: 'Togliere questo abbinamento?', message: 'Le ricariche tornano come erano prima nel Check Ricariche e il bonifico passa fra i «di chi è?»: lo riassegni tu. Se il cliente era sbagliato, il portale se lo dimentica per i prossimi bonifici.', confirmText: 'Scollega', danger: true })) {
      await azione('sc' + x.id, { azione: 'scollega', riga_id: x.id })
    }
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

  // IL GIRO AI SOTTO-MASTER: decide sempre il master (Lorenzo, 10/11). Una conferma con le cifre, poi una
  // ricarica sola; il database non lascia girare due volte la stessa ricarica.
  async function gira(x: any) {
    const d = x.daGirare
    const dal = d.righe[0]?.bonifico.data, al = d.righe[d.righe.length - 1]?.bonifico.data
    if (!await dialog.confirm({ title: `Ricaricare ${x.nome} di ${eur(d.totale)}?`,
      message: `Sono ${d.n} ${d.n === 1 ? 'ricarica' : 'ricariche'} dei suoi clienti, pagate dai bonifici arrivati sul tuo conto ${dal === al ? `il ${it(dal)}` : `dal ${it(dal)} al ${it(al)}`}. ${x.nome} vedrà la ricarica nei suoi movimenti. Se ti accorgi di un errore, il giro si annulla.`,
      confirmText: `Ricarica ${eur(d.totale)}` })) return
    setEsito('')
    const e = await azione('giro' + x.id, { azione: 'gira', sotto: x.id, ricariche: d.righe.map((y: any) => y.id) })
    if (e) setEsito(`Ricaricata ${x.nome} di ${eur(e.importo)}: ${e.ricariche} ${e.ricariche === 1 ? 'ricarica' : 'ricariche'} dei suoi clienti. Il suo credito ora è ${eur(e.saldo)}.`)
  }
  async function annullaGiro(g: any) {
    if (!await dialog.confirm({ title: `Annullare il giro del ${it(g.il)} a ${g.sotto}?`,
      message: `A ${g.sotto} si tolgono ${eur(g.importo)} con una rettifica (la ricarica resta nello storico). Le sue ${g.n} ricariche tornano da girare.`,
      confirmText: 'Annulla il giro', danger: true })) return
    setEsito('')
    const e = await azione('ag' + g.id, { azione: 'annulla_giro', giro: g.id })
    if (e) setEsito(`Giro annullato: tolti ${eur(e.importo)} a ${g.sotto}.`)
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
                // Con due profili si vede quale ricarica e' di chi.
                x.ricariche.map((y: any) => `${it(y.giorno)} ${eur(y.importo)}${new Set(x.ricariche.map((z: any) => z.cliente)).size > 1 ? ` (${y.cliente})` : ''}`).join(' + '),
                // Girato al sotto-master: non si scollega, si annulla il giro (blocco «Da girare»).
                x.girato ? <span style={{ fontSize: '11px', color: '#6b7280', whiteSpace: 'nowrap' }}>{x.girato}</span>
                  : <button style={btnLink} disabled={!!occupato} onClick={() => scollega(x)}>Scollega</button>,
              ])} />
            </Blocco>

            {r.pagatiSenzaRicarica.n > 0 && (
              <Blocco icona="⚠️" titolo={`${r.pagatiSenzaRicarica.n} bonifici di un cliente senza una ricarica che torni`} totale={r.pagatiSenzaRicarica.totale} aperto={aperti.psr} onApri={() => apri('psr')}
                frase="Il pagatore è del cliente (nome o IBAN), ma nessuna sua ricarica ha lo stesso importo: per esempio ha pagato 500 € e la ricarica era di 400. Contano nel pagato del cliente; se la ricarica arriva dopo, si abbinano da soli. Se il cliente è sbagliato, scollegalo.">
                <Tabella teste={['Data', 'Bonifico da', 'Importo', 'Cliente', '']} righe={r.pagatiSenzaRicarica.righe.map((x: any) => [
                  it(x.data), <Nome x={x} />, eur(x.importo), x.cliente,
                  <button style={btnLink} disabled={!!occupato} onClick={() => scollega(x)}>Scollega</button>,
                ])} />
              </Blocco>
            )}

            {r.giri && (
              <Blocco icona="↪" titolo={`Da girare ai sotto-master: ${eur(r.giri.sotto.reduce((t: number, x: any) => t + x.daGirare.totale, 0))}`} aperto={aperti.giro} onApri={() => apri('giro')}
                frase={`Sul tuo conto arrivano anche i bonifici dei clienti di ${r.giri.sotto.map((x: any) => x.nome).join(' e ')}. Quando un bonifico paga una ricarica che il sotto-master ha fatto al suo cliente, quella ricarica va girata a lui: con il pulsante lo ricarichi della somma, una volta sola. Si girano i bonifici arrivati dal ${it(r.giri.sotto[0]?.giroDal)}: quelli di prima li hai già girati a mano.`}>
                {r.giri.sotto.map((x: any) => (
                  <div key={x.id} style={{ borderTop: '1px solid #f0f0f0', padding: '10px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 280px', fontSize: '13px' }}>
                        <b>{x.nome}</b>{' '}
                        <span style={{ color: '#6b7280', fontSize: '12px' }}>{x.daGirare.n ? `${x.daGirare.n} ${x.daGirare.n === 1 ? 'ricarica' : 'ricariche'} dei suoi clienti pagate in banca e non ancora girate` : 'niente da girare'}</span>
                        {x.daGirare.n > 0 && <> <button onClick={() => apri('gs' + x.id)} style={{ ...btnLink, padding: 0, fontSize: '12px' }}>{aperti['gs' + x.id] ? 'nascondi' : 'vedi quali'}</button></>}
                      </div>
                      <b style={{ fontSize: '13px' }}>{eur(x.daGirare.totale)}</b>
                      <button style={{ ...btn, opacity: x.daGirare.n ? 1 : 0.4, cursor: x.daGirare.n ? 'pointer' : 'default' }} disabled={!!occupato || !x.daGirare.n} onClick={() => gira(x)}>{`Ricarica ${x.nome}`}</button>
                    </div>
                    {aperti['gs' + x.id] && <Tabella teste={['Bonifico del', 'Bonifico da', 'Cliente', 'Ricaricato il', 'Importo']} destra={[4]} righe={x.daGirare.righe.map((y: any) => [
                      it(y.bonifico.data), <Nome x={y.bonifico} />, y.cliente, it(y.giorno), eur(y.importo)])} />}
                  </div>
                ))}
                {r.giri.giri.length > 0 && (
                  <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: NERO, margin: '4px 0' }}>Giri fatti</div>
                    <Tabella teste={['Il', 'A', 'Bonifici', 'Ricariche', 'Importo', '']} destra={[4]} righe={r.giri.giri.map((g: any) => [
                      it(g.il), g.sotto, g.dal === g.al ? it(g.dal) : `${it(g.dal)} – ${it(g.al)}`, g.n,
                      g.annullato ? <span style={{ color: '#9ca3af', textDecoration: 'line-through' }}>{eur(g.importo)}</span> : eur(g.importo),
                      g.annullato ? <span style={{ fontSize: '11px', color: '#9ca3af' }}>annullato il {it(g.annullato)}</span>
                        : <button style={btnLink} disabled={!!occupato} onClick={() => annullaGiro(g)}>Annulla giro</button>,
                    ])} />
                  </div>
                )}
              </Blocco>
            )}

            <Blocco icona="❓" titolo={`${r.chiEe.length} pagatori: di chi sono questi bonifici?`} totale={r.chiEe.reduce((t: number, g: any) => t + g.totale, 0)} aperto={aperti.chi} onApri={() => apri('chi')}
              frase="Il nome di chi ha pagato non corrisponde a nessun cliente né a nessun nome salvato in «Chi paga i bonifici». Scegli il cliente una volta: il nome e l'IBAN restano salvati su di lui e da qui in poi i suoi bonifici si abbinano da soli. Se con un bonifico solo paga le ricariche di più profili, sceglili tutti.">
              {r.chiEe.map((g: any) => {
                const sel = sceltiDi(g)
                const metti = (l: string[]) => setScelte(s => ({ ...s, [g.chiave]: l }))
                return (
                  <Gruppo key={g.chiave} g={g} aperto={aperti['g' + g.chiave]} onApri={() => apri('g' + g.chiave)}
                    testa={g.senzaRicariche ? <span style={{ color: '#b45309' }}>· stesso nome di {g.omonimi.join(', ')}, che in quei giorni non ha ricariche: è davvero lui?</span>
                      : g.omonimi.length ? <span style={{ color: '#b45309' }}>· stesso nome di più clienti: {g.omonimi.join(', ')}</span> : null}
                    sotto={sel.length > 1 ? <div style={suggerimento}>Un suo bonifico può pagare le ricariche di tutti questi profili, anche insieme: per esempio 1.000 € = 500 dell&apos;uno + 500 dell&apos;altro, ricaricati negli stessi giorni.</div> : null}
                    azioni={<>
                      <div style={{ minWidth: '250px', maxWidth: '340px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {sel.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {sel.map(t => (
                              <span key={t} style={chip}>{nomeTarget(t)}
                                <button type="button" aria-label="Togli" title="Togli" disabled={!!occupato} onClick={() => metti(sel.filter(x => x !== t))} style={chipX}>×</button>
                              </span>
                            ))}
                          </div>
                        )}
                        <SelectCercabile value="" onChange={(e: any) => { const v = e.target.value; if (v && !sel.includes(v) && sel.length < 6) metti([...sel, v]) }} style={campo}>
                          <option value="">{sel.length ? '+ un altro profilo dello stesso cliente' : 'Di quale cliente è?'}</option>
                          {r.anagrafiche.filter((a: any) => !sel.includes(a.target)).map((a: any) => <option key={a.target} value={a.target}>{a.nome}</option>)}
                        </SelectCercabile>
                      </div>
                      <button style={btn} disabled={!!occupato || !sel.length} onClick={() => salvaPagatore(g)}>{sel.length > 1 ? `Salva su ${sel.length} profili` : 'Salva'}</button>
                      <button style={btnSec} disabled={!!occupato} onClick={() => escludi(g)}>Non è un cliente</button>
                    </>} />
                )
              })}
              {!r.chiEe.length && <Vuoto>Tutti i bonifici hanno un cliente.</Vuoto>}
            </Blocco>

            <Blocco icona="❌" titolo={`${r.ricaricheSenzaBonifico.n} ricariche con il bonifico mai arrivato`} totale={r.ricaricheSenzaBonifico.totale} aperto={aperti.senza} onApri={() => apri('senza')}
              frase={`Ricariche fatte fino al ${it(r.ricaricheSenzaBonifico.dopoIl)} per cui in banca non c'è un bonifico.${r.ricaricheRecenti.n ? ` Le ${r.ricaricheRecenti.n} degli ultimi tre giorni (${eur(r.ricaricheRecenti.totale)}) non sono qui: il bonifico può arrivare nel prossimo estratto.` : ''} Se una non era un bonifico, dillo qui e non la si cerca più.`}>
              {r.giri && (() => {
                const conta = (f: (x: any) => boolean) => r.ricaricheSenzaBonifico.righe.filter(f).length
                const scelte = [{ k: '', t: 'Tutte', n: r.ricaricheSenzaBonifico.n }, { k: 'mio', t: 'I tuoi clienti', n: conta((x: any) => !x.delSotto) },
                  ...r.giri.sotto.map((y: any) => ({ k: y.id, t: `Clienti di ${y.nome}`, n: conta((x: any) => x.di === y.id) }))]
                return (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '8px 0 2px' }}>
                    {scelte.map(c => (
                      <button key={c.k} type="button" onClick={() => setFiltroSenza(c.k)}
                        style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                          border: `1px solid ${filtroSenza === c.k ? ARANCIO : '#d1d5db'}`, background: filtroSenza === c.k ? '#fff7ed' : '#fff', color: filtroSenza === c.k ? '#c2410c' : '#374151' }}>
                        {c.t} · {c.n}
                      </button>
                    ))}
                  </div>
                )
              })()}
              <Tabella teste={['Ricaricata il', 'Cliente', 'Importo', 'Bonifico da', 'Non era un bonifico?']} righe={r.ricaricheSenzaBonifico.righe
                .filter((x: any) => !filtroSenza || (filtroSenza === 'mio' ? !x.delSotto : x.di === filtroSenza)).map((x: any) => [
                it(x.giorno),
                <span>{x.cliente}{x.aManoArrivata && <span style={{ display: 'block', fontSize: '11px', color: '#b45309' }}>segnata «arrivata» a mano il {it(x.aManoArrivata)}, ma in banca non c&apos;è: il bonifico ha un altro nome?</span>}</span>,
                eur(x.importo),
                // Le ricariche dei sotto-master le ha fatte il sotto-master: il nome di chi paga si dà dal «di chi è?».
                x.delSotto ? <span style={{ color: '#9ca3af' }}>—</span>
                  : <span>{x.mittente || <span style={{ color: '#9ca3af' }}>—</span>} <button style={btnLink} disabled={!!occupato} onClick={() => scriviMittente(x)}>{x.mittente ? '✎' : '+ scrivi'}</button></span>,
                <select defaultValue="" disabled={!!occupato} onChange={e => { const v = e.target.value; if (v) azione('m' + x.id, { azione: 'metodo', ricarica_id: x.id, metodo: v }) }} style={{ ...campo, width: 'auto', padding: '4px 6px', fontSize: '12px' }}>
                  <option value="">—</option>{x.giroPossibile && <option value="giro">Giro dei bonifici dei suoi clienti</option>}<option value="cod_compensati">Contrassegni compensati</option><option value="contanti">Contanti</option><option value="altro">Altro</option>
                </select>,
              ])} />
            </Blocco>

            <Blocco icona="👥" titolo="Cliente per cliente: ricaricato e pagato" aperto={aperti.cli} onApri={() => apri('cli')}
              frase="Nel periodo: quanto gli avete ricaricato con bonifico e quanto ha pagato in banca (anche i bonifici senza una ricarica che torni)."
              azioni={<label style={{ fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}><input type="checkbox" checked={soloDiff} onChange={e => setSoloDiff(e.target.checked)} /> solo chi ha una differenza</label>}>
              <Tabella teste={['Cliente', 'Ricaricato', 'Pagato', 'Differenza']} destra={[1, 2, 3]} righe={r.perCliente.filter((x: any) => !soloDiff || Math.abs(x.differenza) >= 0.01).map((x: any) => [
                x.nome, `${eur(x.ricaricato)} (${x.ricariche})`, `${eur(x.pagato)} (${x.bonifici})`,
                <b style={{ color: x.differenza < 0 ? ROSSO : x.differenza > 0 ? '#2563eb' : VERDE }}>{x.differenza > 0 ? '+' : ''}{eur(x.differenza)}{x.differenza < 0 ? ' da pagare' : x.differenza > 0 ? ' pagato in più' : ''}</b>,
              ])} />
            </Blocco>

            <Blocco icona="💸" titolo={`Uscite: ${eur(-r.totali.uscite)}`} aperto={aperti.usc} onApri={() => apri('usc')}
              frase="Dove sono andati i soldi, per voce. Ai bonifici verso una controparte puoi dare una voce tua (es. «Fornitore spedizioni»): vale anche per i prossimi.">
              {r.uscite.map((v: any) => (
                <div key={v.voce} style={{ borderTop: '1px solid #f0f0f0', padding: '8px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={() => apri('u' + v.voce)} style={{ ...btnLink, padding: 0, color: NERO, fontWeight: 700, fontSize: '13px' }}>{aperti['u' + v.voce] ? '▾' : '▸'} {v.voce}</button>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>{v.n} {v.n === 1 ? 'movimento' : 'movimenti'}</span>
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

            {(r.altriMetodi.n > 0 || r.esclusi.n > 0) && (
              <Blocco icona="↩" titolo="Fuori dai conti dei clienti" aperto={aperti.fuori} onApri={() => apri('fuori')}
                frase={`Ricariche pagate in altro modo: ${r.altriMetodi.n} per ${eur(r.altriMetodi.totale)}, non si cercano in banca. Bonifici di chi non è un cliente: ${r.esclusi.n} per ${eur(r.esclusi.totale)}. Se ne hai segnato uno per sbaglio, rimettilo da qui.`}>
                {r.esclusi.pagatori.length > 0 && <Tabella teste={['Non è un cliente', 'Bonifici', 'Importo', '']} destra={[2]} righe={r.esclusi.pagatori.map((g: any) => [
                  <span>{g.nome}{g.iban ? <span style={{ display: 'block', fontSize: '11px', color: '#9ca3af' }}>IBAN {g.iban}</span> : null}</span>, g.n, eur(g.totale),
                  <button style={btnLink} disabled={!!occupato} onClick={() => azione('inc' + (g.iban || g.nome), { azione: 'includi', nome: g.nome, iban: g.iban })}>Invece è un cliente</button>,
                ])} />}
                {r.altriMetodi.righe.length > 0 && <Tabella teste={['Ricaricata il', 'Cliente', 'Importo', 'Pagata con']} destra={[2]} righe={r.altriMetodi.righe.map((x: any) => [
                  it(x.giorno), x.cliente, eur(x.importo),
                  <select value={x.metodo} disabled={!!occupato} onChange={e => azione('m' + x.id, { azione: 'metodo', ricarica_id: x.id, metodo: e.target.value })} style={{ ...campo, width: 'auto', padding: '4px 6px', fontSize: '12px' }}>
                    <option value="bonifico">Bonifico</option>{(x.giroPossibile || x.metodo === 'giro') && <option value="giro">Giro dei bonifici dei suoi clienti</option>}<option value="cod_compensati">Contrassegni compensati</option><option value="contanti">Contanti</option><option value="altro">Altro</option>
                  </select>,
                ])} />}
              </Blocco>
            )}

            <div style={{ fontSize: '12px', color: '#6b7280', margin: '4px 2px 20px' }}>
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
        <button onClick={onApri} style={{ ...btnLink, padding: 0, color: NERO, fontSize: '14px', fontWeight: 700, textAlign: 'left' }}>{aperto ? '▾' : '▸'} {icona} {titolo}</button>
        {totale !== undefined && <b style={{ fontSize: '14px', color: NERO }}>{eur(totale)}</b>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>{azioni}</span>
        {frase && <div style={{ flexBasis: '100%', fontSize: '12px', color: '#6b7280' }}>{frase}</div>}
      </div>
      {aperto && <div style={{ padding: '4px 16px 12px' }}>{children}</div>}
    </div>
  )
}

function Gruppo({ g, testa, azioni, sotto, aperto, onApri }: any) {
  return (
    <div style={{ borderTop: '1px solid #f0f0f0', padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontSize: '13px' }}><b>{g.nome || '(senza nome)'}</b> {testa}</div>
          <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>
            {g.n} {g.n === 1 ? 'bonifico' : 'bonifici'} · <b style={{ color: NERO }}>{eur(g.totale)}</b>{g.iban ? ` · IBAN ${g.iban}` : ''}{g.causali.length ? ` · «${g.causali.join('», «')}»` : ''}
            {' '}<button onClick={onApri} style={{ ...btnLink, padding: 0, fontSize: '11.5px' }}>{aperto ? 'nascondi' : 'vedi i bonifici'}</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>{azioni}</div>
      </div>
      {sotto}
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
const chip: any = { display: 'inline-flex', alignItems: 'center', gap: '2px', background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: '999px', padding: '2px 4px 2px 10px', fontSize: '12px', fontWeight: 600, maxWidth: '100%' }
const chipX: any = { background: 'none', border: 'none', color: '#9a3412', cursor: 'pointer', fontSize: '15px', lineHeight: 1, padding: '0 4px' }
const suggerimento: any = { fontSize: '11.5px', color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '6px', padding: '6px 10px', marginTop: '8px' }
const avvisoOk: any = { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }
