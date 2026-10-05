import type { Category, DiscussStatus, Phase, TimerState } from "../../shared/protocol";

export type Room = {
  code: string;
  ownerClientId: string;
  createdAt: number;
  expiresAt: number;
  phase: Phase;
  voteLimit: number;
  timer: TimerState;
  discussIndex: number;
};

export type Item = {
  id: string;
  clientId: string;
  categoryId: string;
  groupId: string | null;
  text: string;
  createdAt: number;
  updatedAt: number;
};

export type Group = {
  id: string;
  categoryId: string;
  title: string | null;
  createdAt: number;
};

export type DiscussEntry = { groupId: string; position: number; status: DiscussStatus };

export type Comment = {
  id: string;
  groupId: string;
  clientId: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};

export type Action = Comment & { assignee: string | null };

type RoomRow = {
  code: string;
  owner_client_id: string;
  created_at: number;
  expires_at: number;
  phase: string;
  vote_limit: number;
  timer_ends_at: number | null;
  timer_paused_remaining_ms: number | null;
  discuss_index: number;
};

type ItemRow = {
  id: string;
  client_id: string;
  category_id: string;
  group_id: string | null;
  text: string;
  created_at: number;
  updated_at: number;
};

type GroupRow = { id: string; category_id: string; title: string | null; created_at: number };

type CommentRow = {
  id: string;
  group_id: string;
  client_id: string;
  text: string;
  created_at: number;
  updated_at: number;
};

type ActionRow = CommentRow & { assignee: string | null };

const toTimer = (row: RoomRow): TimerState => {
  if (row.timer_ends_at !== null) return { kind: "running", endsAt: row.timer_ends_at };
  if (row.timer_paused_remaining_ms !== null) {
    return { kind: "paused", remainingMs: row.timer_paused_remaining_ms };
  }
  return { kind: "none" };
};

const toRoom = (row: RoomRow): Room => ({
  code: row.code,
  ownerClientId: row.owner_client_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  phase: row.phase as Phase,
  voteLimit: row.vote_limit,
  timer: toTimer(row),
  discussIndex: row.discuss_index,
});

const toItem = (row: ItemRow): Item => ({
  id: row.id,
  clientId: row.client_id,
  categoryId: row.category_id,
  groupId: row.group_id,
  text: row.text,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toGroup = (row: GroupRow): Group => ({
  id: row.id,
  categoryId: row.category_id,
  title: row.title,
  createdAt: row.created_at,
});

const toComment = (row: CommentRow): Comment => ({
  id: row.id,
  groupId: row.group_id,
  clientId: row.client_id,
  text: row.text,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAction = (row: ActionRow): Action => ({ ...toComment(row), assignee: row.assignee });

const ITEM_ORDER = "ORDER BY created_at, id";

export class RoomStore {
  readonly #storage: DurableObjectStorage;
  readonly #sql: SqlStorage;

  constructor(storage: DurableObjectStorage) {
    this.#storage = storage;
    this.#sql = storage.sql;
  }

  transaction<T>(fn: () => T): T {
    return this.#storage.transactionSync(fn);
  }

  #all<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): T[] {
    return this.#sql.exec<T>(query, ...bindings).toArray();
  }

  #first<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: unknown[]
  ): T | null {
    return this.#all<T>(query, ...bindings)[0] ?? null;
  }

  #run(query: string, ...bindings: unknown[]): void {
    this.#sql.exec(query, ...bindings);
  }

  getRoom(): Room | null {
    const row = this.#first<RoomRow>("SELECT * FROM room WHERE id = 1");
    return row ? toRoom(row) : null;
  }

  insertRoom(room: Omit<Room, "timer" | "discussIndex">): void {
    this.#run(
      `INSERT INTO room (id, code, owner_client_id, created_at, expires_at, phase, vote_limit)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      room.code,
      room.ownerClientId,
      room.createdAt,
      room.expiresAt,
      room.phase,
      room.voteLimit,
    );
  }

  setPhase(phase: Phase): void {
    this.#run("UPDATE room SET phase = ? WHERE id = 1", phase);
  }

  setVoteLimit(limit: number): void {
    this.#run("UPDATE room SET vote_limit = ? WHERE id = 1", limit);
  }

  setTimer(timer: TimerState): void {
    this.#run(
      "UPDATE room SET timer_ends_at = ?, timer_paused_remaining_ms = ? WHERE id = 1",
      timer.kind === "running" ? timer.endsAt : null,
      timer.kind === "paused" ? timer.remainingMs : null,
    );
  }

  setDiscussIndex(index: number): void {
    this.#run("UPDATE room SET discuss_index = ? WHERE id = 1", index);
  }

  insertCategory(category: Category, position: number): void {
    this.#run(
      "INSERT INTO categories (id, title, position) VALUES (?, ?, ?)",
      category.id,
      category.title,
      position,
    );
  }

  listCategories(): Category[] {
    return this.#all<{ id: string; title: string }>(
      "SELECT id, title FROM categories ORDER BY position",
    ).map((row) => ({ id: row.id, title: row.title }));
  }

  categoryExists(id: string): boolean {
    return this.#first("SELECT 1 AS found FROM categories WHERE id = ?", id) !== null;
  }

  hasParticipant(clientId: string): boolean {
    return (
      this.#first("SELECT 1 AS found FROM participants WHERE client_id = ?", clientId) !== null
    );
  }

  countParticipants(): number {
    return this.#first<{ n: number }>("SELECT COUNT(*) AS n FROM participants")?.n ?? 0;
  }

  insertParticipant(clientId: string, joinedAt: number): void {
    this.#run(
      "INSERT OR IGNORE INTO participants (client_id, joined_at) VALUES (?, ?)",
      clientId,
      joinedAt,
    );
  }

  isReady(clientId: string): boolean {
    const row = this.#first<{ ready: number }>(
      "SELECT ready FROM participants WHERE client_id = ?",
      clientId,
    );
    return row?.ready === 1;
  }

  listReadyClientIds(): string[] {
    return this.#all<{ client_id: string }>(
      "SELECT client_id FROM participants WHERE ready = 1",
    ).map((row) => row.client_id);
  }

  setReady(clientId: string, ready: boolean): void {
    this.#run("UPDATE participants SET ready = ? WHERE client_id = ?", ready ? 1 : 0, clientId);
  }

  resetAllReady(): void {
    this.#run("UPDATE participants SET ready = 0");
  }

  listItems(): Item[] {
    return this.#all<ItemRow>(`SELECT * FROM items ${ITEM_ORDER}`).map(toItem);
  }

  listItemsByClient(clientId: string): Item[] {
    return this.#all<ItemRow>(
      `SELECT * FROM items WHERE client_id = ? ${ITEM_ORDER}`,
      clientId,
    ).map(toItem);
  }

  listItemsInGroup(groupId: string): Item[] {
    return this.#all<ItemRow>(`SELECT * FROM items WHERE group_id = ? ${ITEM_ORDER}`, groupId).map(
      toItem,
    );
  }

  getItem(id: string): Item | null {
    const row = this.#first<ItemRow>("SELECT * FROM items WHERE id = ?", id);
    return row ? toItem(row) : null;
  }

  countItemsByClient(clientId: string): number {
    return (
      this.#first<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE client_id = ?", clientId)
        ?.n ?? 0
    );
  }

  countItemsInGroup(groupId: string): number {
    return (
      this.#first<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE group_id = ?", groupId)
        ?.n ?? 0
    );
  }

  countItemsByCategory(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of this.#all<{ id: string; n: number }>(
      `SELECT c.id AS id, COUNT(i.id) AS n FROM categories c
       LEFT JOIN items i ON i.category_id = c.id GROUP BY c.id`,
    )) {
      counts[row.id] = row.n;
    }
    return counts;
  }

  insertItem(item: Item): void {
    this.#run(
      `INSERT INTO items (id, client_id, category_id, group_id, text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      item.id,
      item.clientId,
      item.categoryId,
      item.groupId,
      item.text,
      item.createdAt,
      item.updatedAt,
    );
  }

  updateItemText(id: string, text: string, updatedAt: number): void {
    this.#run("UPDATE items SET text = ?, updated_at = ? WHERE id = ?", text, updatedAt, id);
  }

  deleteItem(id: string): void {
    this.#run("DELETE FROM items WHERE id = ?", id);
  }

  moveItem(id: string, groupId: string): void {
    this.#run("UPDATE items SET group_id = ? WHERE id = ?", groupId, id);
  }

  listGroups(): Group[] {
    return this.#all<GroupRow>("SELECT * FROM groups ORDER BY created_at, id").map(toGroup);
  }

  getGroup(id: string): Group | null {
    const row = this.#first<GroupRow>("SELECT * FROM groups WHERE id = ?", id);
    return row ? toGroup(row) : null;
  }

  insertGroup(group: Group): void {
    this.#run(
      "INSERT INTO groups (id, category_id, title, created_at) VALUES (?, ?, ?, ?)",
      group.id,
      group.categoryId,
      group.title,
      group.createdAt,
    );
  }

  setGroupTitle(id: string, title: string | null): void {
    this.#run("UPDATE groups SET title = ? WHERE id = ?", title, id);
  }

  deleteGroup(id: string): void {
    this.#run("DELETE FROM groups WHERE id = ?", id);
  }

  getVote(clientId: string, groupId: string): number {
    return (
      this.#first<{ count: number }>(
        "SELECT count FROM votes WHERE client_id = ? AND group_id = ?",
        clientId,
        groupId,
      )?.count ?? 0
    );
  }

  setVote(clientId: string, groupId: string, count: number): void {
    if (count <= 0) {
      this.#run("DELETE FROM votes WHERE client_id = ? AND group_id = ?", clientId, groupId);
      return;
    }
    this.#run(
      `INSERT INTO votes (client_id, group_id, count) VALUES (?, ?, ?)
       ON CONFLICT (client_id, group_id) DO UPDATE SET count = excluded.count`,
      clientId,
      groupId,
      count,
    );
  }

  votesUsedBy(clientId: string): number {
    return (
      this.#first<{ n: number }>(
        "SELECT COALESCE(SUM(count), 0) AS n FROM votes WHERE client_id = ?",
        clientId,
      )?.n ?? 0
    );
  }

  votesBy(clientId: string): Record<string, number> {
    const votes: Record<string, number> = {};
    for (const row of this.#all<{ group_id: string; count: number }>(
      "SELECT group_id, count FROM votes WHERE client_id = ?",
      clientId,
    )) {
      votes[row.group_id] = row.count;
    }
    return votes;
  }

  voteTotals(): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const row of this.#all<{ id: string; n: number }>(
      `SELECT g.id AS id, COALESCE(SUM(v.count), 0) AS n FROM groups g
       LEFT JOIN votes v ON v.group_id = g.id GROUP BY g.id`,
    )) {
      totals[row.id] = row.n;
    }
    return totals;
  }

  replaceDiscussOrder(groupIds: readonly string[]): void {
    this.#run("DELETE FROM discuss_order");
    groupIds.forEach((groupId, position) => {
      this.#run(
        "INSERT INTO discuss_order (group_id, position, status) VALUES (?, ?, 'pending')",
        groupId,
        position,
      );
    });
  }

  listDiscussOrder(): DiscussEntry[] {
    return this.#all<{ group_id: string; position: number; status: string }>(
      "SELECT group_id, position, status FROM discuss_order ORDER BY position",
    ).map((row) => ({
      groupId: row.group_id,
      position: row.position,
      status: row.status as DiscussStatus,
    }));
  }

  setDiscussStatus(position: number, status: DiscussStatus): void {
    this.#run("UPDATE discuss_order SET status = ? WHERE position = ?", status, position);
  }

  listComments(): Comment[] {
    return this.#all<CommentRow>("SELECT * FROM comments ORDER BY created_at, id").map(toComment);
  }

  getComment(id: string): Comment | null {
    const row = this.#first<CommentRow>("SELECT * FROM comments WHERE id = ?", id);
    return row ? toComment(row) : null;
  }

  insertComment(comment: Comment): void {
    this.#run(
      `INSERT INTO comments (id, group_id, client_id, text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      comment.id,
      comment.groupId,
      comment.clientId,
      comment.text,
      comment.createdAt,
      comment.updatedAt,
    );
  }

  updateCommentText(id: string, text: string, updatedAt: number): void {
    this.#run("UPDATE comments SET text = ?, updated_at = ? WHERE id = ?", text, updatedAt, id);
  }

  deleteComment(id: string): void {
    this.#run("DELETE FROM comments WHERE id = ?", id);
  }

  listActions(): Action[] {
    return this.#all<ActionRow>("SELECT * FROM actions ORDER BY created_at, id").map(toAction);
  }

  getAction(id: string): Action | null {
    const row = this.#first<ActionRow>("SELECT * FROM actions WHERE id = ?", id);
    return row ? toAction(row) : null;
  }

  insertAction(action: Action): void {
    this.#run(
      `INSERT INTO actions (id, group_id, client_id, text, assignee, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      action.id,
      action.groupId,
      action.clientId,
      action.text,
      action.assignee,
      action.createdAt,
      action.updatedAt,
    );
  }

  updateAction(id: string, text: string, assignee: string | null, updatedAt: number): void {
    this.#run(
      "UPDATE actions SET text = ?, assignee = ?, updated_at = ? WHERE id = ?",
      text,
      assignee,
      updatedAt,
      id,
    );
  }

  deleteAction(id: string): void {
    this.#run("DELETE FROM actions WHERE id = ?", id);
  }
}
