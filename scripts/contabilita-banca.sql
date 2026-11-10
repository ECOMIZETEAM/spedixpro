-- CONTABILITA' CON L'ESTRATTO CONTO (Lorenzo, 10/11/2026). In prova solo per Ecomize Solution, poi a tutti.
--
-- Il master ricarica un cliente e scrive chi ha fatto il bonifico; quando carica l'estratto conto il
-- portale abbina ogni bonifico alla sua ricarica. Sul conto di Ecomize, a ottobre, solo 339 bonifici
-- su 830 si riconoscevano dal nome: SALVATORE PELLE paga "ricarica conto Giulia Arioldi", e un altro
-- cliente fa un bonifico solo per tutte le ricariche del giorno. Per questo ogni cliente ha un elenco
-- di pagatori (anche due conti), con l'IBAN quando lo si conosce dall'estratto.
--
-- Passo 1: chi paga e come. Applicato il 10/11/2026 con l'ok di Lorenzo.

-- Come ha pagato la ricarica: in banca si cercano solo i bonifici. I contrassegni compensati
-- (Ecomize LL, "Accredito credito a scalare cod blood") e i contanti non arriveranno mai sul conto e
-- non devono risultare "non pagati". Null = ricarica fatta prima che il campo esistesse.
alter table public.ricariche_check
  add column if not exists metodo text check (metodo in ('bonifico', 'cod_compensati', 'contanti', 'altro')),
  add column if not exists mittente text check (mittente is null or char_length(mittente) <= 140);

create table if not exists public.pagatori_bonifico (
  id uuid primary key default gen_random_uuid(),
  -- chi riceve i soldi: il master che ha ricaricato
  master_id uuid not null references public.masters(id) on delete cascade,
  -- chi viene ricaricato: un cliente (clienti.id) o un sotto-master (masters.id); niente FK perche'
  -- le tabelle sono due, il controllo lo fa la rotta
  target_tipo text not null check (target_tipo in ('cliente', 'master')),
  target_id uuid not null,
  -- il nome come compare sull'estratto conto
  nome text not null check (char_length(btrim(nome)) between 1 and 140),
  iban text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  -- da dove e' arrivato: scritto a mano, dalla finestra di ricarica, abbinando un bonifico dell'estratto
  origine text not null default 'manuale' check (origine in ('manuale', 'ricarica', 'estratto')),
  ultimo_uso timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Lo stesso nome con lo stesso IBAN una volta sola per cliente
create unique index if not exists pagatori_bonifico_unico
  on public.pagatori_bonifico (master_id, target_tipo, target_id, upper(btrim(nome)), coalesce(iban, ''));
create index if not exists pagatori_bonifico_target on public.pagatori_bonifico (master_id, target_tipo, target_id);
create index if not exists pagatori_bonifico_iban on public.pagatori_bonifico (master_id, iban) where iban is not null;

alter table public.pagatori_bonifico enable row level security;
-- revocare "da public" non basta: anon e authenticated hanno i loro grant di default
revoke all on table public.pagatori_bonifico from public;
revoke all on table public.pagatori_bonifico from anon;
revoke all on table public.pagatori_bonifico from authenticated;
grant select, insert, update, delete on table public.pagatori_bonifico to service_role;

-- Passo 2: l'estratto conto e gli abbinamenti (lib/contabilita-estratti).

-- Un estratto caricato: il file della banca, il periodo, i saldi letti e verificati movimento per movimento.
create table if not exists public.estratti_conto (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  banca text not null check (banca in ('finom')),
  conto_iban text,
  intestatario text,
  dal date not null,
  al date not null check (al >= dal),
  saldo_iniziale numeric(14,2) not null,
  saldo_finale numeric(14,2) not null,
  n_righe integer not null,
  nome_file text,
  caricato_da uuid,
  caricato_il timestamptz not null default now()
);
create index if not exists estratti_conto_master on public.estratti_conto (master_id, al desc);

-- I movimenti. Due estratti che si sovrappongono non li contano due volte: la chiave (data, importo,
-- saldo dopo, nome) e' unica per master. Un'entrata puo' avere il cliente che l'ha pagata: messo da solo
-- ('auto', pagatore gia' noto) o dal master ('confermato'); 'escluso' = non e' un cliente.
create table if not exists public.estratti_righe (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  estratto_id uuid not null references public.estratti_conto(id) on delete cascade,
  data date not null,
  nome text not null default '',
  causale text not null default '',
  iban text,
  importo numeric(14,2) not null,
  saldo numeric(14,2) not null,
  chiave text not null,
  target_tipo text check (target_tipo in ('cliente', 'master')),
  target_id uuid,
  assegnato text check (assegnato in ('auto', 'confermato', 'escluso')),
  created_at timestamptz not null default now(),
  check ((target_id is null) = (target_tipo is null))
);
create unique index if not exists estratti_righe_chiave on public.estratti_righe (master_id, chiave);
create index if not exists estratti_righe_data on public.estratti_righe (master_id, data);
create index if not exists estratti_righe_target on public.estratti_righe (master_id, target_tipo, target_id) where target_id is not null;

-- Quale bonifico paga quale ricarica. Una ricarica si abbina una volta sola; un bonifico puo' pagarne
-- piu' d'una (LA MARCA SERVICES: un bonifico per le ricariche del giorno). Si ricorda se l'abbinamento ha
-- segnato lui "effettuato"/"arrivato" nel Check Ricariche, per toglierli se si scollega.
create table if not exists public.abbinamenti_bonifici (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  riga_id uuid not null references public.estratti_righe(id) on delete cascade,
  ricarica_id uuid not null references public.ricariche_check(id) on delete cascade,
  modo text not null check (modo in ('auto', 'confermato')),
  segnato_effettuato boolean not null default false,
  segnato_arrivato boolean not null default false,
  creato_da uuid,
  creato_il timestamptz not null default now()
);
create unique index if not exists abbinamenti_bonifici_ricarica on public.abbinamenti_bonifici (ricarica_id);
create index if not exists abbinamenti_bonifici_riga on public.abbinamenti_bonifici (riga_id);

-- La voce scelta dal master per le uscite verso una controparte (nome come lo normalizza norma()).
create table if not exists public.uscite_voci (
  master_id uuid not null references public.masters(id) on delete cascade,
  controparte text not null,
  voce text not null check (char_length(btrim(voce)) between 1 and 60),
  aggiornato_il timestamptz not null default now(),
  primary key (master_id, controparte)
);

alter table public.estratti_conto enable row level security;
alter table public.estratti_righe enable row level security;
alter table public.abbinamenti_bonifici enable row level security;
alter table public.uscite_voci enable row level security;
revoke all on table public.estratti_conto, public.estratti_righe, public.abbinamenti_bonifici, public.uscite_voci from public;
revoke all on table public.estratti_conto, public.estratti_righe, public.abbinamenti_bonifici, public.uscite_voci from anon;
revoke all on table public.estratti_conto, public.estratti_righe, public.abbinamenti_bonifici, public.uscite_voci from authenticated;
grant select, insert, update, delete on table public.estratti_conto, public.estratti_righe, public.abbinamenti_bonifici, public.uscite_voci to service_role;
