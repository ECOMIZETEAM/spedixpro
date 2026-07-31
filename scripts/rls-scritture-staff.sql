-- ════════════════════════════════════════════════════════════════════════════
-- LE SCRITTURE DI CONFIGURAZIONE SONO SOLO DELLO STAFF DEL MASTER
-- Applicato in produzione il 31/07/2026. Qui per memoria e per rifarlo altrove.
--
-- Il problema: le policy di queste tabelle dicevano "sei della rete di questo master?"
-- e basta. Ma il perimetro parte da auth_master_id(), cioe' dalla colonna master_id
-- dell'utente — e ce l'hanno ANCHE i clienti e gli agenti. Con il proprio token, e
-- chiamando direttamente l'API del database (che non passa dalle nostre rotte, quindi
-- da nessun controllo del middleware), un cliente o un agente poteva SCRIVERE sulla
-- configurazione del master: spegnere i contratti corriere, spostare i CAP delle zone
-- e con essi i prezzi applicati a tutti i clienti, riscrivere i listini, cambiare
-- l'IBAN nell'anagrafica, rifarsi i permessi, pubblicare notifiche.
--
-- La lettura resta com'era: serve al portale. Cambia solo chi puo' scrivere.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.auth_staff_master() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select lower(coalesce(public.auth_ruolo(), '')) in ('master', 'admin', 'operatore')
$$;

do $$
declare t text;
begin
  foreach t in array array['corrieri','corrieri_condivisi','listini_clienti','master_permessi','notifiche','rettifiche_files','spedizioni_margini','zone']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_rls', t);
    execute format($f$create policy %I on public.%I for select using (master_id in (select public.mia_rete_master()))$f$, t || '_leggi', t);
    execute format($f$create policy %I on public.%I for insert with check (master_id in (select public.mia_rete_master()) and public.auth_staff_master())$f$, t || '_inserisci', t);
    execute format($f$create policy %I on public.%I for update using (master_id in (select public.mia_rete_master()) and public.auth_staff_master()) with check (master_id in (select public.mia_rete_master()) and public.auth_staff_master())$f$, t || '_aggiorna', t);
    execute format($f$create policy %I on public.%I for delete using (master_id in (select public.mia_rete_master()) and public.auth_staff_master())$f$, t || '_elimina', t);
  end loop;
end $$;

-- zone_cap: il perimetro passa dalla zona
drop policy if exists zone_cap_rls on public.zone_cap;
create policy zone_cap_leggi on public.zone_cap for select
  using (zona_id in (select id from public.zone where master_id in (select public.mia_rete_master())));
create policy zone_cap_inserisci on public.zone_cap for insert
  with check (zona_id in (select id from public.zone where master_id in (select public.mia_rete_master())) and public.auth_staff_master());
create policy zone_cap_aggiorna on public.zone_cap for update
  using (zona_id in (select id from public.zone where master_id in (select public.mia_rete_master())) and public.auth_staff_master())
  with check (zona_id in (select id from public.zone where master_id in (select public.mia_rete_master())) and public.auth_staff_master());
create policy zone_cap_elimina on public.zone_cap for delete
  using (zona_id in (select id from public.zone where master_id in (select public.mia_rete_master())) and public.auth_staff_master());

-- masters: anagrafica (IBAN compreso) e creazione di sotto-master
drop policy if exists master_aggiorna_se_stesso on public.masters;
create policy master_aggiorna_se_stesso on public.masters for update
  using (id = public.auth_master_id() and public.auth_staff_master())
  with check (id = public.auth_master_id() and public.auth_staff_master());
drop policy if exists master_crea_figli on public.masters;
create policy master_crea_figli on public.masters for insert
  with check (public.auth_staff_master());

-- Niente RPC del credito senza aver fatto accesso (si difendono da sole, ma la porta
-- aperta a chi non ha nemmeno un account non serve a nessuno).
revoke execute on function public.auth_staff_master() from public, anon;
revoke execute on function public.registra_movimento_cliente(uuid,uuid,text,text,numeric,text,uuid,uuid,boolean) from public, anon;
revoke execute on function public.registra_movimento_master(uuid,uuid,text,text,numeric,text,uuid,uuid) from public, anon;
revoke execute on function public.conferma_prenotazione_spedizione(text,uuid,text,numeric,text) from public, anon;
revoke execute on function public.storna_prenotazione_spedizione(text) from public, anon;
grant execute on function public.auth_staff_master() to authenticated, service_role;
grant execute on function public.registra_movimento_cliente(uuid,uuid,text,text,numeric,text,uuid,uuid,boolean) to authenticated, service_role;
grant execute on function public.registra_movimento_master(uuid,uuid,text,text,numeric,text,uuid,uuid) to authenticated, service_role;
grant execute on function public.conferma_prenotazione_spedizione(text,uuid,text,numeric,text) to authenticated, service_role;
grant execute on function public.storna_prenotazione_spedizione(text) to authenticated, service_role;

-- NB: registra_movimento_cliente e' stata anche ristretta — l'agente puo' toccare il
-- credito dei suoi clienti SOLO con p_tipo = 'spedizione' (che gli spetta), non con una
-- 'rettifica' negativa a piacere. Il testo completo della funzione e' in produzione.

-- Bucket dei file riservati: privato, con tetto e tipi ammessi.
update storage.buckets set public = false, file_size_limit = 26214400
where id = 'reports';

-- ════════════════════════════════════════════════════════════════════════════
-- SECONDA PARTE (31/07/2026): listini d'acquisto e credenziali dei corrieri
-- ════════════════════════════════════════════════════════════════════════════

-- Il LISTINO CORRIERI e' il costo d'acquisto del master: lo vede solo lo staff.
-- Le policy erano "master_id = il mio master", senza guardare il ruolo — e
-- utenti.master_id e' valorizzato anche per i 503 clienti e i 18 agenti.
do $$
declare r record;
begin
  for r in
    select * from (values
      ('listini_corrieri','listini_corrieri_access','master_id = public.auth_master_id()'),
      ('listini_corrieri_fasce','listini_corrieri_fasce_access','listino_id in (select id from public.listini_corrieri where master_id = public.auth_master_id())'),
      ('listini_corrieri_supplementi','listini_corrieri_suppl_access','listino_id in (select id from public.listini_corrieri where master_id = public.auth_master_id())'),
      ('listini_corrieri_corrieri','listini_corrieri_corrieri_access','listino_id in (select id from public.listini_corrieri where master_id = public.auth_master_id())')
    ) as t(tab, pol, cond)
  loop
    execute format('drop policy if exists %I on public.%I', r.pol, r.tab);
    execute format('create policy %I on public.%I for all using (%s and public.auth_staff_master()) with check (%s and public.auth_staff_master())',
                   r.tab || '_staff', r.tab, r.cond, r.cond);
  end loop;
end $$;

-- I PREZZI DI VENDITA si leggono, non si riscrivono: un cliente poteva portare a
-- 0,01 le proprie fasce e alterare quelle di tutti gli altri clienti del master.
do $$
declare r record;
begin
  for r in
    select * from (values
      ('listini_clienti_fasce','listini_clienti_fasce_access'),
      ('listini_clienti_supplementi','listini_clienti_suppl_access'),
      ('listini_clienti_corrieri','listini_clienti_corrieri_access')
    ) as t(tab, pol)
  loop
    execute format('drop policy if exists %I on public.%I', r.pol, r.tab);
    execute format($f$create policy %I on public.%I for select using (listino_id in (select id from public.listini_clienti where master_id in (select public.mia_rete_master())))$f$, r.tab || '_leggi', r.tab);
    execute format($f$create policy %I on public.%I for insert with check (listino_id in (select id from public.listini_clienti where master_id in (select public.mia_rete_master())) and public.auth_staff_master())$f$, r.tab || '_inserisci', r.tab);
    execute format($f$create policy %I on public.%I for update using (listino_id in (select id from public.listini_clienti where master_id in (select public.mia_rete_master())) and public.auth_staff_master()) with check (listino_id in (select id from public.listini_clienti where master_id in (select public.mia_rete_master())) and public.auth_staff_master())$f$, r.tab || '_aggiorna', r.tab);
    execute format($f$create policy %I on public.%I for delete using (listino_id in (select id from public.listini_clienti where master_id in (select public.mia_rete_master())) and public.auth_staff_master())$f$, r.tab || '_elimina', r.tab);
  end loop;
end $$;

-- LE CREDENZIALI DEI CORRIERI non si leggono con il token di un utente.
-- E' la cosa piu' grave trovata: con quelle chiavi si spedisce direttamente
-- sull'account del master, a sue spese. Il REVOKE sulla singola colonna non
-- basta: c'era un permesso di lettura a livello di TABELLA, che copre tutte le
-- colonne. Si toglie quello e si riconcedono le colonne una per una.
revoke select on public.corrieri from authenticated, anon;
grant select (id, master_id, tipo, nome_contratto, attivo, livello, multicollo,
              inserimento_ritiri, settings, created_at, updated_at, condivisibile)
  on public.corrieri to authenticated;
-- NB: aggiungendo una colonna a `corrieri` va aggiunta anche a questa GRANT,
-- altrimenti resta invisibile al portale.
