-- IL CALENDARIO, FASE 3 (Lorenzo 26/11/2026): notifiche sul telefono e sul computer, riepilogo del mattino.
-- Solo tabelle nuove. Regole di sempre: RLS attiva, nessun permesso ad anon e authenticated (revocare «da public» non
-- basta), le tocca solo il server col client di servizio, legando le righe a chi ha la sessione.

-- I dispositivi che ricevono le notifiche di una persona: il browser (Web Push: endpoint + chiavi del browser) o l'app
-- (iPhone: token APNs; Android: token Firebase). Un indirizzo che il servizio dichiara morto si spegne (disattivato_il):
-- la riga resta, ma non si manda più niente lì.
create table if not exists public.notifiche_dispositivi (
  id              uuid primary key default gen_random_uuid(),
  utente_id       uuid not null,
  tipo            text not null check (tipo in ('web', 'ios', 'android')),
  indirizzo       text not null,           -- web: endpoint del servizio push; app: token del dispositivo
  p256dh          text,                    -- solo web: chiave pubblica del browser
  auth            text,                    -- solo web: segreto del browser
  etichetta       text,                    -- «Chrome su Mac», «iPhone»: per riconoscerlo nell'elenco
  creato_il       timestamptz not null default now(),
  ultimo_uso      timestamptz,
  disattivato_il  timestamptz,
  motivo_spento   text,
  unique (indirizzo)
);
create index if not exists idx_notifiche_dispositivi_utente on public.notifiche_dispositivi (utente_id) where disattivato_il is null;
alter table public.notifiche_dispositivi enable row level security;
revoke all on table public.notifiche_dispositivi from anon, authenticated, public;

-- Le scelte di una persona sul calendario: il riepilogo del mattino è SPENTO finché non lo accende lei (Lorenzo 26/11:
-- «chi lo attiva»). riepilogo_inviato_il: il giorno dell'ultimo riepilogo mandato, uno al giorno.
create table if not exists public.calendario_preferenze (
  utente_id             uuid primary key,
  riepilogo_mattino     boolean not null default false,
  riepilogo_inviato_il  date,
  aggiornato_il         timestamptz not null default now()
);
create index if not exists idx_cal_preferenze_riepilogo on public.calendario_preferenze (utente_id) where riepilogo_mattino;
alter table public.calendario_preferenze enable row level security;
revoke all on table public.calendario_preferenze from anon, authenticated, public;

-- Dopo: get_advisors (security) senza errori; l'INFO «RLS attiva senza politiche» è voluta.
