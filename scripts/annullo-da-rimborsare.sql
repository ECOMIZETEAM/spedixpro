-- UNA SPEDIZIONE ANNULLATA VA RIMBORSATA, DA QUALUNQUE STRADA (Lorenzo, 4/11/2026)
--
-- 'annullata' la scrivono molte strade: il cestino, il giro delle 48 ore, la conferma del detentore,
-- lo storno DVA, l'annullo SDA EXPRESS L, il giro del tracking. Tutte rimborsano subito dopo. Due no:
-- il dettaglio del tracking del portale e l'API /v1/tracking, che scrivono 'annullata' quando il
-- fornitore la da' annullata e basta. Caso vero: 050228152996379 (A&D SAS, cliente di Ecomize Solution),
-- annullata dal fornitore il 4/11 alle 9:25, scritta 'annullata' alle 11:26 dal dettaglio aperto dal
-- cliente, nessun rimborso. Da giugno erano 5, 143,85 EUR alla catena (51,17 ai clienti), rimborsate il
-- 4/11 con rimborsaAnnulloSpedizione. Mettere il rimborso in quelle due porte avrebbe lasciato scoperta
-- la prossima: qui sta nel database.
--
-- Il database registra il FATTO (questa spedizione e' passata ad 'annullata'), il giro addebiti-code
-- rimborsa con la funzione delle altre porte, mezz'ora dopo e SOLO se la spedizione non ha nessun
-- rimborso (la porta che l'ha annullata ha gia' fatto il suo lavoro). Il trigger non guarda i movimenti
-- apposta: le porte scrivono lo stato PRIMA del rimborso, quindi qui non sarebbe ancora visibile.
-- Il trigger fa solo un insert, e solo sul passaggio: se fallisse, fallirebbe l'annullo stesso.
--
-- `avviato_il`: il giro lo scrive subito prima di rimborsare. Distingue i rimborsi di un suo tentativo
-- rimasto a meta' (da completare) da quelli della porta (da non toccare).

create table if not exists public.annulli_da_rimborsare (
  spedizione_id uuid primary key references public.spedizioni(id) on delete cascade,
  creato_il timestamptz not null default now(),
  avviato_il timestamptz,
  tentativi integer not null default 0,
  ultimo_errore text
);

alter table public.annulli_da_rimborsare enable row level security;
revoke all on table public.annulli_da_rimborsare from public;
revoke all on table public.annulli_da_rimborsare from anon;
revoke all on table public.annulli_da_rimborsare from authenticated;

create or replace function public.fn_annullo_da_rimborsare()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  insert into public.annulli_da_rimborsare (spedizione_id)
  values (new.id)
  on conflict (spedizione_id) do nothing;
  return new;
end;
$f$;

revoke all on function public.fn_annullo_da_rimborsare() from public;
revoke all on function public.fn_annullo_da_rimborsare() from anon;
revoke all on function public.fn_annullo_da_rimborsare() from authenticated;

-- La condizione sta nel WHEN: la funzione non viene nemmeno chiamata per gli altri cambi di stato.
drop trigger if exists trg_annullo_da_rimborsare on public.spedizioni;
create trigger trg_annullo_da_rimborsare
  after update of stato on public.spedizioni
  for each row
  when (new.stato = 'annullata' and old.stato is distinct from 'annullata')
  execute function public.fn_annullo_da_rimborsare();
