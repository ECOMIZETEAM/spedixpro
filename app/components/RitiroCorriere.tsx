import { linkRitiroCorriere, statoRitiroVisto } from '@/lib/ritiro-vista'

// SOTTO IL CODICE DI RITIRO, il link alla pagina del corriere che mostra la prenotazione e i suoi eventi
// (oggi solo BRT: perche' Poste no, e come si riconosce il codice, in lib/ritiro-vista). Va FUORI da altri
// link: nella lista Ritiri il codice e' gia' dentro un <a>.
//   {r.cod_ritiro}<LinkRitiroCorriere codice={r.cod_ritiro} contratto={r.corrieri?.nome_contratto} />
export function LinkRitiroCorriere({ codice, contratto }: { codice?: string | null; contratto?: string | null }) {
  const href = linkRitiroCorriere(codice, contratto)
  if (!href) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title="Apre la pagina di BRT con la prenotazione del ritiro e i suoi eventi"
      style={{ display: 'block', marginTop: '2px', fontSize: '11px', fontWeight: 600, color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap' }}>
      Vedi su BRT ↗
    </a>
  )
}

// LO STATO DEL RITIRO come pastiglia colorata. Le parole stanno in lib/ritiro-vista.
export function StatoRitiro({ stato }: { stato?: string | null }) {
  const st = statoRitiroVisto(stato)
  return <span title={st.nota} style={{ background: st.bg, color: st.color, padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', cursor: st.nota ? 'help' : undefined }}>{st.label}</span>
}
