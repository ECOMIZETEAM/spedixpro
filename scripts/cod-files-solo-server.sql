-- cod_files (registro dei file contrassegni caricati, "File processati") si legge e si scrive SOLO dal server.
--
-- Fino al 20/11/2026 `authenticated` aveva tutti i permessi sulla tabella (anche DELETE e TRUNCATE) e la regola
-- cod_files_access lasciava passare chiunque avesse lo stesso master_id, comprese le utenze cliente: col proprio
-- token un cliente poteva leggere, modificare o cancellare il registro dei file del suo master (segnalato dalla
-- sessione SUPABASE). Dal codice 20/11/2026 tutte le letture e scritture passano dalle rotte
-- app/api/contrassegni/upload-cod (staff del master) e app/api/contrassegni/cod-files (vedeLaRete), col client di
-- servizio e il filtro sul master; la cancellazione di un sotto-master (app/api/clienti/[id]) era gia' di servizio.
--
-- ORDINE: prima il codice in produzione, poi questo SQL (con il codice vecchio i caricamenti scrivevano il
-- record col token dell'utente e fallirebbero). Revoca esplicita da anon e authenticated: "da public" non basta.

begin;
set local lock_timeout = '3s';
revoke all on table public.cod_files from authenticated;
revoke all on table public.cod_files from anon;
commit;

-- Controllo (devono restare solo postgres e service_role):
--   select grantee, string_agg(privilege_type, ', ') from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'cod_files' group by grantee;
-- Ripristino (solo se servisse tornare indietro):
--   grant select, insert, update, delete on table public.cod_files to authenticated;
