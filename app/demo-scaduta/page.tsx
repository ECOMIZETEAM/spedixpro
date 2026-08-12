// Pagina pubblica dove finisce un account demo quando la prova è terminata. Nessun dato, solo un
// messaggio pulito + invito a passare a un account reale. Il middleware la lascia passare (non è
// un'area protetta), il layout dashboard ci rimanda l'utente demo scaduto.
export const dynamic = 'force-dynamic'

export default function DemoScaduta() {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '460px', width: '100%', background: '#fff', borderRadius: '16px', padding: '40px 34px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ width: '64px', height: '64px', margin: '0 auto 18px', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px' }}>⏳</div>
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111827', margin: '0 0 10px' }}>La prova è terminata</h1>
        <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: 1.6, margin: '0 0 24px' }}>
          Il tuo accesso demo a MoovExpress è scaduto. Speriamo ti sia piaciuto! Per continuare con un
          account reale — spedizioni vere, i tuoi contratti, i tuoi clienti — scrivici e lo attiviamo.
        </p>
        <a href="https://moovexpress.com" style={{ display: 'inline-block', background: '#f97316', color: '#fff', padding: '13px 30px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}>
          Scopri MoovExpress →
        </a>
        <div style={{ marginTop: '18px', fontSize: '12.5px', color: '#9ca3af' }}>
          <a href="mailto:info@moovexpress.com" style={{ color: '#f97316', textDecoration: 'none', fontWeight: 600 }}>info@moovexpress.com</a>
        </div>
      </div>
    </div>
  )
}
