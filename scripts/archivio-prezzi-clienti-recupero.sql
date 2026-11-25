-- RECUPERO DELL'ARCHIVIO PREZZI CLIENTE dal registro (audit_log) — da lanciare DOPO
-- scripts/archivio-prezzi-clienti.sql, una volta sola. Rilanciarlo non duplica niente.
--
-- I contratti tolti dai listini PRIMA che esistesse l'archivio hanno perso i prezzi, ma il registro
-- ha ogni riga cancellata per intero (trg_audit su fasce, supplementi e agganci, dal 28/07/2026).
-- Al 25/11 le coppie listino × contratto tolte e mai rimesse sono 3.251.
--
-- Come si ritrovano senza leggere tutto il registro (3,7 GB: un conteggio sulle fasce va in timeout).
-- "Rimuovi contratto" cancella fasce, supplementi e aggancio uno dopo l'altro, a pochi millesimi.
-- Si parte quindi dalle cancellazioni degli AGGANCI (poche: 3.559 in 120 giorni) e per ognuna si
-- leggono le fasce e i supplementi cancellati nel minuto prima, sull'indice (tabella, at). Se in quel
-- minuto la stessa coppia è stata cancellata più volte, vale l'ultima cancellazione (stesso `at`).
--
-- Non recupera i contratti a cui sono state svuotate le celle lasciando l'aggancio (274 al 25/11): lì
-- non c'è un istante da cui partire. Se un loro pacco ne avrà bisogno, finirà tra quelli da prezzare.

begin;
set local statement_timeout = '10min';

with agganci_tolti as (
  -- l'ULTIMA rimozione di ogni coppia
  select distinct on (x.listino_id, x.corriere_id) x.listino_id, x.corriere_id, x.at, x.riga
    from (select (a.modifiche->>'listino_id')::uuid listino_id, (a.modifiche->>'corriere_id')::uuid corriere_id,
                 a.at, a.modifiche riga
            from public.audit_log a
           where a.tabella = 'listini_clienti_corrieri' and a.azione = 'DELETE'
             and a.modifiche ? 'listino_id' and a.modifiche ? 'corriere_id') x
   order by x.listino_id, x.corriere_id, x.at desc
), da_fare as (
  -- solo le coppie che il listino oggi non prezza e che l'archivio non ha già
  select t.* from agganci_tolti t
   where not exists (select 1 from public.listini_clienti_fasce f
                      where f.listino_id = t.listino_id and f.corriere_id = t.corriere_id)
     and not exists (select 1 from public.listini_clienti_archivio r
                      where r.listino_id = t.listino_id and r.corriere_id = t.corriere_id)
), righe as (
  select 'listini_clienti_corrieri' tabella, d.listino_id, d.corriere_id, d.riga, d.at from da_fare d
  union all
  select v.tabella, d.listino_id, d.corriere_id, v.modifiche, v.at
    from da_fare d
    cross join lateral (
      select a.tabella, a.modifiche, a.at,
             max(a.at) over (partition by a.tabella) ultima
        from public.audit_log a
       where a.tabella in ('listini_clienti_fasce', 'listini_clienti_supplementi') and a.azione = 'DELETE'
         and a.at between d.at - interval '60 seconds' and d.at
         and a.modifiche->>'listino_id' = d.listino_id::text
         and a.modifiche->>'corriere_id' = d.corriere_id::text
    ) v
   where v.at = v.ultima
)
insert into public.listini_clienti_archivio (tabella, listino_id, corriere_id, riga, archiviato_at)
select r.tabella, r.listino_id, r.corriere_id, r.riga, r.at from righe r;

-- Cosa è entrato, da guardare prima del commit: coppie e righe per tabella.
select tabella, count(distinct (listino_id, corriere_id)) coppie, count(*) righe
  from public.listini_clienti_archivio group by tabella order by tabella;

commit;
