// Neutralizza l'HTML dentro un valore che verra' mostrato in un messaggio renderizzato come HTML.
// Le notifiche si disegnano con `dangerouslySetInnerHTML` (app/components/CampanellaNotifiche.tsx,
// app/dashboard/notifiche/invia/page.tsx, app/cliente/dashboard/page.tsx): e' voluto, lo staff
// compone testo ricco. Ma il testo che arriva da FUORI — la ragione sociale di una registrazione
// rivenditore pubblica (una porta che si apre con un semplice curl), il nome del destinatario di un
// preventivo — non e' testo ricco: va spento, altrimenti `<img src=x onerror=...>` diventa uno
// script che gira nella sessione di chi apre la campanella, fino all'admin di MULTIEXPRESS.
// Guasto reale del 26/10/2026: la registrazione rivenditore pubblica scriveva la ragione sociale
// grezza nella notifica all'amministratore della rete. Regola: input esterno -> escape alla fonte.
export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
