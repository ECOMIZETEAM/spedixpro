-- COSTI DI GESTIONE del master (decisione Lorenzo 22/10/2026).
--
-- Le spese dell'azienda del master che il portale non conosce: personale, autisti, affitto, mezzi,
-- abbonamento alla piattaforma, sito, marketing... Servono a una cosa sola: passare dal Guadagno Totale
-- all'UTILE NETTO. Non muovono soldi: niente movimenti, niente credito, nessun effetto su chi paga cosa.
--
-- Una voce vale "una volta sola" (in un giorno), oppure ogni mese o ogni anno per un periodo
-- (data_fine) o senza scadenza (data_fine null). Il calcolo della quota di un periodo sta in
-- lib/costi-gestione.ts, in un punto solo.
--
-- Le legge e le scrive SOLO il titolare del master o un suo admin, dalle rotte col client di servizio
-- (app/api/costi-gestione): ci sono gli stipendi delle persone, che non devono arrivare a operatori,
-- agenti, clienti, ne' al master sopra. Per questo nessun accesso diretto da anon/authenticated.

create table if not exists public.costi_gestione (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  categoria text not null check (char_length(btrim(categoria)) between 1 and 60),
  descrizione text not null check (char_length(btrim(descrizione)) between 1 and 120),
  importo numeric(12,2) not null check (importo > 0 and importo <= 10000000),
  periodicita text not null check (periodicita in ('una_tantum', 'mensile', 'annuale')),
  data_inizio date not null,
  data_fine date check (data_fine is null or data_fine >= data_inizio),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  -- una spesa fatta una volta sola cade in un giorno solo
  constraint costi_gestione_una_tantum check (periodicita <> 'una_tantum' or data_fine = data_inizio)
);

create index if not exists costi_gestione_master_idx on public.costi_gestione (master_id, data_inizio);

alter table public.costi_gestione enable row level security;
-- revocare "da public" non basta: anon e authenticated hanno i loro grant di default
revoke all on table public.costi_gestione from public;
revoke all on table public.costi_gestione from anon;
revoke all on table public.costi_gestione from authenticated;
grant select, insert, update, delete on table public.costi_gestione to service_role;
