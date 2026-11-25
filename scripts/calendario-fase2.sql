-- IL CALENDARIO, FASE 2 (Lorenzo 25/11/2026): voci che si ripetono, inviti, link per Google e iPhone.
-- Solo aggiunte: colonne nuove con valore di partenza vuoto e due tabelle nuove. Il codice in produzione non le legge
-- finché non esce il rilascio della fase 2, quindi si possono applicare prima senza toccare niente di quello che gira.
-- Regole di sempre: RLS attiva, nessun permesso ad anon e authenticated (revocare «da public» non basta), le tocca solo
-- il server col client di servizio, sempre legando le righe a chi ha la sessione.

-- ── Voci che si ripetono ──
-- ricorrenza: { freq: giorno|settimana|mese|anno, ogni, giorni (0=lun…6=dom), fino 'YYYY-MM-DD' | volte } — la
-- srotola lib/calendario-ricorrenza.ts. eccezioni: i giorni tolti uno a uno. fatti: i giorni in cui un promemoria che
-- si ripete è stato segnato fatto. avvisato_occorrenza: l'inizio dell'ultima occorrenza già avvisata per email.
alter table public.calendario_eventi
  add column if not exists ricorrenza jsonb,
  add column if not exists eccezioni text[] not null default '{}',
  add column if not exists fatti text[] not null default '{}',
  add column if not exists avvisato_occorrenza timestamptz;

-- il giro degli avvisi cerca le serie ancora vive con un avviso
create index if not exists idx_cal_eventi_serie_avviso on public.calendario_eventi (inizio)
  where eliminato_il is null and ricorrenza is not null and avviso_minuti is not null;

-- ── Inviti ──
-- Li crea solo lo staff del master (titolare, admin, operatore); si invitano staff, agenti e clienti dello stesso
-- master. Chi è invitato vede la voce (senza la spedizione collegata e senza gli altri invitati) e risponde.
-- «Togliere» un invitato mette eliminato_il: la riga resta.
create table if not exists public.calendario_inviti (
  id                   uuid primary key default gen_random_uuid(),
  evento_id            uuid not null references public.calendario_eventi(id),
  utente_id            uuid not null,
  invitato_da          uuid not null,
  stato                text not null default 'in_attesa' check (stato in ('in_attesa', 'accettato', 'rifiutato')),
  creato_il            timestamptz not null default now(),
  risposto_il          timestamptz,
  invito_mandato_il    timestamptz,      -- l'email «ti hanno invitato», una volta sola
  avvisato_il          timestamptz,      -- l'avviso prima dell'evento (voce singola)
  avvisato_occorrenza  timestamptz,      -- l'avviso prima dell'evento (serie): inizio dell'ultima occorrenza avvisata
  eliminato_il         timestamptz,
  unique (evento_id, utente_id)
);
create index if not exists idx_cal_inviti_utente on public.calendario_inviti (utente_id) where eliminato_il is null;
create index if not exists idx_cal_inviti_evento on public.calendario_inviti (evento_id) where eliminato_il is null;
create index if not exists idx_cal_inviti_da_mandare on public.calendario_inviti (creato_il) where eliminato_il is null and invito_mandato_il is null;
alter table public.calendario_inviti enable row level security;
revoke all on table public.calendario_inviti from anon, authenticated, public;

-- ── Link per Google e iPhone ──
-- Uno per persona. Del codice si tiene solo l'impronta (sha256): chi legge il database non può ricostruire il link.
-- Rigenerare = nuova impronta (il vecchio link smette di funzionare); disattivare = la riga si toglie.
create table if not exists public.calendario_feed (
  utente_id    uuid primary key,
  token_hash   text not null unique,
  creato_il    timestamptz not null default now(),
  ultimo_uso   timestamptz
);
alter table public.calendario_feed enable row level security;
revoke all on table public.calendario_feed from anon, authenticated, public;

-- Dopo: get_advisors (security) senza errori; l'INFO «RLS attiva senza politiche» è voluta.
