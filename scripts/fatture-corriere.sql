-- CONTROLLO FATTURA CORRIERE: lo storico delle fatture caricate dal detentore, mese per mese.
--
-- Ogni fattura del corriere (oggi il dettaglio TIVAF di BRT) controllata nella pagina Spedizioni →
-- Controllo Fattura Corriere resta qui: testata coi totali e, a parte, le righe col loro esito, così la si
-- riapre senza ricaricare il file. Il costo in Moove NON viene corretto da qui (decisione di Lorenzo del
-- 28/10/2026): la fattura resta come memoria di quanto BRT è costato davvero, mese per mese.
--
-- Accesso solo dalle rotte con la chiave di servizio, che controllano a mano che chi chiede sia il
-- detentore del contratto: RLS attiva senza policy e nessun permesso ad anon e authenticated.
--
-- Lo storico non si cancella: se si elimina il contratto, la fattura resta col nome del contratto di allora.

create table if not exists public.fatture_corriere (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id),
  corriere_id uuid references public.corrieri(id) on delete set null,
  nome_contratto text not null,
  numero_fattura text not null,
  data_fattura date,
  nome_file text,
  -- 'in_corso' finché il controllo a pacchetti non è finito: una fattura interrotta si riprende da capo.
  stato text not null default 'in_corso' check (stato in ('in_corso', 'completa')),
  righe integer not null default 0,
  andate integer not null default 0,
  rientri integer not null default 0,
  totale_corriere numeric(12,2) not null default 0,     -- quanto ha fatturato il corriere (tutte le righe)
  totale_trovate numeric(12,2) not null default 0,      -- di cui sulle spedizioni trovate in Moove
  costo_moove numeric(12,2) not null default 0,         -- costo registrato al detentore su quelle spedizioni
  differenza numeric(12,2) not null default 0,          -- totale_trovate − costo_moove
  non_trovate integer not null default 0,
  totale_non_trovate numeric(12,2) not null default 0,
  da_girare integer not null default 0,                 -- spedizioni con peso del corriere più alto
  euro_da_girare numeric(12,2) not null default 0,
  riepilogo jsonb not null default '{}'::jsonb,         -- somme per motivo e per voce
  rettifiche_file_id uuid references public.rettifiche_files(id) on delete set null,
  caricata_da uuid,
  created_at timestamptz not null default now(),
  completata_at timestamptz,
  unique (master_id, corriere_id, numero_fattura)
);

create table if not exists public.fatture_corriere_righe (
  id bigint generated always as identity primary key,
  fattura_id uuid not null references public.fatture_corriere(id) on delete cascade,
  spedizione_id uuid,
  esito jsonb not null
);
create index if not exists idx_fatture_corriere_righe_fattura on public.fatture_corriere_righe (fattura_id);
create index if not exists idx_fatture_corriere_master on public.fatture_corriere (master_id, data_fattura desc);

alter table public.fatture_corriere enable row level security;
alter table public.fatture_corriere_righe enable row level security;
revoke all on public.fatture_corriere from anon, authenticated;
revoke all on public.fatture_corriere_righe from anon, authenticated;
