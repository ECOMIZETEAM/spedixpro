import { linkRitiroCorriere, statoRitiroVisto } from '@/lib/ritiro-vista'

// SOTTO IL CODICE DI RITIRO, il link alla pagina del corriere che mostra la prenotazione: BRT la apre gia' sul
// codice, Poste no (si apre con la casella vuota), quindi su Poste il clic copia anche il codice da incollare. Le regole
// stanno in lib/ritiro-vista. Va FUORI da altri link: nella lista Ritiri il codice e' gia' dentro un <a>.
//   {r.cod_ritiro}<LinkRitiroCorriere codice={r.cod_ritiro} contratto={r.corrieri?.nome_contratto} />
export function LinkRitiroCorriere({ codice, contratto }: { codice?: string | null; contratto?: string | null }) {
  const link = linkRitiroCorriere(codice, contratto)
  if (!link) return null
  const titolo = link.copiaCodice
    ? `Apre la pagina dei ritiri di Poste. Il codice ${codice} viene copiato: scegli «Cerca Ritiri» e incollalo.`
    : `Apre la pagina di ${link.corriere} con la prenotazione del ritiro e i suoi eventi`
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" title={titolo}
      onClick={() => { if (link.copiaCodice) { try { navigator.clipboard?.writeText(String(codice || '')).catch(() => {}) } catch { /* senza copia il link si apre lo stesso */ } } }}
      style={{ display: 'block', marginTop: '2px', fontSize: '11px', fontWeight: 600, color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap' }}>
      Vedi su {link.corriere} ↗
    </a>
  )
}

// LO STATO DEL RITIRO come pastiglia colorata. Le parole stanno in lib/ritiro-vista.
export function StatoRitiro({ stato }: { stato?: string | null }) {
  const st = statoRitiroVisto(stato)
  return <span title={st.nota} style={{ background: st.bg, color: st.color, padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', cursor: st.nota ? 'help' : undefined }}>{st.label}</span>
}
