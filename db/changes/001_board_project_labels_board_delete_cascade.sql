do $$
declare
  fk_name text;
begin
  select tc.constraint_name
    into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_schema = tc.constraint_schema
   and kcu.constraint_name = tc.constraint_name
  where tc.constraint_schema = current_schema()
    and tc.table_name = 'board_project_labels'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'trello_board_id'
  limit 1;

  if fk_name is not null then
    execute format(
      'alter table board_project_labels drop constraint %I',
      fk_name
    );
  end if;

  alter table board_project_labels
    add constraint board_project_labels_trello_board_id_fkey
    foreign key (trello_board_id)
    references trello_boards(trello_board_id)
    on delete cascade;
end $$;
