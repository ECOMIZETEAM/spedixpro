-- PERCENTUALE RESI PER CLIENTE (richiesta di Lorenzo, 17/10/2026)
--
-- Per ogni cliente: quante spedizioni sono partite e quante sono tornate indietro, fra quelle create da
-- una certa data. Serve al controllo dei resi (cliente che truffa o che sta per fallire): lo vedono il
-- cliente stesso e i master sopra di lui. I colori e le soglie stanno in lib/resi-percentuale.ts.
--
-- Le regole del conteggio (decise da Lorenzo il 17/10):
-- - reso = stato 'reso_mittente' (il pacco e' tornato), non i 'non consegnato';
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
    select coalesce(jsonb_agg(jsonb_build_object('master_id', t.master_id, 'cliente_id', t.cliente_id, 'partite', t.partite, 'resi', t.resi)), '[]'::jsonb)
      into v
      from (
        select s.master_id, s.cliente_id,
          count(*) filter (where s.stato not in ('annullata','annullamento_pending','annullamento_manuale','storno_richiesto','in_lavorazione')) as partite,
          count(*) filter (where s.stato = 'reso_mittente') as resi
        from spedizioni s join clienti c on c.id = s.cliente_id
        where s.cliente_id = p_cliente
          and s.created_at >= p_dal
          and not coalesce(c.ledger, false)
          and not (s.tracking_number is not null and s.numero <> s.tracking_number and s.numero like s.tracking_number || '-%')
        group by s.master_id, s.cliente_id
      ) t;
    return v;
  end if;

  with recursive rete as (
    select p_master as id
    union
    select m.id from masters m join rete r on m.parent_master_id = r.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('master_id', t.master_id, 'cliente_id', t.cliente_id, 'partite', t.partite, 'resi', t.resi)), '[]'::jsonb)
    into v
    from (
      select s.master_id, s.cliente_id,
        count(*) filter (where s.stato not in ('annullata','annullamento_pending','annullamento_manuale','storno_richiesto','in_lavorazione')) as partite,
        count(*) filter (where s.stato = 'reso_mittente') as resi
      from spedizioni s join clienti c on c.id = s.cliente_id
      where s.master_id in (select id from rete)
        and s.created_at >= p_dal
        and not coalesce(c.ledger, false)
        and not (s.tracking_number is not null and s.numero <> s.tracking_number and s.numero like s.tracking_number || '-%')
      group by s.master_id, s.cliente_id
    ) t;
  return v;
end;
$$;

revoke all on function public.resi_per_cliente_v2(uuid, timestamptz, uuid) from public;
revoke all on function public.resi_per_cliente_v2(uuid, timestamptz, uuid) from anon;
revoke all on function public.resi_per_cliente_v2(uuid, timestamptz, uuid) from authenticated;
grant execute on function public.resi_per_cliente_v2(uuid, timestamptz, uuid) to service_role;
