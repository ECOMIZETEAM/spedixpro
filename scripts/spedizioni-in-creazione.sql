-- ORDINI IN CREAZIONE (20/11/2026). Prenotazione di un ordine marketplace mentre la sua spedizione
-- nasce: la scrive la prima richiesta PRIMA di comprare la LDV dal corriere, la seconda richiesta per lo
-- stesso ordine (stesso cliente, rif senza '#', CAP) trova la chiave occupata e si ferma senza comprare.
-- Codice: lib/guardia-doppione.ts → prenotaOrdineInCreazione (portale e API pubblica). Le righe vivono
-- pochi secondi: si cancellano a fine richiesta, e una rimasta orfana scade dopo 150 s.
-- Prima: due richieste nello stesso secondo pagavano entrambe la LDV e l'indice uniq_sped_ordine_attivo_v2
-- scartava la seconda riga DOPO il pagamento (7 ordini dal 22/09, LDV pagate e mai usate).
-- Va applicato PRIMA del codice; il codice comunque lascia passare se la tabella manca.
create table if not exists public.spedizioni_in_creazione (
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  rif_ordine text not null,
  dest_cap text not null,
  creata_il timestamptz not null default now(),
  primary key (cliente_id, rif_ordine, dest_cap)
);
alter table public.spedizioni_in_creazione enable row level security;
-- Solo la piattaforma (client di servizio). Revocare "da public" non basta: anche anon e authenticated.
revoke all on table public.spedizioni_in_creazione from public, anon, authenticated;
grant select, insert, delete on table public.spedizioni_in_creazione to service_role;
