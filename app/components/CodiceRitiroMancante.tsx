// AL POSTO DEL CODICE DI RITIRO CHE MANCA, nell'elenco Ritiri (portale master e cliente).
// Il trattino non distingueva un codice in arrivo da un ritiro mai confermato dal corriere, e chi
// aveva il pacco pronto non sapeva se aspettare o muoversi. Quale delle due lo decide il server
// (statoCodiceRitiro in lib/ritiro-codice), qui c'e' solo come si scrive.
//   {r.cod_ritiro || <CodiceRitiroMancante stato={r.codice_stato} />}
export default function CodiceRitiroMancante({ stato }: { stato?: 'in_attesa' | 'non_confermato' | null }) {
  if (stato === 'in_attesa') {
    return <span title="Il ritiro è stato richiesto: il codice compare appena il corriere lo assegna." style={{ color: '#6b7280', fontWeight: 500, fontStyle: 'italic' }}>In attesa del codice</span>
  }
  if (stato === 'non_confermato') {
    return <span title="Il corriere non ha confermato questo ritiro." style={{ color: '#b45309', fontWeight: 600 }}>Non confermato dal corriere</span>
  }
  return <>—</>
}
