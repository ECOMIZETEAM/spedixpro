-- INDIETRO di docs/costi-fuori-portale.sql: rimette guadagno_master_serie_v1 com'era il 24/11/2026 (il costo del
-- fuori portale non entra piu'). La tabella costi_fuori_portale RESTA con le sue righe: e' storico (CLAUDE.md), e
-- riapplicando il file in avanti i costi tornano a contare.
begin;
CREATE OR REPLACE FUNCTION public.guadagno_master_serie_v1(p_master uuid, p_dal timestamp with time zone, p_al timestamp with time zone, p_per_mese boolean, p_tipi text[])
 RETURNS TABLE(bucket text, ricavi numeric, costi numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_fmt text := case when p_per_mese then 'YYYY-MM' else 'YYYY-MM-DD' end;
begin
  -- ANNULLATE = 0 (regola Lorenzo 6/10): una spedizione annullata vale 0 a ogni livello (ognuno riprende
  -- esattamente quello che ha pagato). guadagno_spedizioni_serie_v1 e guadagno_ingrosso_adj_v1 gia' escludono
  -- le annullate; qui MANCAVA -> restavano gli STORNI (rimborso) senza gli addebiti = perdita-fantasma
  -- (-margine per i normali, -prezzo pieno per ponte/acquirente dove il costo sta su un ledger invisibile).
  -- Fix: not exists spedizioni annullata sui 3 ingressi dei movimenti operativi (mm, movsub, ramo-sopra).
  -- COSTI SENZA SPEDIZIONE (24/11/2026): i movimenti a mano con voce fuori_portale, compenso_agente o bonus
  -- (lib/movimento-manuale) entrano anche senza spedizione, in mm e nel ramo-sopra; le altre voci senza spedizione
  -- sono soldi tra le parti e restano fuori come prima.
  return query execute format($q$
    with sub as materialized (select id from masters where parent_master_id = %1$L::uuid),
    mm as materialized (
      select m.master_target_id, m.cliente_id, m.importo, m.tipo, m.spedizione_id, m.created_at
      from movimenti m
      where m.master_id = %1$L::uuid
        and (m.spedizione_id is not null or m.voce = any(array['fuori_portale','compenso_agente','bonus']))
        and m.tipo = any(%4$L::text[])
        and m.created_at >= %2$L::timestamptz and m.created_at <= %3$L::timestamptz
        and not exists (select 1 from spedizioni sx where sx.id = m.spedizione_id and sx.stato = 'annullata')
    ),
    movsub as materialized (
      select m.importo, m.tipo, m.spedizione_id, m.master_target_id, m.created_at, m.conto
      from movimenti m
      where m.master_id in (select id from sub) and m.master_id = m.master_target_id
        and m.spedizione_id is not null and m.tipo = any(%4$L::text[])
        and m.created_at >= %2$L::timestamptz and m.created_at <= %3$L::timestamptz
        and not exists (select 1 from spedizioni sx where sx.id = m.spedizione_id and sx.stato = 'annullata')
    ),
    selfsub as materialized (select distinct spedizione_id, master_target_id, tipo from movsub),
    movsub_ricavo as materialized (
      select ms.importo, ms.created_at from movsub ms
      where coalesce(ms.conto, 'rete') <> 'proprio'
        and coalesce(
              (select true from movimenti x where x.spedizione_id = ms.spedizione_id
                 and x.master_target_id = %1$L::uuid and x.tipo = 'spedizione' limit 1),
              (select true from spedizioni s2 join corrieri c2 on c2.id = s2.corriere_id
                 join corrieri cp on cp.master_id = %1$L::uuid and cp.proprio and cp.nome_contratto = c2.nome_contratto
                 where s2.id = ms.spedizione_id limit 1),
              false)
    ),
    contrib as (
      select to_char(mm.created_at at time zone 'UTC', %5$L) b, -mm.importo r, 0::numeric c
      from mm where mm.cliente_id is not null
      union all
      select to_char(mm.created_at at time zone 'UTC', %5$L),
             case when s.master_id = %1$L::uuid and s.cliente_id is null then -mm.importo else 0 end, -mm.importo
      from mm left join spedizioni s on s.id = mm.spedizione_id
      where mm.cliente_id is null and mm.master_target_id = %1$L::uuid
      union all
      select to_char(mm.created_at at time zone 'UTC', %5$L), -mm.importo, 0::numeric
      from mm join sub on sub.id = mm.master_target_id
      left join selfsub ss on ss.spedizione_id = mm.spedizione_id and ss.master_target_id = mm.master_target_id and ss.tipo = mm.tipo
      where mm.cliente_id is null and mm.tipo <> 'spedizione' and ss.spedizione_id is null
      union all
      select to_char(movsub_ricavo.created_at at time zone 'UTC', %5$L), -movsub_ricavo.importo, 0::numeric
      from movsub_ricavo
      union all
      select to_char(m.created_at at time zone 'UTC', %5$L), 0::numeric, -m.importo
      from movimenti m
      where m.master_target_id = %1$L::uuid and m.master_id <> %1$L::uuid
        and (m.spedizione_id is not null or m.voce = any(array['fuori_portale','compenso_agente','bonus']))
        and m.tipo = any(%4$L::text[])
        and m.created_at >= %2$L::timestamptz and m.created_at <= %3$L::timestamptz
        and not exists (select 1 from spedizioni sx where sx.id = m.spedizione_id and sx.stato = 'annullata')
    )
    select b, round(sum(r)::numeric,2), round(sum(c)::numeric,2) from contrib group by b
  $q$, p_master, p_dal, p_al, p_tipi, v_fmt);
end;
$function$;

commit;
