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
