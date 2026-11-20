-- SPESE CON L'IVA GIA' DENTRO (Lorenzo, 20/11/2026: "sistema l'IVA doppia di Aggiungi spesa").
--
-- In Consumabili → Aggiungi spesa il master sceglie l'IVA (22, 10, 4, 0%) e il credito scala prezzo + IVA:
-- e' una scelta esplicita del master, e resta cosi'. Ma proforma e Report Fatture trattavano quell'importo
-- come IMPONIBILE e ci rimettevano sopra l'aliquota del cliente: IVA due volte. Caso vero, QUICK a MOI CHERI
-- il 30/10: 196,73 + 22% = 240,01 scalati, e in proforma 240,01 di imponibile + 52,80 di IVA = 292,81.
--
-- Qui si scrive, per il movimento, quanta IVA contiene gia' (la sua aliquota). I movimenti non cambiano: la
-- tabella sta a parte, una riga per movimento segnato. I documenti lo riportano al netto e l'IVA si conta
-- una volta sola. Senza righe qui (tutti i movimenti di oggi) i numeri restano identici a prima.

begin;

create table if not exists public.movimenti_iva_compresa (
  movimento_id uuid primary key,
  aliquota numeric not null check (aliquota > 0 and aliquota <= 100),
  creato_il timestamptz not null default now()
);
-- Niente chiave esterna verso movimenti, di proposito: creare la chiave bloccherebbe per un attimo la
-- tabella piu' scritta della piattaforma. Le righe le scrive solo il server, dopo aver registrato il movimento.

alter table public.movimenti_iva_compresa enable row level security;
revoke all on table public.movimenti_iva_compresa from public, anon, authenticated;
grant select, insert on table public.movimenti_iva_compresa to service_role;

-- Report Fatture: come la v2, con in piu' l'aliquota gia' compresa nel movimento (null = nessuna). La rotta
-- legge a pagine da 1.000: l'ordine e' fisso.
create or replace function public.fatture_importi_periodo_v3(p_master uuid, p_dal timestamptz, p_al timestamptz)
returns table(cliente_id uuid, tipo text, con_spedizione boolean, iva_inclusa boolean, aliquota_compresa numeric, n bigint, importo numeric)
language sql stable set search_path = public as $$
  with usa as (select exists (select 1 from public.listini_iva where master_id = p_master) as si)
  select m.cliente_id, m.tipo, (m.spedizione_id is not null),
         case when (select si from usa) and m.spedizione_id is not null
              then public.fn_iva_vendita(p_master, 'cliente', m.cliente_id, m.spedizione_id, m.tipo)
              else false end,
         c.aliquota,
         count(*), sum(m.importo)
    from public.movimenti m
    left join public.movimenti_iva_compresa c on c.movimento_id = m.id
   where m.master_id = p_master
     and m.cliente_id is not null
     and m.master_target_id is null
     and m.created_at >= p_dal
     and m.created_at <= p_al
   group by 1, 2, 3, 4, 5
   order by 1, 2, 3, 4, 5
$$;

revoke all on function public.fatture_importi_periodo_v3(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.fatture_importi_periodo_v3(uuid, timestamptz, timestamptz) to service_role;

commit;

-- Dopo: advisors (zero errori) e, in sola lettura,
--   select count(*) from movimenti_iva_compresa;   -- 0 finche' nessuno aggiunge una spesa con IVA
