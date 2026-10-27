-- LISTINI CORRIERI: OGNI RIGA STA COL SUO CONTRATTO, E IL LISTINO SI CHIAMA COME LUI.
--
-- Da applicare DOPO che il codice del calcolo a lotti per contratto e' in produzione (READY):
-- un vincolo nel database vale subito per tutto il codice che gira, anche quello vecchio.
--
-- Perche' (27/10/2026, verificato sui dati):
--  - 205 listini su 864 avevano il nome di un altro contratto: il cambio nome del contratto
--    (propagaNomeContrattoAlleCopie) rinomina le copie in `corrieri`, mai il listino. Wave vedeva
--    "SDA EXPRESS L" ma il suo listino si chiamava ancora "Poste Delivery Business Triangolazioni".
--  - CF GROUP aveva 28 fasce GLS CASERTA e 36 POSTE DELIVERY EXPRESS D dentro il listino di Poste
--    Delivery Business S (vecchio editor a listino unico, 3/8). L'addebito non se ne accorgeva
--    (filtra per contratto), l'elenco si': mescolava i prezzi di tre contratti.
-- Dati riallineati a mano il 27/10 (backup in ~/moovexpress-listini-contratto-backup). Queste
-- regole impediscono che si ricrei, da qualunque porta: editor, copia ai sotto-master,
-- condivisione, script, e quelle che nasceranno.

-- 1) Il nome del listino corrieri e' quello del suo contratto, sempre.
create or replace function public.fn_listino_corrieri_nome_dal_contratto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if new.corriere_id is null then return new; end if;   -- segnaposto dell'editor senza contratto
  select nome_contratto into v_nome from public.corrieri where id = new.corriere_id;
  if v_nome is not null then new.nome := v_nome; end if;
  return new;
end $$;

drop trigger if exists trg_listino_corrieri_nome on public.listini_corrieri;
create trigger trg_listino_corrieri_nome
  before insert or update of nome, corriere_id on public.listini_corrieri
  for each row execute function public.fn_listino_corrieri_nome_dal_contratto();

-- 2) Quando il contratto cambia nome (anche a cascata sulle copie), il suo listino lo segue.
create or replace function public.fn_corrieri_nome_ai_listini()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.listini_corrieri set nome = new.nome_contratto
   where corriere_id = new.id and nome is distinct from new.nome_contratto;
  return null;
end $$;

drop trigger if exists trg_corrieri_nome_ai_listini on public.corrieri;
create trigger trg_corrieri_nome_ai_listini
  after update of nome_contratto on public.corrieri
  for each row when (old.nome_contratto is distinct from new.nome_contratto)
  execute function public.fn_corrieri_nome_ai_listini();

-- 3) Fasce e supplementi stanno nel listino del LORO contratto, presso lo stesso master.
--    Se chi scrive indica il listino di un altro contratto, la riga va in quello giusto: il prezzo e'
--    lo stesso (l'addebito legge per contratto), ma l'elenco e chi cancella "il listino X" no.
--    Se il contratto non ha un listino suo presso quel master, la riga non ha un posto giusto: rifiuto.
create or replace function public.fn_riga_listino_corrieri_al_suo_contratto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_master uuid; v_corr uuid; v_giusto uuid;
begin
  if new.corriere_id is null then return new; end if;
  select master_id, corriere_id into v_master, v_corr from public.listini_corrieri where id = new.listino_id;
  if v_corr is not distinct from new.corriere_id then return new; end if;
  select id into v_giusto from public.listini_corrieri
   where master_id = v_master and corriere_id = new.corriere_id;
  if v_giusto is null then
    raise exception 'Questa riga di prezzo appartiene a un contratto che non ha un listino suo presso questo master.'
      using errcode = '23514';
  end if;
  new.listino_id := v_giusto;
  return new;
end $$;

drop trigger if exists trg_fasce_nel_listino_del_contratto on public.listini_corrieri_fasce;
create trigger trg_fasce_nel_listino_del_contratto
  before insert or update of listino_id, corriere_id on public.listini_corrieri_fasce
  for each row execute function public.fn_riga_listino_corrieri_al_suo_contratto();

drop trigger if exists trg_supplementi_nel_listino_del_contratto on public.listini_corrieri_supplementi;
create trigger trg_supplementi_nel_listino_del_contratto
  before insert or update of listino_id, corriere_id on public.listini_corrieri_supplementi
  for each row execute function public.fn_riga_listino_corrieri_al_suo_contratto();

-- Come le altre funzioni dei trigger: eseguibili solo dal sistema (il trigger scatta lo stesso).
revoke all on function public.fn_listino_corrieri_nome_dal_contratto() from public, anon, authenticated;
revoke all on function public.fn_corrieri_nome_ai_listini() from public, anon, authenticated;
revoke all on function public.fn_riga_listino_corrieri_al_suo_contratto() from public, anon, authenticated;
grant execute on function public.fn_listino_corrieri_nome_dal_contratto() to service_role;
grant execute on function public.fn_corrieri_nome_ai_listini() to service_role;
grant execute on function public.fn_riga_listino_corrieri_al_suo_contratto() to service_role;
