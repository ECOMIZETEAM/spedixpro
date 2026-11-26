-- RECUPERO DELL'ARCHIVIO PREZZI DI COSTO DEI MASTER dal registro (audit_log) — da lanciare DOPO
-- scripts/archivio-prezzi-costo-master.sql, una volta sola. Rilanciarlo non duplica niente.
--
-- Chi si recupera: i contratti che hanno una storia (spedizioni, o righe a valle che li comprano) e che
-- oggi non hanno più nessuna fascia di costo né un archivio. Al 26/11 sono 9, tutti spenti:
--   Ecomize LL, Poste Express M ............ 4.704 pacchi in 120 gg, prezzi cancellati il 06/11
--   Dg Express, Poste Express M ............ 1.160 pacchi, 06/11
--   AGENZIA ENTRATE RISCOSSIONE (3 contratti), Velox Logistick (3), di Simine storage (1): ottobre.
-- Gli altri 35 contratti senza prezzi di costo non hanno mai spedito: non c'è niente da prezzare dopo.
--
-- Come si ritrovano. Il registro ha ogni riga cancellata per intero (trg_audit su fasce, supplementi
-- e agganci di costo, dal 28/07/2026). Per ogni contratto si cerca l'ULTIMA cancellazione di sue fasce
-- (dopo il suo ultimo pacco, meno un giorno: prima non poteva essere senza prezzi), e intorno a
-- quell'istante (un minuto prima e dopo) i supplementi e gli agganci cancellati con lei. Se nel minuto
-- la stessa tabella è stata cancellata più volte, vale l'ultima. Provato in lettura il 26/11: tutti e 9
-- trovati, con fasce (da 4 a 54) e supplementi (da 7 a 14); 4 anche con gli agganci.
--
-- Il recupero da solo non cambia nessun addebito: l'archivio lo legge solo il codice nuovo dopo la
-- partenza (rilascio "si paga sempre").

begin;
set local statement_timeout = '10min';

with da_fare as (
  select c.id corriere_id,
         coalesce((select max(s.created_at) from public.spedizioni s where s.corriere_id = c.id), c.created_at)
           - interval '1 day' as da
    from public.corrieri c
   where not exists (select 1 from public.listini_corrieri_fasce f where f.corriere_id = c.id)
     and not exists (select 1 from public.listini_corrieri_archivio a where a.corriere_id = c.id)
     and (exists (select 1 from public.spedizioni s where s.corriere_id = c.id)
          or exists (select 1 from public.corrieri g where g.fornitore_corriere_id = c.id))
), ultima as (
  select d.corriere_id, u.at
    from da_fare d
    cross join lateral (
      select max(a.at) at from public.audit_log a
       where a.tabella = 'listini_corrieri_fasce' and a.azione = 'DELETE' and a.at >= d.da
         and a.modifiche->>'corriere_id' = d.corriere_id::text
    ) u
   where u.at is not null
), righe as (
  select v.tabella, u.corriere_id, v.modifiche riga, v.at
    from ultima u
    cross join lateral (
      select a.tabella, a.modifiche, a.at, max(a.at) over (partition by a.tabella) ultima
        from public.audit_log a
       where a.tabella in ('listini_corrieri_fasce', 'listini_corrieri_supplementi', 'listini_corrieri_corrieri')
         and a.azione = 'DELETE'
         and a.at between u.at - interval '60 seconds' and u.at + interval '60 seconds'
         and a.modifiche->>'corriere_id' = u.corriere_id::text
    ) v
   where v.at = v.ultima and v.modifiche ? 'listino_id'
)
insert into public.listini_corrieri_archivio (tabella, listino_id, corriere_id, riga, archiviato_at)
select r.tabella, (r.riga->>'listino_id')::uuid, r.corriere_id, r.riga, r.at from righe r;

-- Cosa è entrato, da guardare: contratti e righe per tabella. Al 26/11 ci si aspetta 9 contratti con
-- fasce (196 righe), 9 con supplementi (92) e 4 con agganci (9).
select tabella, count(distinct corriere_id) contratti, count(*) righe
  from public.listini_corrieri_archivio group by tabella order by tabella;

commit;
