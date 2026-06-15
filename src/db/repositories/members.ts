import { getDbPool } from "../client.js";

export type MemberRecord = {
  trelloMemberId: string;
  displayName: string;
  username: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type MemberRow = {
  trello_member_id: string;
  display_name: string;
  username: string | null;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export async function upsertMembers(
  members: Array<{
    trelloMemberId: string;
    displayName: string;
    username?: string | null;
  }>
): Promise<MemberRecord[]> {
  if (members.length === 0) {
    return [];
  }

  const result = await getDbPool().query<MemberRow>(
    `
      insert into members (
        trello_member_id,
        display_name,
        username,
        last_seen_at,
        updated_at
      )
      select
        item.trello_member_id,
        item.display_name,
        item.username,
        now(),
        now()
      from jsonb_to_recordset($1::jsonb) as item(
        trello_member_id text,
        display_name text,
        username text
      )
      on conflict (trello_member_id) do update
      set display_name = excluded.display_name,
          username = excluded.username,
          last_seen_at = now(),
          updated_at = now()
      returning
        trello_member_id,
        display_name,
        username,
        last_seen_at,
        created_at,
        updated_at
    `,
    [
      JSON.stringify(
        members.map((member) => ({
          trello_member_id: member.trelloMemberId,
          display_name: member.displayName,
          username: member.username ?? null,
        }))
      ),
    ]
  );

  return result.rows.map(mapMember);
}

export async function listMembersByIds(
  trelloMemberIds: string[]
): Promise<MemberRecord[]> {
  if (trelloMemberIds.length === 0) {
    return [];
  }

  const result = await getDbPool().query<MemberRow>(
    `
      select
        trello_member_id,
        display_name,
        username,
        last_seen_at,
        created_at,
        updated_at
      from members
      where trello_member_id = any($1::text[])
      order by display_name asc, username asc nulls last
    `,
    [trelloMemberIds]
  );

  return result.rows.map(mapMember);
}

function mapMember(row: MemberRow): MemberRecord {
  return {
    trelloMemberId: row.trello_member_id,
    displayName: row.display_name,
    username: row.username,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
