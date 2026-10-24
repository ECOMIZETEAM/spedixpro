-- PERCENTUALE RESI PER CLIENTE (richiesta di Lorenzo, 17/10/2026)
--
-- Per ogni cliente: quante spedizioni sono partite da una certa data, e quanti pacchi sono tornati
-- indietro da quella data. Serve al controllo dei resi (cliente che truffa o che sta per fallire): lo vedono il
-- cliente stesso e i master sopra di lui. I colori e le soglie stanno in lib/resi-percentuale.ts.
--
-- Le regole del conteggio (decise da Lorenzo il 17/10):
-- - reso = stato 'reso_mittente' (il pacco e' tornato), non i 'non consegnato';
-- - il reso conta nel giorno in cui RIENTRA, non in quello in cui il pacco era partito (Lorenzo,
--   24/10/2026): "se quel reso rientra oggi, deve rientrare su oggi e quindi modifica i 30 giorni anche se
--   e' un pacco di 40 giorni fa". Prima contava sul giorno di partenza: a 30 giorni ne mancavano 488 su
--   1.170 (24/10), e la percentuale sembrava ferma;
-- - partite = tutte tranne quelle mai partite o annullate (in lavorazione, annullate, annullamento o
--   storno in corso): un pacco che non e' partito non puo' tornare e non deve abbassare la percentuale;
-- - un pacco condiviso ha piu' gambe con lo stesso tracking: conta UNA volta, sulla gamba di chi l'ha
--   spedito (le gambe dei venditori hanno il numero col suffisso "-xxxxxxxx" e come cliente il conto
--   "(ingrosso)" del compratore, che e' un master e non un cliente: fuori anche per il flag ledger).
--
-- p_master: la rete di quel master (lui e tutti i sotto-master, a qualunque profondita').
-- p_cliente: un solo cliente (portale cliente); con p_cliente valorizzato p_master non conta.
-- Un elemento per (master della spedizione, cliente).
--
-- Solo il server la chiama (chiave di servizio): chi vede cosa lo decide la rotta, come per i report.

-- UN VALORE SOLO, NON UNA RIGA PER CLIENTE: le risposte del database si fermano a 1.000 righe, e la rete di
-- MULTIEXPRESS a 180 giorni ne ha 1.334. Con una riga per cliente quelle in piu' sparivano in silenzio (prima
-- prova, 17/10: a 180 giorni risultavano MENO spedizioni che a 90). Restituita come un solo json il limite
-- non scatta. Elementi: {master_id, cliente_id, partite, resi}. Si chiama _v2 perche' la prima versione
-- (una riga per cliente, public.resi_per_cliente) esiste ancora nel database e nessuno la usa: cancellarla
-- richiede una conferma, chiesta a Lorenzo.
-- LA DATA DEL RIENTRO. La scrive il database nel momento in cui la spedizione passa a 'reso_mittente', da
-- qualunque porta ci passi (tracking, scansione resi, svincolo, correzioni a mano): una regola sola, che
-- nessuna rotta puo' dimenticare. Chi corregge lo storico la puo' passare lui (la data vera del rientro
-- letta dal tracking), e il trigger non la sovrascrive. Per i resi di prima di questa colonna vale la data
-- del primo movimento di reso: l'addebito nasce dalla coda entro mezz'ora dal passaggio a reso (3.070 resi
-- su 3.070 a 180 giorni ce l'hanno, 24/10/2026).
alter table public.spedizioni add column if not exists reso_il timestamptz;
comment on column public.spedizioni.reso_il is 'Quando la spedizione e'' passata a reso_mittente (trg_segna_reso_il). Vuota per i resi di prima del 24/10/2026: per quelli vale il primo movimento di reso.';

create or replace function public.fn_segna_reso_il() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.stato = 'reso_mittente' and NEW.reso_il is null
     and (TG_OP = 'INSERT' or OLD.stato is distinct from 'reso_mittente') then
    NEW.reso_il := now();
  end if;
  return NEW;
end;
$$;
revoke all on function public.fn_segna_reso_il() from public;
revoke all on function public.fn_segna_reso_il() from anon;
revoke all on function public.fn_segna_reso_il() from authenticated;

create or replace trigger trg_segna_reso_il before insert or update of stato on public.spedizioni
  for each row execute function public.fn_segna_reso_il();

-- PARTITE: le spedizioni create nel periodo. RESI: i pacchi rientrati nel periodo, partiti quando che sia.
-- Le due meta' si contano a parte e si uniscono per (master, cliente): un cliente che nel periodo non ha
-- spedito ma ha avuto rientri resta, con 0 partite.
create or replace function public.resi_per_cliente_v2(p_master uuid, p_dal timestamptz, p_cliente uuid default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_cliente is not null then
    with partite as (
      select s.master_id, s.cliente_id, count(*) as n
      from spedizioni s join clienti c on c.id = s.cliente_id
      where s.cliente_id = p_cliente
        and s.created_at >= p_dal
        and s.stato not in ('annullata','annullamento_pending','annullamento_manuale','storno_richiesto','in_lavorazione')
        and not coalesce(c.ledger, false)
        and not (s.tracking_number is not null and s.numero <> s.tracking_number and s.numero like s.tracking_number || '-%')
      group by 1, 2
    ), resi as (
      select s.master_id, s.cliente_id, count(*) as n
      from spedizioni s join clienti c on c.id = s.cliente_id
      where s.cliente_id = p_cliente
        and s.stato = 'reso_mittente'
        and coalesce(s.reso_il, (select min(m.created_at) from movimenti m where m.spedizione_id = s.id and m.tipo = 'reso')) >= p_dal
        and not coalesce(c.ledger, false)
        and not (s.tracking_number is not null and s.numero <> s.tracking_number and s.numero like s.tracking_number || '-%')
      group by 1, 2
    )
    select coalesce(jsonb_agg(jsonb_build_object('master_id', t.master_id, 'cliente_id', t.cliente_id, 'partite', coalesce(t.p, 0), 'resi', coalesce(t.r, 0))), '[]'::jsonb)
      into v
      from (select master_id, cliente_id, partite.n as p, resi.n as r from partite full join resi using (master_id, cliente_id)) t;
    return v;
  end if;

  with recursive rete as (
    select p_master as id
    union
    select m.id from masters m join rete r on m.parent_master_id = r.id
  ), partite as (
    select s.master_id, s.cliente_id, count(*) as n
    from spedizioni s join clienti c on c.id = s.cliente_id
    where s.master_id in (select id from rete)
      and s.created_at >= p_dal
      and s.stato not in ('annullata','annullamento_pending','annullamento_manuale','storno_richiesto','in_lavorazione')
      and not coalesce(c.ledger, false)
      and not (s.tracking_number is not null and s.numero <> s.tracking_number and s.numero like s.tracking_number || '-%')
    group by 1, 2
  ), resi as (
    select s.master_id, s.cliente_id, count(*) as n
    from spedizioni s join clienti c on c.id = s.cliente_id
    where s.master_id in (select id from rete)
      and s.stato = 'reso_mittente'
      and coalesce(s.reso_il, (select min(m.created_at) from movimenti m where m.spedizione_id = s.id and m.tipo = 'reso')) >= p_dal
      and not coalesce(c.ledger, false)
      and not (s.tracking_number is not null and s.numero <> s.tracking_number and s.numero like s.tracking_number || '-%')
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('master_id', t.master_id, 'cliente_id', t.cliente_id, 'partite', coalesce(t.p, 0), 'resi', coalesce(t.r, 0))), '[]'::jsonb)
    into v
    from (select master_id, cliente_id, partite.n as p, resi.n as r from partite full join resi using (master_id, cliente_id)) t;
  return v;
end;
$$;

revoke all on function public.resi_per_cliente_v2(uuid, timestamptz, uuid) from public;
revoke all on function public.resi_per_cliente_v2(uuid, timestamptz, uuid) from anon;
revoke all on function public.resi_per_cliente_v2(uuid, timestamptz, uuid) from authenticated;
grant execute on function public.resi_per_cliente_v2(uuid, timestamptz, uuid) to service_role;
