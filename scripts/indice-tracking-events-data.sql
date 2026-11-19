-- Indice sulla data degli eventi di tracking. Serve alla Sentinella del mattino ("eventi di tracking
-- nelle ultime 24h"): senza, il conteggio legge tutti i 3,8 milioni di righe (1,9 s a meta' giornata,
-- molto di piu' alle 7, quando il tracking ci sta scrivendo) e il 10 e 11/11/2026 la Sentinella e'
-- saltata per tempo scaduto.
-- CONCURRENTLY: si costruisce senza fermare le scritture del tracking. Va lanciato DA SOLO
-- (non insieme ad altri comandi), altrimenti l'editor lo rifiuta.
create index concurrently if not exists idx_tracking_events_created_at on public.tracking_events (created_at);
