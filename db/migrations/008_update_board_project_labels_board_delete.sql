do $$
declare
  fk_name text;
begin
  for fk_name in
    select constraint_name
    from information_schema.referential_constraints
    where constraint_schema = current_schema()
      and unique_constraint_name = (
        select constraint_name
        from information_schema.table_constraints
        where table_schema = current_schema()
          and table_name = 'trello_boards'
          and constraint_type = 'PRIMARY KEY'
      )
      and constraint_name in (
        select constraint_name
        from information_schema.table_constraints
        where table_schema = current_schema()
          and table_name = 'board_project_labels'
          and constraint_type = 'FOREIGN KEY'
      )
  loop
    execute format('alter table board_project_labels drop constraint %I', fk_name);
  end loop;

  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = current_schema()
      and table_name = 'board_project_labels'
      and constraint_name = 'board_project_labels_trello_board_id_fkey'
  ) then
    alter table board_project_labels
      add constraint board_project_labels_trello_board_id_fkey
      foreign key (trello_board_id)
      references trello_boards(trello_board_id)
      on delete cascade;
  end if;
end $$;
