-- CHI PUO' TOCCARE I DOCUMENTI DEL MASTER: ritiri, distinte contrassegni, file COD, file rettifiche.
--
-- DA APPLICARE (3/10/2026). Il contenuto e' verificato in produzione ma la migrazione non e' ancora
-- passata: applicarla da Supabase (SQL editor o migrazione) e poi rifare la misura in fondo.
--
-- `master_id` NON E' UN PERMESSO (lib/perimetro.ts, lib/ruoli.ts): ce l'hanno anche le 1.700 utenze
-- cliente, i 34 agenti e i 3 autisti. Su queste tabelle la RLS diceva soltanto "master_id = il mio",
-- e il grant per `authenticated` e' pieno (select/insert/update/delete): quindi col PROPRIO token,
-- via PostgREST, un cliente leggeva i documenti di TUTTI i clienti del suo master, e li scriveva.
-- Misurato il 3/10/2026 in produzione col token di un cliente vero di MULTIEXPRESS: 2.044 ritiri,
-- 260 distinte contrassegni, 89 file COD, 76 file rettifiche — e un UPDATE che portava una distinta
-- contrassegni in stato 'pagata' (cioe' "il master mi ha pagato") andava a buon fine.
--
-- La regola esiste gia' in un posto solo: auth_staff_master() = master/admin/operatore, usata da
-- zone, zone_cap, listini_clienti*, listini_corrieri*, spedizioni_margini, master_permessi,
-- rettifiche_files (in scrittura). Queste tabelle non l'avevano mai avuta. Qui si allineano:
--   - scrive solo lo staff del master;
--   - il CLIENTE legge le SUE righe, perche' il portale cliente mostra i suoi ritiri e le sue
--     distinte contrassegni col proprio token (app/api/ritiri, app/api/cliente/contrassegni/*);
--   - l'AGENTE legge quelle del master: il filtro sui suoi clienti sta nella rotta, come altrove;
--   - i file COD e i file delle rettifiche sono documenti interni del master: solo staff.
--
-- NON TOCCATE QUI, e perche': listini_clienti*, listini_corrieri*, zone, zone_cap restano leggibili a
-- tutta la rete perche' il motore prezzi le legge col token dell'utente (app/api/spedizioni/tariffe →
-- lib/pricing, lib/tariffe-motore): chiuderle vuol dire prima spostare quelle letture al service-role,
-- altrimenti il portale cliente non quota piu' niente. Vale anche per `masters`, che ha il grant SELECT
-- su tutte le 83 colonne (credito, iban, stripe) e viene letta col token dell'utente dal layout
-- cliente: li' serve il grant per-colonna come su `corrieri`, non una policy.

-- RITIRI. C'erano due policy identiche: stringerne una sola non sarebbe servito a niente, perche' le
-- permissive si sommano in OR.
drop policy if exists ritiri_access on public.ritiri;
drop policy if exists ritiri_master_access on public.ritiri;

create policy ritiri_staff on public.ritiri for all to authenticated
  using (master_id = public.auth_master_id() and public.auth_staff_master())
  with check (master_id = public.auth_master_id() and public.auth_staff_master());

create policy ritiri_legge_cliente_o_agente on public.ritiri for select to authenticated
  using (
    master_id = public.auth_master_id()
    and (
      (lower(coalesce(public.auth_ruolo(), '')) = 'cliente' and cliente_id = public.auth_cliente_id())
      or lower(coalesce(public.auth_ruolo(), '')) = 'agente'
    )
  );

-- DISTINTE CONTRASSEGNI.
drop policy if exists distinte_cod_access on public.distinte_contrassegni;

create policy distinte_cod_staff on public.distinte_contrassegni for all to authenticated
  using (master_id = public.auth_master_id() and public.auth_staff_master())
  with check (master_id = public.auth_master_id() and public.auth_staff_master());

create policy distinte_cod_legge_cliente_o_agente on public.distinte_contrassegni for select to authenticated
  using (
    master_id = public.auth_master_id()
    and (
      (lower(coalesce(public.auth_ruolo(), '')) = 'cliente' and cliente_id = public.auth_cliente_id())
      or lower(coalesce(public.auth_ruolo(), '')) = 'agente'
    )
  );

-- RIGHE DELLE DISTINTE: seguono la distinta a cui appartengono (il portale cliente apre il dettaglio
-- della propria distinta e legge le sue righe).
drop policy if exists distinte_cod_righe_access on public.distinte_contrassegni_righe;

create policy distinte_cod_righe_staff on public.distinte_contrassegni_righe for all to authenticated
  using (
    public.auth_staff_master()
    and distinta_id in (select dc.id from public.distinte_contrassegni dc where dc.master_id = public.auth_master_id())
  )
  with check (
    public.auth_staff_master()
    and distinta_id in (select dc.id from public.distinte_contrassegni dc where dc.master_id = public.auth_master_id())
  );

create policy distinte_cod_righe_legge_cliente_o_agente on public.distinte_contrassegni_righe for select to authenticated
  using (
    distinta_id in (
      select dc.id from public.distinte_contrassegni dc
      where dc.master_id = public.auth_master_id()
        and (
          (lower(coalesce(public.auth_ruolo(), '')) = 'cliente' and dc.cliente_id = public.auth_cliente_id())
          or lower(coalesce(public.auth_ruolo(), '')) = 'agente'
        )
    )
  );

-- FILE COD caricati dal master (gli estratti dei contrassegni incassati) e FILE delle rettifiche:
-- documenti interni, nessuna pagina del portale cliente li apre.
drop policy if exists cod_files_access on public.cod_files;
create policy cod_files_staff on public.cod_files for all to authenticated
  using (master_id = public.auth_master_id() and public.auth_staff_master())
  with check (master_id = public.auth_master_id() and public.auth_staff_master());

drop policy if exists rettifiche_files_leggi on public.rettifiche_files;
create policy rettifiche_files_leggi on public.rettifiche_files for select to authenticated
  using (master_id in (select public.mia_rete_master()) and public.auth_staff_master());

-- TABELLE LEGATE AI SOLDI, OGGI VUOTE (0 righe il 3/10/2026) MA CON LA PORTA APERTA: si chiudono
-- adesso, non il giorno in cui qualcuno ricomincia a scriverci.
drop policy if exists spedizioni_margini_leggi on public.spedizioni_margini;
create policy spedizioni_margini_leggi on public.spedizioni_margini for select to authenticated
  using (master_id in (select public.mia_rete_master()) and public.auth_staff_master());

drop policy if exists movimenti_clienti_access on public.movimenti_clienti;
create policy movimenti_clienti_staff on public.movimenti_clienti for all to authenticated
  using (master_id = public.auth_master_id() and public.auth_staff_master())
  with check (master_id = public.auth_master_id() and public.auth_staff_master());

drop policy if exists listini_master on public.listini;
create policy listini_staff on public.listini for all to authenticated
  using (master_id = public.auth_master_id() and public.auth_staff_master())
  with check (master_id = public.auth_master_id() and public.auth_staff_master());

drop policy if exists listini_fasce_master on public.listini_fasce;
create policy listini_fasce_staff on public.listini_fasce for all to authenticated
  using (
    public.auth_staff_master()
    and listino_id in (select l.id from public.listini l where l.master_id = public.auth_master_id())
  )
  with check (
    public.auth_staff_master()
    and listino_id in (select l.id from public.listini l where l.master_id = public.auth_master_id())
  );

-- TIPI DI BLOCCO della logistica: configurazione del master, scritta e letta dalle rotte col
-- service-role. Nessun portale la interroga col token dell'utente.
drop policy if exists tipi_blocco_rls on public.logistica_tipi_blocco;
create policy tipi_blocco_staff on public.logistica_tipi_blocco for all to authenticated
  using (master_id in (select public.mia_rete_master()) and public.auth_staff_master())
  with check (master_id in (select public.mia_rete_master()) and public.auth_staff_master());

-- COME SI VERIFICA (da rifare dopo l'applicazione, con gli stessi utenti).
-- Cliente vero di MULTIEXPRESS: deve vedere SOLO i suoi ritiri e le sue distinte, zero file COD,
-- zero file rettifiche, e l'UPDATE deve dare 0 righe.
--
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"8ba64553-e6df-45bd-85fd-88d696203a40","role":"authenticated"}';
-- select (select count(*) from ritiri) as ritiri,               -- prima: 2044
--        (select count(*) from distinte_contrassegni) as cod,   -- prima: 260
--        (select count(*) from cod_files) as cod_files,         -- prima: 89
--        (select count(*) from rettifiche_files) as rett;       -- prima: 76
-- rollback;
--
-- Staff del master: NON deve cambiare niente (stessi numeri di prima).
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<utente master/admin dello stesso master>","role":"authenticated"}';
-- ... stesse quattro conte ...
-- rollback;
