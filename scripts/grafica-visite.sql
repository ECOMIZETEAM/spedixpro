-- Chi apre la prova della grafica nuova (Lorenzo 21/11/2026: «controllate chi la visualizza e chi vota»).
-- Una riga per persona: quando l'ha aperta la prima e l'ultima volta, quante pagine ha aperto nella prova, da quale
-- dispositivo (computer, telefono, app degli store). La scrive il layout del portale col client di servizio
-- (lib/grafica-visite.ts), dopo la risposta; la legge solo /api/grafica/voti, per il super master.
-- Niente chiave esterna verso auth.users: il registro resta anche se l'utente viene tolto (lo storico non si cancella).

create table if not exists public.grafica_visite (
  utente_id     uuid primary key,
  master_id     uuid,
  cliente_id    uuid,
  ruolo         text,
  dispositivo   text,
  prima_vista   timestamptz not null default now(),
  ultima_vista  timestamptz not null default now(),
  pagine_aperte integer not null default 1
);

alter table public.grafica_visite enable row level security;
-- nessuna politica: chi entra col portale non legge né scrive; solo il client di servizio
revoke all on table public.grafica_visite from anon, authenticated, public;

-- una pagina aperta nella prova: la prima volta crea la riga, poi conta e aggiorna l'ultima vista
create or replace function public.segna_visita_grafica(p_utente uuid, p_master uuid, p_cliente uuid, p_ruolo text, p_dispositivo text)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.grafica_visite (utente_id, master_id, cliente_id, ruolo, dispositivo)
  values (p_utente, p_master, p_cliente, p_ruolo, p_dispositivo)
  on conflict (utente_id) do update set
    ultima_vista  = now(),
    pagine_aperte = public.grafica_visite.pagine_aperte + 1,
    master_id     = excluded.master_id,
    cliente_id    = excluded.cliente_id,
    ruolo         = excluded.ruolo,
    dispositivo   = excluded.dispositivo;
$$;

revoke all on function public.segna_visita_grafica(uuid, uuid, uuid, text, text) from anon, authenticated, public;
grant execute on function public.segna_visita_grafica(uuid, uuid, uuid, text, text) to service_role;
