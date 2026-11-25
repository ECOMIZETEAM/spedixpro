-- IL CALENDARIO: le voci scritte da chi usa il portale (promemoria, eventi, riunioni). Lorenzo 25/11/2026.
-- APPLICATO in produzione il 25/11/2026 con l'ok di Lorenzo (advisors: nessun errore; solo l'INFO «RLS senza
-- politiche», voluto).
--
-- Chi legge e scrive: solo /api/calendario/eventi e il giro /api/cron/calendario-avvisi, col client di servizio, e sempre con utente_id = chi ha la sessione.
-- Per questo RLS attiva, nessuna politica e nessun permesso ad anon e authenticated (revocare «da public» non basta).
-- Le voci automatiche (ritiri, giacenze) NON stanno qui: si leggono dalle loro tabelle, così non esistono due copie.
-- Niente chiave esterna verso auth.users: lo storico non si cancella, anche se l'utente viene tolto.
-- «Elimina» mette eliminato_il: la riga resta.

create table if not exists public.calendario_eventi (
  id              uuid primary key default gen_random_uuid(),
  utente_id       uuid not null,
  master_id       uuid,
  cliente_id      uuid,
  tipo            text not null check (tipo in ('promemoria', 'evento', 'riunione')),
  titolo          text not null check (length(titolo) between 1 and 200),
  inizio          timestamptz not null,
  fine            timestamptz,
  tutto_il_giorno boolean not null default false,
  luogo           text,
  note            text,
  -- quanto prima avvisare (minuti); null = nessun avviso. avvisato_il lo scrive il giro degli avvisi: un avviso solo.
  avviso_minuti   integer check (avviso_minuti is null or avviso_minuti between 0 and 10080),
  avvisato_il     timestamptz,
  -- a cosa è attaccata la voce: per ora { tipo: 'spedizione', id, etichetta }
  collegamento    jsonb,
  fatto           boolean not null default false,
  creato_il       timestamptz not null default now(),
  aggiornato_il   timestamptz,
  eliminato_il    timestamptz,
  check (fine is null or fine >= inizio)
);

-- le letture: le voci di una persona in un periodo, e i promemoria ancora da fare
create index if not exists idx_cal_eventi_utente_inizio on public.calendario_eventi (utente_id, inizio) where eliminato_il is null;
-- il giro degli avvisi: le voci con un avviso non ancora mandato
create index if not exists idx_cal_eventi_da_avvisare on public.calendario_eventi (inizio) where eliminato_il is null and avviso_minuti is not null and avvisato_il is null;

alter table public.calendario_eventi enable row level security;
revoke all on table public.calendario_eventi from anon, authenticated, public;

-- Dopo: get_advisors (security) deve dare zero errori; l'INFO «RLS attiva senza politiche» è voluta.
