-- FATTURE PROFORMA (Lorenzo, 13/11/2026).
--
-- Il master sceglie un cliente e un periodo, e il portale prepara una proforma con tutto quello che il
-- cliente gli deve per quei giorni (lib/fatture/proforma.ts). Non e' una fattura: niente SDI, niente
-- numero fiscale. Si salva con un numero suo, per master e per anno ("12/2026"), si riscarica e si
-- manda per email al cliente.
--
-- Tabella chiusa a tutti tranne il servizio (RLS senza policy + revoke): dentro ci sono gli importi di
-- vendita del master ai suoi clienti. Le rotte decidono il master da chi e' loggato, mai dal browser.
-- Il numero lo da' fatture_prossimo_numero (scripts/fatture-gestionale.sql, gia' in produzione), con
-- la chiave 'proforma:<anno>': una serie separata da quella delle fatture.

create table if not exists public.fatture_proforma (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id),
  -- Come spedizioni, distinte e fatture: un cliente con proforme non si cancella, lo storico resta.
  cliente_id uuid not null references public.clienti(id),
  anno integer not null,
  numero integer not null check (numero > 0),
  dal date not null,
  al date not null check (al >= dal),
  -- Com'erano il master e il cliente il giorno della proforma: se poi cambiano indirizzo, la proforma
  -- gia' mandata resta quella.
  emittente jsonb not null,
  intestazione jsonb not null,
  righe jsonb not null,
  imponibile numeric(12,2) not null,
  aliquota numeric(5,2) not null,
  natura_iva text,
  iva numeric(12,2) not null,
  totale numeric(12,2) not null,
  -- Ricariche e contrassegni del periodo: nel PDF per informazione, fuori dal totale.
  accrediti jsonb not null default '{}'::jsonb,
  movimenti integer not null,
  file_path text not null,
  creata_da uuid,
  created_at timestamptz not null default now(),
  inviata_a text,
  inviata_il timestamptz,
  constraint uniq_proforma_numero unique (master_id, anno, numero)
);

create index if not exists idx_proforma_master on public.fatture_proforma (master_id, created_at desc);

alter table public.fatture_proforma enable row level security;
revoke all on table public.fatture_proforma from public, anon, authenticated;
grant all on table public.fatture_proforma to service_role;
