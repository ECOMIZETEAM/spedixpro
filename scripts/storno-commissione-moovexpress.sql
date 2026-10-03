-- STORNO della commissione MoovExpress all'ANNULLO della spedizione.
--
-- L'addebito (fn_fee_moovexpress_proprio, esenzione-commissione-moovexpress.sql) muove un CONTO A
-- PARTE: masters.commissioni_moovexpress, NON credito/credito_proprio. All'annullo, rimborsaAnnulloSpedizione
-- stornava solo i movimenti 'spedizione'/'rettifica' (che passano da registra_movimento_* → credito):
-- la commissione restava addebitata per sempre (verificato: 225 gambe annullate, ~11,25€ bloccati).
--
-- NON si poteva stornare col ciclo esistente: quello passa da registra_movimento_master, che per un
-- contratto 'proprio' scrive su credito_proprio — il conto SBAGLIATO (qualcuno ci aveva gia' provato e
-- 6 "pulizie" sono finite su credito_proprio). Serve una RPC dedicata che vada dritta sul conto giusto.
--
-- Simmetrica all'addebito: per ogni 'commissione' negativa non ancora stornata, rialza
-- commissioni_moovexpress di 0,05 e scrive un movimento 'commissione' POSITIVO (stesso tipo, segno
-- opposto → nei report che sommano 'commissione' il netto torna 0, e la guardia anti-doppio-rimborso
-- di rimborsaAnnulloSpedizione, che cerca un 'rimborso', non viene ingannata).
-- Idempotente: NOT EXISTS sullo storno gia' scritto. Gli ESENTI non hanno il movimento 'commissione',
-- quindi il ciclo non trova nulla (nessun bisogno di rileggere il flag, copre anche chi e' diventato
-- esente DOPO l'addebito).

create or replace function public.storna_fee_moovexpress(
  p_spedizione_id uuid,
  p_numero text,
  p_created_by uuid default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_saldo numeric;
begin
  for r in
    select m.master_id, m.importo, m.riferimento
      from public.movimenti m
     where m.spedizione_id = p_spedizione_id
       and m.tipo = 'commissione'
       and m.importo < 0                                   -- solo gli ADDEBITI, mai gli storni
       and not exists (
         select 1 from public.movimenti s
          where s.spedizione_id = p_spedizione_id
            and s.master_id = m.master_id
            and s.tipo = 'commissione'
            and s.importo = -m.importo                     -- lo storno opposto gia' presente
            and s.descrizione = 'Storno commissione MoovExpress (annullo)'
       )
  loop
    update public.masters
       set commissioni_moovexpress = round((coalesce(commissioni_moovexpress, 0) - r.importo)::numeric, 2)
     where id = r.master_id
     returning commissioni_moovexpress into v_saldo;        -- - (-0,05) = +0,05: risale verso 0
    insert into public.movimenti
      (master_id, cliente_id, master_target_id, tipo, descrizione, riferimento, importo, saldo_dopo, spedizione_id, created_by)
    values
      (r.master_id, null, r.master_id, 'commissione', 'Storno commissione MoovExpress (annullo)',
       coalesce(r.riferimento, p_numero), -r.importo, v_saldo, p_spedizione_id, p_created_by);
  end loop;
end $function$;

-- La chiama solo il service-role dentro rimborsaAnnulloSpedizione. Le funzioni nascono con EXECUTE
-- di DEFAULT a PUBLIC, che anon/authenticated ereditano: va revocato ANCHE da public, non basta
-- da anon/authenticated. Verificato con gli advisors (sparita dalle liste anon/authenticated) e con
-- role_routine_grants (restano solo postgres/service_role).
revoke all on function public.storna_fee_moovexpress(uuid, text, uuid) from public;
revoke all on function public.storna_fee_moovexpress(uuid, text, uuid) from anon;
revoke all on function public.storna_fee_moovexpress(uuid, text, uuid) from authenticated;
