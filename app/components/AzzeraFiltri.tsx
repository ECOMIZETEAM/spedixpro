'use client'

// Bottone "Azzera filtri" universale per le liste che usano useFiltriPersistenti.
// Cancella dal localStorage TUTTE le chiavi 'flt:<prefix>:*' di QUESTA pagina e ricarica: gli stati
// ripartono dai default (localStorage pulito). Usarlo dove non c'è già un Azzera cablato a mano.
//   <AzzeraFiltri prefix="giacenze-master" />
// Il `prefix` deve combaciare con quello passato a useFiltriPersistenti nella pagina.
export default function AzzeraFiltri({ prefix, label = 'Azzera filtri', style }: { prefix: string; label?: string; style?: React.CSSProperties }) {
  const azzera = () => {
    try {
      const rm: string[] = []
      const p = 'flt:' + prefix + ':'
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(p)) rm.push(k) }
      rm.forEach(k => localStorage.removeItem(k))
    } catch { /* localStorage non disponibile */ }
    // Ricarico: senza i setter dei singoli filtri della pagina, il modo pulito e universale di
    // riportare tutto ai default è rileggere con il localStorage svuotato.
    try { window.location.reload() } catch {}
  }
  const base: React.CSSProperties = {
    padding: '8px 14px', background: '#fff7ed', color: '#ea580c', border: '1px solid #fed7aa',
    borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  }
  return <button type="button" onClick={azzera} style={{ ...base, ...(style || {}) }}>{label}</button>
}
