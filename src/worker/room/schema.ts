const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE room (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    code TEXT NOT NULL,
    owner_client_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    phase TEXT NOT NULL,
    vote_limit INTEGER NOT NULL,
    timer_ends_at INTEGER,
    timer_paused_remaining_ms INTEGER,
    discuss_index INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE categories (id TEXT PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL);
  CREATE TABLE participants (
    client_id TEXT PRIMARY KEY,
    joined_at INTEGER NOT NULL,
    ready INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    title TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    group_id TEXT REFERENCES groups(id),
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX items_client ON items(client_id);
  CREATE INDEX items_group ON items(group_id);
  CREATE TABLE votes (
    client_id TEXT NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id),
    count INTEGER NOT NULL CHECK (count > 0),
    PRIMARY KEY (client_id, group_id)
  );
  CREATE TABLE discuss_order (
    group_id TEXT PRIMARY KEY,
    position INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL
  );
  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    text TEXT NOT NULL,
    assignee TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
];

export function migrate(sql: SqlStorage): void {
  sql.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = sql.exec<{ version: number }>("SELECT version FROM schema_version").toArray()[0];
  if (!row) sql.exec("INSERT INTO schema_version (version) VALUES (0)");
  const current = row?.version ?? 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    sql.exec(MIGRATIONS[version] as string);
    sql.exec("UPDATE schema_version SET version = ?", version + 1);
  }
}
