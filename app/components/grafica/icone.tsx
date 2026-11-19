// Le icone a linea della grafica nuova (Lorenzo 27/10: «professionale e non emoji colorate»): tratto 1,6, estremi tondi,
// griglia 24, nel colore del testo. Un solo foglio di simboli per pagina, ogni icona lo richiama con <use>.

const SIMBOLI: Record<string, string> = {
  'i-plancia': '<rect x="3.5" y="3.5" width="7" height="8" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="14.5" width="7" height="6" rx="2"/>',
  'i-pacco': '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  'i-euro': '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/>',
  'i-camion': '<path d="M3 6h11v10H3zM14 9.5h4l3 3.5v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  'i-distinta': '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/>',
  'i-resi': '<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H12"/>',
  'i-rete': '<circle cx="12" cy="5.5" r="2.3"/><circle cx="5.5" cy="18" r="2.3"/><circle cx="18.5" cy="18" r="2.3"/><path d="m11 7.5-4.4 8.4M13 7.5l4.4 8.4M7.8 18h8.4"/>',
  'i-aiuto': '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  'i-percorso': '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  'i-listino': '<path d="M4 12.5V5a1 1 0 0 1 1-1h7.5L20 11.5 12.5 19z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  'i-calc': '<rect x="5" y="3" width="14" height="18" rx="2.2"/><path d="M8.5 7.2h7M8.5 11.2h.01M12 11.2h.01M15.5 11.2h.01M8.5 15h.01M12 15h.01M15.5 15h.01"/>',
  'i-clienti': '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.5 14.3a4.5 4.5 0 0 1 5 4.7"/>',
  'i-magazzino': '<path d="M3 9.5 12 4l9 5.5V20H3z"/><path d="M7.5 20v-6.5h9V20"/>',
  'i-autista': '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 14v6.5M10.2 12.6 4 15M13.8 12.6 20 15"/>',
  'i-scatole': '<path d="M3.5 13.5h7.5v7H3.5zM13 13.5h7.5v7H13zM8.25 4h7.5v7.5h-7.5z"/>',
  'i-fattura': '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8.5h6M9 12h6"/>',
  'i-movimenti': '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
  'i-costi': '<rect x="3.5" y="6.5" width="17" height="12" rx="2.5"/><path d="M3.5 10.5h17M8 14.5h3"/><path d="M7 6.5V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 17 5v1.5"/>',
  'i-stella': '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  'i-report': '<path d="M4 20h16M7 16v-4M12 16V8M17 16v-7"/>',
  'i-torta': '<path d="M11 4.1A8.4 8.4 0 1 0 19.9 13H11z"/><path d="M14 3.2a7.6 7.6 0 0 1 6.8 6.8H14z"/>',
  'i-scudo': '<path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  'i-radar': '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/>',
  'i-pannello': '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M8 9.5v5M12 8v8M16 11v3"/>',
  'i-chiave': '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5M13.5 9.5l2 2"/>',
  'i-play': '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>',
  'i-regola': '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  'i-campana': '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  'i-libro': '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20"/>',
  'i-chevron': '<path d="m9 6 6 6-6 6"/>',
  'i-calendario': '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  'i-lucchetto': '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  'i-sole': '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  'i-luna': '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  'i-auto': '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  'i-esci': '<path d="M14 4.5h3.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="M10 8 6 12l4 4M6 12h9"/>',
  'i-menu': '<path d="M4 7h16M4 12h16M4 17h16"/>',
  'i-carta': '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 14.5h4"/>',
  'i-messaggio': '<path d="M4 5.5h16v10H9l-5 4z"/>',
  'i-salvagente': '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="m6 6 3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5"/>',
  // le azioni dell'Elenco spedizioni (18/11)
  'i-stampa': '<path d="M7 8.5V3.5h10v5"/><rect x="3.5" y="8.5" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  'i-occhio': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  'i-matita': '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
  'i-cestino': '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2"/><path d="M6.5 6.5l1 13.5h9l1-13.5"/><path d="M10 10.5v6M14 10.5v6"/>',
  'i-scarica': '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  'i-filtro': '<path d="M4 6h16M7 12h10M10 18h4"/>',
  'i-attesa': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  // la Live View: un punto che trasmette (18/11)
  'i-diretta': '<circle cx="12" cy="12" r="2.2"/><path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13"/>',
  'i-altro': '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  'i-cuffie': '<path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>',
  'i-moovy': '<rect x="4.5" y="7" width="15" height="11.5" rx="4"/><path d="M12 7V4.5"/><circle cx="12" cy="3.6" r="1"/><path d="M9.5 12.5h.01M14.5 12.5h.01M10 15.5h4"/>',
}

export function FoglioIcone() {
  const html = Object.entries(SIMBOLI).map(([id, d]) => `<symbol id="${id}" viewBox="0 0 24 24">${d}</symbol>`).join('')
  return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
}

export function Icona({ id, className }: { id: string; className?: string }) {
  return <svg className={'gx-ico' + (className ? ' ' + className : '')} aria-hidden="true"><use href={'#' + id} /></svg>
}

// L'icona di ogni voce del menu, per nome (il menu di oggi ha glifi e emoji nel campo icon: quelli restano alla
// grafica vecchia). Una voce nuova senza icona qui prende il pacco, così non resta mai un buco.
export const ICONA_VOCE: Record<string, string> = {
  'Plancia': 'i-plancia', 'Live View': 'i-diretta', 'Spedizioni': 'i-pacco', 'Contrassegni': 'i-euro', 'Ritiri': 'i-camion', 'Distinte': 'i-distinta',
  'Resi': 'i-resi', 'Dal mio network': 'i-rete', 'Assistenza Clienti': 'i-aiuto', 'Circuito interno': 'i-percorso',
  'Il mio listino': 'i-listino', 'Listini Prezzi': 'i-listino', 'Preventivi': 'i-calc', 'Clienti': 'i-clienti',
  'Logistica': 'i-magazzino', 'Autisti e Consegne': 'i-autista', 'Consumabili': 'i-scatole', 'Fatture': 'i-fattura',
  'Lista Movimenti': 'i-movimenti', 'Costi di gestione': 'i-costi', 'Abbonamento': 'i-stella', 'Reports': 'i-report',
  'Statistiche': 'i-torta', 'Registro Attività': 'i-scudo', 'Controllo Giacenze': 'i-radar', 'Centrale di Controllo': 'i-pannello',
  'Abbonamenti API': 'i-chiave', 'Account Demo': 'i-play', 'Impostazioni': 'i-regola', 'Centro Notifiche': 'i-campana',
  'Documentazione': 'i-libro',
  // il portale cliente (19/11)
  'Importa Ordini': 'i-scarica', 'Rubrica destinatari': 'i-clienti', 'SMS': 'i-messaggio', 'Assistenza': 'i-aiuto',
  'Mio Account': 'i-carta', 'Introduzione': 'i-play',
}
