# Retro App Implementation Plan

This plan implements `SPEC.md`.
It is written to be handed to implementation agents, one workstream at a time.
Read `SPEC.md` first, then section 1 of this plan, which lists where this plan deliberately overrides the spec.
Where the two disagree, this plan wins.

## 1. Overrides to SPEC.md

These were decided after the spec was written.

1. **`clientId` is sent in a `hello` message**, not in the WebSocket query string, so the credential stays out of URLs and access logs. The socket URL is `/ws/:code`.
2. **The timer is available in every phase except Done**, not only Write and Vote.
3. **Comments and action items can be edited and deleted by their author.** The server keeps a private author map for them, like items.

All other open questions are resolved in section 11.

## 2. Guiding decisions

- Single npm package, single deployable Worker. No monorepo tooling.
- `@cloudflare/vite-plugin` runs the Worker, the Durable Object, and the Preact frontend under one `vite dev`, and builds both for `wrangler deploy`.
- One shared TypeScript module (`src/shared`) is the canonical source for the wire protocol, limits, room code alphabet, and default categories. Server and client both import it. Nothing is duplicated.
- The Durable Object (DO) stores everything in SQLite tables. No in-memory state is authoritative, so hibernation is always safe.
- Command handlers are synchronous (DO SQLite calls are synchronous). There is no `await` between reading and writing state, so every intent is atomic without locks. Concurrent grouping resolves as last write wins in arrival order.
- Visibility filtering lives in exactly one module (`views.ts`). Every byte sent to a client passes through it. This is the main privacy boundary and gets the heaviest testing.
- Phase transitions resend a full snapshot to every client instead of patching. Visibility rules change radically between phases, and a snapshot is the simplest correct answer.
- Client intents are idempotency-guarded where a double click would cause harm (`advance` carries the expected current phase, `next`/`prev`/`skip` carry the expected index).
- The client is not optimistic, with one exception: grouping drags apply locally at once and reconcile with the server, because a card snapping back after a drop feels broken.
- All user content is rendered as plain text. `dangerouslySetInnerHTML` is banned by lint rule.

## 3. Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Cloudflare Workers, SQLite-backed Durable Objects, Workers Assets |
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) |
| Frontend | Preact, `@preact/signals`, `preact-iso` (router), Vite |
| Drag and drop | `@dnd-kit/core` via `preact/compat` (W7 verifies it works; fallback is a small pointer-events implementation) |
| Dev/build | `vite` + `@cloudflare/vite-plugin`, `wrangler` |
| Validation | `zod` (v4) for client-to-server messages and HTTP bodies |
| Lint/format | Biome |
| Unit tests | Vitest |
| Worker/DO tests | Vitest + `@cloudflare/vitest-pool-workers` |
| E2E | Playwright (Chromium), multiple browser contexts per test |
| CI | GitHub Actions |

Agents must check current docs (context7) for `@cloudflare/vite-plugin`, `@cloudflare/vitest-pool-workers`, the Workers Rate Limiting binding, the WebSocket Hibernation API, and `@dnd-kit` before writing code against them, since these APIs move quickly.

## 4. Repository layout

```
retro/
  SPEC.md
  PLAN.md
  package.json
  tsconfig.json              # references client/worker/shared configs
  biome.json
  vite.config.ts
  vitest.config.ts           # unit (shared + client)
  vitest.workers.config.ts   # worker/DO integration
  playwright.config.ts
  wrangler.jsonc
  index.html
  src/
    shared/
      constants.ts           # limits, alphabet, default categories, close codes
      roomCode.ts            # generateRoomCode, isValidRoomCode
      protocol.ts            # wire types + zod schemas for client intents
    worker/
      index.ts               # fetch router: /api/*, /ws/*, else assets
      env.ts                 # Env interface
      http.ts                # json helpers, error responses
      room/
        RoomDurableObject.ts # DO class: wiring only (ws lifecycle, alarm, RPC)
        schema.ts            # SQL DDL + migrations via PRAGMA user_version
        store.ts             # RoomStore: typed reads/writes over ctx.storage.sql
        commands.ts          # intent handlers -> Change[] or CommandError
        views.ts             # snapshot(viewer), project(change, viewer)
        rateLimit.ts         # per-socket token bucket
        discussOrder.ts      # sort rule for discuss phase
    client/
      main.tsx
      app.tsx                # router
      styles/                # tokens.css, global.css
      lib/
        clientId.ts
        api.ts               # createRoom, roomExists
        connection.ts        # RoomConnection: ws, hello, reconnect, reqId, send
        clock.ts             # server clock offset
        markdown.ts          # export generator (pure)
        beep.ts              # WebAudio cue
      state/
        roomState.ts         # RoomState type + applyServerMessage reducer (pure)
        optimistic.ts        # pending grouping ops overlay (pure)
        roomStore.ts         # signals wrapper + intent senders
      pages/
        Home.tsx
        Room.tsx
        RoomNotFound.tsx
      components/
        Header.tsx           # code, copy link, expiry, participant count
        PhaseBar.tsx
        OwnerControls.tsx
        Timer.tsx
        Board.tsx            # category columns, shared by group/vote/done views
        CategoryColumn.tsx
        ItemCard.tsx
        GroupCard.tsx        # stacked items, editable title, drag source/target
        GroupWithMenu.tsx    # keyboard/touch alternative to dragging
        ItemComposer.tsx
        VoteBudget.tsx
        DiscussPanel.tsx
        CommentList.tsx
        ActionList.tsx
        ExportPanel.tsx
  test/
    worker/                  # DO integration tests
    e2e/                     # Playwright specs
```

## 5. Shared contracts (`src/shared`)

This section is the contract between server and client workstreams.
It must be implemented first and changed only deliberately.

### 5.1 Constants

```ts
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export const LIMITS = {
  itemTextMax: 280,
  groupTitleMax: 280,
  commentTextMax: 500,
  actionTextMax: 280,
  assigneeMax: 60,
  itemsPerClient: 30,
  participantsPerRoom: 50,
  voteLimitDefault: 5,
  voteLimitMin: 1,
  voteLimitMax: 20,
  timerMinMs: 60_000,
  timerMaxMs: 60 * 60_000,
  socketBurst: 30,
  socketRefillPerSec: 10,
  createRoomPerIpPerMinute: 10,
} as const;

export const DEFAULT_CATEGORIES = [
  { id: "well", title: "What went well?" },
  { id: "less-well", title: "What went less well?" },
  { id: "try-next", title: "What do we want to try next?" },
  { id: "puzzles", title: "What puzzles us?" },
  { id: "shoutouts", title: "Shoutouts" },
] as const;

export const CloseCode = {
  BadRequest: 4000,
  Unauthenticated: 4001,
  NotFound: 4004,
  RateLimited: 4008,
  RoomFull: 4009,
  Expired: 4010,
} as const;
```

### 5.2 Room code

- `generateRoomCode()` uses `crypto.getRandomValues` with rejection sampling (no modulo bias).
- `isValidRoomCode(s)` checks length and alphabet, case-sensitive. The client upper-cases user input before validating.

### 5.3 Domain types

```ts
export type Phase = "write" | "group" | "vote" | "discuss" | "done";
export type Category = { id: string; title: string };
export type DiscussStatus = "pending" | "discussed" | "skipped";

export type TimerState =
  | { kind: "none" }
  | { kind: "running"; endsAt: number }
  | { kind: "paused"; remainingMs: number };

export type ItemView = {
  id: string;
  categoryId: string;      // category the item was written in
  groupId: string | null;  // null in write, always set from group onward
  text: string;
  mine?: true;             // write phase only, own items only
  createdAt: number;
};

export type GroupView = {
  id: string;
  categoryId: string;      // the group's current category (may differ from its items' original categories)
  title: string | null;    // null renders as the earliest item's text
  itemIds: string[];       // ordered by item createdAt
  createdAt: number;
};

export type CommentView = { id: string; groupId: string; text: string; mine: boolean; createdAt: number; updatedAt: number };
export type ActionView = {
  id: string; groupId: string; text: string; assignee: string | null;
  mine: boolean; createdAt: number; updatedAt: number;
};

export type Presence = { participantCount: number; connectedCount: number; readyCount: number };

export type DiscussState = {
  order: string[];                          // group ids
  currentIndex: number;
  status: Record<string, DiscussStatus>;
};

export type RoomSnapshot = {
  code: string;
  createdAt: number;
  expiresAt: number;
  serverNow: number;
  phase: Phase;
  categories: Category[];
  isOwner: boolean;
  presence: Presence;
  youReady: boolean;
  timer: TimerState;
  voteLimit: number;
  items: ItemView[];                         // write: own only; group+: all
  groups: GroupView[];                       // empty in write
  categoryCounts: Record<string, number>;    // all items per category, used in write
  myVotes: Record<string, number>;           // groupId -> count, vote+
  voteTotals: Record<string, number> | null; // groupId -> count, discuss+ only, else null
  discuss: DiscussState | null;              // discuss+ only
  comments: CommentView[];
  actions: ActionView[];
};
```

### 5.4 Client to server messages

Every message is JSON with a `type` and an optional `reqId: string` (client-generated, max 36 chars).
Zod schemas in `protocol.ts` are the single source of truth; TS types are inferred from them.
String fields are trimmed server-side, then checked for non-empty and max length.

The first message on every socket must be `hello`.
Any other message before a successful `hello` closes the socket with `4001`.

| type | payload | who | phases |
| --- | --- | --- | --- |
| `hello` | `clientId` (UUID) | any | any, first message only |
| `addItem` | `categoryId, text` | any | write |
| `editItem` | `itemId, text` | item author | write |
| `deleteItem` | `itemId` | item author | write |
| `setReady` | `ready: boolean` | any | write, group |
| `moveItemToGroup` | `itemId, groupId` | any | group |
| `mergeGroups` | `sourceGroupId, targetGroupId` | any | group |
| `ungroupItem` | `itemId` | any | group |
| `renameGroup` | `groupId, title` (empty string clears) | any | group |
| `vote` | `groupId` | any | vote |
| `unvote` | `groupId` | any | vote |
| `addComment` | `groupId, text` | any | discuss, `groupId` must be current |
| `editComment` | `commentId, text` | comment author | discuss |
| `deleteComment` | `commentId` | comment author | discuss |
| `addAction` | `groupId, text, assignee?` | any | discuss, `groupId` must be current |
| `editAction` | `actionId, text, assignee?` | action author | discuss |
| `deleteAction` | `actionId` | action author | discuss |
| `advance` | `from: Phase` | owner | write, group, vote, discuss; rejected as `stale` if `from` is not the current phase |
| `setVoteLimit` | `limit` | owner | write, group, vote |
| `setTimer` | `durationMs` | owner | all but done |
| `pauseTimer` | none | owner | all but done, timer running |
| `resumeTimer` | none | owner | all but done, timer paused |
| `addTimerMinute` | none | owner | all but done, timer running or paused |
| `clearTimer` | none | owner | all but done |
| `next` | `fromIndex` | owner | discuss |
| `prev` | `fromIndex` | owner | discuss |
| `skip` | `fromIndex` | owner | discuss |

### 5.5 Server to client messages

```ts
type ServerMessage =
  | { type: "snapshot"; room: RoomSnapshot }
  | { type: "ack"; reqId: string }
  | { type: "error"; code: ErrorCode; message: string; reqId?: string }
  | { type: "itemUpserted"; item: ItemView }
  | { type: "itemRemoved"; itemId: string }
  | { type: "groupUpserted"; group: GroupView }
  | { type: "groupRemoved"; groupId: string }
  | { type: "categoryCounts"; counts: Record<string, number> }
  | { type: "presence"; presence: Presence }
  | { type: "youReady"; ready: boolean }
  | { type: "myVotes"; votes: Record<string, number> }
  | { type: "voteLimit"; limit: number }
  | { type: "timer"; timer: TimerState; serverNow: number }
  | { type: "discussCursor"; currentIndex: number; status: Record<string, DiscussStatus> }
  | { type: "commentUpserted"; comment: CommentView }
  | { type: "commentRemoved"; commentId: string }
  | { type: "actionUpserted"; action: ActionView }
  | { type: "actionRemoved"; actionId: string };

type ErrorCode =
  | "invalid_message" | "forbidden" | "wrong_phase" | "not_found"
  | "too_long" | "empty" | "item_limit" | "vote_limit" | "stale" | "rate_limited";
```

Every accepted intent with a `reqId` gets an `ack` after its patches.
Every rejected intent gets an `error` with the same `reqId`, sent only to the sender.
`stale` means an idempotency guard (`from`, `fromIndex`) did not match; the client ignores it silently.
A grouping op that targets a group or item deleted by a concurrent op returns `not_found`; the client drops its optimistic op.

### 5.6 HTTP and WebSocket endpoints

| Route | Behavior |
| --- | --- |
| `POST /api/rooms` body `{ clientId }` | Per-IP rate limit, then create room. `201 { code }`, `429`, `400`. |
| `GET /api/rooms/:code` | `200 { exists: true }` or `404`. Used by the Home page join form. |
| `GET /ws/:code` | WebSocket upgrade, forwarded to the room DO. Identity arrives in `hello`. |
| anything else | Workers Assets with SPA fallback (`/r/ABC234` serves `index.html`). |

WebSocket rejections after accept use the close codes in 5.1.
The client treats `4004` and `4010` as terminal (show "room not found"), `4009` as terminal (show "room is full"), and everything else as reconnectable.

## 6. Server design

### 6.1 Worker entry (`src/worker/index.ts`)

- Validates room code format before touching any DO, so garbage requests never instantiate objects.
- `POST /api/rooms`: validate `clientId` as a UUID; rate limit keyed by `CF-Connecting-IP` using the Workers Rate Limiting binding (`CREATE_ROOM_LIMITER`, 10 per 60 s). Loop up to 5 times: generate code, `env.ROOMS.getByName(code)`, call RPC `init({ code, ownerClientId, now })`. `init` returns `"created"` or `"exists"`; `"exists"` means collision, so retry. Return `503` after 5 collisions.
- `GET /api/rooms/:code`: RPC `exists()`.
- `/ws/:code`: requires `Upgrade: websocket`, forwards the original request to `stub.fetch(request)`.

### 6.2 Durable Object class (`RoomDurableObject.ts`)

Wiring only; no business rules.

- Constructor: `ctx.blockConcurrencyWhile(() => migrate(ctx.storage.sql))`.
- RPC `init(...)`: if the `room` row exists and is not expired, return `"exists"`. Otherwise insert room row and default categories, `setAlarm(createdAt + ROOM_TTL_MS)`, return `"created"`.
- RPC `exists()`: room row present and `now < expiresAt`.
- `fetch(request)` (WebSocket upgrade):
  1. Create the `WebSocketPair`, `ctx.acceptWebSocket(server)`, `serializeAttachment({ clientId: null })`, and return `101` in every case, so the client always receives a close code instead of an opaque failure.
  2. If the room is missing or expired, close with `4004`.
- `webSocketMessage(ws, data)`:
  1. Rate-limit check. On overflow send `error: rate_limited` and drop; after 3 consecutive overflow windows close with `4008`.
  2. `JSON.parse` and zod-validate; failure sends `invalid_message`.
  3. If the attachment has no `clientId`: the message must be `hello`, else close `4001`. On `hello`, if `clientId` is not yet a participant and the room has 50 participants, close `4009`. Otherwise upsert participant, store `clientId` in the attachment, send `snapshot`, broadcast `presence`.
  4. If the attachment has a `clientId`: a second `hello` is `invalid_message`. Otherwise run `commands.handle(store, actor, intent, now)`, then `broadcast(changes)`, then `ack`.
- `webSocketClose` / `webSocketError`: broadcast updated `presence`.
- `alarm()`: close all sockets with `4010`, `ctx.storage.deleteAll()`. After this, the DO has no storage and `exists()` is false.
- `broadcast(changes)`: for each socket in `ctx.getWebSockets()` whose attachment has a `clientId`, build a `Viewer`, call `views.project(change, viewer)` per change, and send each non-null message. Unauthenticated sockets receive nothing. A `phaseChanged` change maps to a full `snapshot` for every viewer.

Per-socket rate limit buckets live in a `Map<WebSocket, Bucket>` in memory. Losing them on hibernation is acceptable; it only resets the bucket.

Use `ctx.setWebSocketAutoResponse` for a `"ping"`/`"pong"` keepalive so idle rooms do not wake the DO.

### 6.3 SQLite schema (`schema.ts`)

Migrations are an ordered array of SQL strings applied according to `PRAGMA user_version`.

```sql
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
CREATE TABLE participants (client_id TEXT PRIMARY KEY, joined_at INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0);
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
CREATE TABLE discuss_order (group_id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, status TEXT NOT NULL);
CREATE TABLE comments (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, client_id TEXT NOT NULL,
  text TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE actions (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, client_id TEXT NOT NULL,
  text TEXT NOT NULL, assignee TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
```

Every `client_id` column outside `participants` and `room` is a private author or voter map.
No code in `views.ts` may emit a `client_id`; it may only compare one with the viewer's own id.

### 6.4 Store (`store.ts`)

`RoomStore` wraps `SqlStorage` with typed, synchronous methods (`getRoom`, `listItems`, `listGroups`, `insertItem`, `moveItem`, `countItemsByClient`, `votesUsedBy`, etc.).
It maps snake_case rows to camelCase domain objects.
It contains no rules.

### 6.5 Commands (`commands.ts`)

```ts
type Actor = { clientId: string; isOwner: boolean };
type Change =
  | { kind: "phaseChanged" }
  | { kind: "itemUpserted"; itemId: string; authorId: string }
  | { kind: "itemRemoved"; itemId: string; authorId: string }
  | { kind: "groupUpserted"; groupId: string }
  | { kind: "groupRemoved"; groupId: string }
  | { kind: "categoryCountsChanged" }
  | { kind: "presenceChanged" }
  | { kind: "readyChanged"; clientId: string }
  | { kind: "votesChanged"; clientId: string }
  | { kind: "voteLimitChanged" }
  | { kind: "timerChanged" }
  | { kind: "discussCursorChanged" }
  | { kind: "commentUpserted"; commentId: string }
  | { kind: "commentRemoved"; commentId: string }
  | { kind: "actionUpserted"; actionId: string }
  | { kind: "actionRemoved"; actionId: string };

function handle(store: RoomStore, actor: Actor, intent: ClientIntent, now: number):
  { ok: true; changes: Change[] } | { ok: false; code: ErrorCode; message: string };
```

Changes are unfiltered domain facts; they carry ids, not payloads, and may reference authors because they never leave the server.
`views.project` turns each change into a filtered message per viewer by re-reading from the store.

Rules (beyond the table in 5.4):

- `addItem`: category exists, client has fewer than 30 items. All ids are `crypto.randomUUID()`.
- **Grouping invariant**: from the group phase onward, every item has exactly one group and every group has at least one item. Every grouping command must leave this true; a command that would empty a group deletes that group in the same handler.
- `advance write -> group`: clear timer, reset all `ready` flags, create one group per item (group category = item category, title null).
- `moveItemToGroup`: no-op if the item is already in that group. Move the item, delete the source group if now empty. The item keeps its original `category_id`; it is displayed under the target group's category.
- `mergeGroups`: move every item of the source into the target, delete the source. Target keeps its own title and category. No-op if source equals target.
- `ungroupItem`: no-op if the item is alone in its group. Otherwise create a new group (category = the item's original category, title null) and move the item into it.
- `renameGroup`: empty string sets title to null.
- `advance group -> vote`: clear timer, reset `ready`.
- `vote`: the sum of the voter's votes must be below `voteLimit`. Lowering `voteLimit` below someone's usage keeps existing votes and blocks new ones.
- `unvote`: decrement; delete the row at zero.
- `advance vote -> discuss`: clear timer, compute `discuss_order` via `discussOrder.ts`, set `discuss_index = 0`, mark position 0 `discussed`.
- `next` / `prev`: clamp to bounds (empty change list at the ends). Arriving at a group always marks it `discussed`, including a previously skipped one. The timer is not touched.
- `skip`: mark the current group `skipped`, then move to the next group (which becomes `discussed`). Skipping the last group marks it `skipped` and leaves the cursor in place.
- `advance discuss -> done`: clear timer.
- Timer: `setTimer` sets `endsAt = now + durationMs`. `pauseTimer` stores `remainingMs = max(0, endsAt - now)`. `resumeTimer` sets `endsAt = now + remainingMs`. `addTimerMinute` adds 60 s to whichever field is set.

### 6.6 Discuss order (`discussOrder.ts`)

Sort all groups by total votes descending, then the group's category position ascending, then the earliest `createdAt` among the group's items ascending, then group id.
Groups with zero votes are included.
Pure function, unit-tested.

### 6.7 Views (`views.ts`)

```ts
type Viewer = { clientId: string; isOwner: boolean };
function snapshot(store: RoomStore, viewer: Viewer, now: number): RoomSnapshot;
function project(store: RoomStore, change: Change, viewer: Viewer, now: number): ServerMessage | null;
```

Visibility rules, enforced here and nowhere else:

| Data | write | group | vote | discuss / done |
| --- | --- | --- | --- | --- |
| Own items | yes | yes | yes | yes |
| Others' items | no (counts only) | yes | yes | yes |
| Item `mine` flag | own items | never | never | never |
| Groups | n/a | yes | yes | yes |
| Own votes | n/a | n/a | yes | yes |
| Vote totals | no | no | no | yes |
| Comment/action `mine` flag | n/a | n/a | n/a | own only |
| Others' per-person votes | never | never | never | never |
| Authorship of anything not your own | never | never | never | never |

Projection rules:

- `itemUpserted` / `itemRemoved` in write phase: only the author receives it. Everyone receives `categoryCounts` via the accompanying `categoryCountsChanged`.
- `itemUpserted` / `groupUpserted` / `groupRemoved` in group phase: everyone receives them.
- `readyChanged`: the actor receives `youReady`; everyone receives `presence` via `presenceChanged`.
- `votesChanged`: only that client receives `myVotes`.
- `commentUpserted` / `actionUpserted`: everyone receives it, with `mine` computed per viewer.
- `phaseChanged`: every viewer receives a full `snapshot`.

## 7. Client design

### 7.1 Identity and routing

- `clientId.ts`: read `localStorage["retro.clientId"]`, else generate `crypto.randomUUID()` and store it. Fall back to an in-memory id if storage throws.
- Routes: `/` is Home, `/r/:code` is Room, anything else redirects to `/`.

### 7.2 Home page

- "Create room" button: `POST /api/rooms`, then navigate to `/r/:code`.
- "Join" form: upper-case and validate the code, `GET /api/rooms/:code`, navigate or show "room not found" inline.
- Show the `429` case clearly ("Too many rooms created, try again in a minute").

### 7.3 Connection (`connection.ts`)

- `RoomConnection` owns one WebSocket to `/ws/:code` (use `wss:` on https) and sends `hello` immediately on open.
- Reconnects with exponential backoff and jitter (500 ms to 10 s) on non-terminal closes, and immediately on `online` and `visibilitychange` to visible.
- Sends `"ping"` every 30 s to keep intermediaries from dropping the socket.
- `send(intent)` assigns a `reqId` and returns a promise resolved on `ack` and rejected on `error`, with a 10 s timeout. Intents sent while disconnected are rejected immediately; the UI disables inputs while disconnected.

### 7.4 State (`roomState.ts`, `optimistic.ts`, `roomStore.ts`)

- `applyServerMessage(state, msg): RoomState` is a pure reducer. `snapshot` replaces state wholesale. Unit-tested per message type.
- `optimistic.ts`: a list of pending grouping ops keyed by `reqId`. The rendered state is `applyPendingOps(serverState, pending)`, a pure function that reuses the same grouping semantics as the server (moving an item, merging, ungrouping). An op is removed on its `ack` or `error`, and the whole list is cleared on `snapshot`. No other intent is optimistic.
- `roomStore.ts` holds `signal<RoomState | null>`, the pending list, and connection status, and exposes typed intent functions (`addItem(categoryId, text)` etc.).
- Composers clear on send and restore the text if the promise rejects.
- `clock.ts`: `offset = serverNow - (sendTime + receiveTime) / 2`, recomputed on every `snapshot` and `timer` message. `serverNowEstimate() = Date.now() + offset`.

### 7.5 Room page by phase

Shared chrome on every phase: Header (room code, copy-link button, participant count, connection indicator, "expires in 5h 12m"), PhaseBar (write, group, vote, discuss, done with current highlighted), Timer when set, OwnerControls visible only when `isOwner` (advance button, timer controls, vote limit where allowed).

- **Write**: one column per category (grid on desktop, stacked on mobile). Each column shows the count of all items, the viewer's own items with inline edit and delete, and a composer with a live 280-character counter. Ready toggle for everyone. Owner sees "5/7 ready" (`readyCount/connectedCount`) and "Start grouping".
- **Group**: the Board with every group as a GroupCard under its category. Drag an item or a whole group onto another group or item to merge, including across columns. Drag an item out of a multi-item group onto empty column space to ungroup it. Every card also has a "Group with..." menu (searchable list of groups) and an "Ungroup" action for keyboard and touch users. Group titles edit inline; placeholder is the first item's text. Ready toggle and owner ready count as in Write. Owner sees "Start voting".
- **Vote**: the Board, read-only for grouping. Each group shows the viewer's own vote count with + and - buttons. VoteBudget shows "3 of 5 votes left". Owner sees "Start discussion".
- **Discuss**: focused current group with its title, items, category, vote total, comments, and action items, plus composers for both. Own comments and actions have edit and delete. A side list shows the full order with status markers. Owner sees previous, next, skip, and "Finish". Non-owners follow the cursor automatically. ExportPanel available.
- **Done**: read-only summary in discuss order with comments and actions. ExportPanel prominent.

Timer component renders `mm:ss` from `serverNowEstimate()` with a 250 ms interval. At zero it shows a "time's up" state and plays one short WebAudio beep (once per `endsAt` value, only if the page has had a user gesture). It never advances anything.

Accessibility: semantic buttons and labels, visible focus, `aria-live="polite"` for the discuss cursor, grouping results, and timer-up state; color is never the only signal; every drag operation has a non-drag equivalent.

### 7.6 Markdown export (`markdown.ts`)

Pure function `toMarkdown(state: RoomState): string`.
Format (matches `SPEC.md`):

```
# Retro: 2026-10-04
Room ABC234 · 7 participants

## Discussed
### 1. <group title> (8 votes) [What went less well?]
- Items:
  - <item text>
  - <item text>
- Comments:
  - ...
- Action items:
  - [ ] ... (assignee)

## Not discussed
- <group title> (2 votes) [What puzzles us?]
```

- Date is the room's `createdAt` as `YYYY-MM-DD` in the viewer's local time zone.
- Group title is the stored title, else the earliest item's text. The "Items" list appears only for groups with more than one item, or when the title differs from the single item's text.
- The bracketed category is the group's category.
- "Discussed" lists groups with status `discussed` in discuss order, numbered. "Not discussed" lists `pending` and `skipped` groups in discuss order.
- Empty comment or action sections render as `  - (none)`. Assignee suffix only when present.
- Escape leading `#`, `-`, `*`, `>`, and backticks in user text so content cannot restructure the document.

Download uses a `Blob` with filename `retro-ABC234-2026-10-04.md`. Copy uses `navigator.clipboard.writeText` with a visible confirmation.

## 8. Configuration

`wrangler.jsonc` sketch (verify keys against current docs):

```jsonc
{
  "name": "retro",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/ws/*"]
  },
  "durable_objects": {
    "bindings": [{ "name": "ROOMS", "class_name": "RoomDurableObject" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomDurableObject"] }],
  "ratelimits": [
    { "name": "CREATE_ROOM_LIMITER", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } }
  ]
}
```

`new_sqlite_classes` is required for SQLite-backed DOs on the free plan.

npm scripts: `dev`, `build`, `deploy` (`vite build && wrangler deploy`), `typecheck`, `lint`, `test` (unit), `test:workers`, `test:e2e`, `check` (all of the above except deploy).

## 9. Testing strategy

Every workstream ships with tests for behavior that is not obvious from reading the code.

### 9.1 Unit (Vitest)

- `roomCode`: alphabet and length; distribution sanity check.
- `discussOrder`: tie-break ordering.
- `applyServerMessage`: each message type on representative state.
- `applyPendingOps`: move, merge, ungroup on representative state, including ops whose target vanished.
- `markdown`: golden output for a full room fixture with single and multi-item groups; escaping of hostile text.
- `clock`: offset math.

### 9.2 Worker/DO integration (`@cloudflare/vitest-pool-workers`)

Drive real WebSockets against the real DO with a small test harness (`connect(code, clientId)` that sends `hello` and returns a message queue).

- Room lifecycle: create, exists, collision retry (stub generator), not-found close code, alarm deletes storage and closes with `4010` (`runDurableObjectAlarm`).
- Handshake: message before `hello` closes `4001`; second `hello` rejected; 51st distinct participant closes `4009`; known participant can rejoin a full room.
- Permissions: every owner-only intent rejected for non-owner with `forbidden`; author-only edits rejected for others; every intent rejected in wrong phases.
- Limits: 281-char item, 31st item, vote over limit, rate limit overflow.
- Ownership: reconnect with owner `clientId` regains owner controls.
- Idempotency: double `advance` with the same `from` advances once.
- Grouping: grouping invariant holds after every op; cross-category merge; ungroup restores original category; two clients issuing conflicting moves converge to the same state on both; op against a deleted group returns `not_found`.
- **Leak test (critical)**: scripted session with an owner and two participants through all five phases. Record every message each client receives. Assert that during write no client receives another client's item text or id; no item carries `mine` outside write; during vote no message contains vote totals or others' votes; comment and action `mine` is true only for the author; and no message in any phase contains any `clientId` (search serialized JSON for every participant's `clientId`, including the receiver's own).

### 9.3 E2E (Playwright)

Run against `vite dev` (worker and DO local via the Cloudflare plugin). Use separate browser contexts per user so each has its own localStorage.

1. Full retro: owner creates room, two participants join by code and by link, everyone writes, counts update live, others' items hidden, ready count shows on owner, grouping by drag across categories visible live to all, vote with limit enforcement, discuss navigation followed by all clients, comment and action added, edited, and deleted, done, export copied and downloaded content matches expected structure.
2. Grouping with keyboard only via "Group with..." and "Ungroup".
3. Owner reload keeps ownership; a participant reload keeps own items.
4. Nonexistent code shows "room not found" both from Home and from a direct `/r/` URL.
5. Timer: set, pause, add minute, reach zero (short duration via clock control), "time's up" shown, phase not advanced. Repeat once in Discuss to confirm next/prev leave it running.
6. Late joiner during discuss sees the current group.
7. Mobile viewport smoke test for each phase with screenshots reviewed for layout quality, including touch grouping via the menu.

## 10. Workstreams and handoff order

Each workstream is sized for one agent.
Dependencies must be merged before dependents start.
Each workstream is done only when `npm run check` passes and its listed tests exist.

```
W1 Scaffold
  └─ W2 Shared contracts
       ├─ W3 Server domain (store, commands, views) ─┐
       │    └─ W4 DO wiring + Worker routes ─────────┤
       └─ W5 Client foundation ──────────────────────┤
            ├─ W6 Home + Room shell + Write ─────────┤
            ├─ W7 Group phase ───────────────────────┤  (W6-W9 parallel after W5)
            ├─ W8 Vote + Discuss + Done ─────────────┤
            └─ W9 Timer + Export ────────────────────┤
                                                     └─ W10 E2E + CI + deploy docs
```

W3 and W5 can run in parallel once W2 lands.
W6 through W9 can run in parallel once W5 lands; they need W4 only for manual testing, so start them against W4's branch if it is not yet merged.
W7 and W8 both render the Board; W7 owns `Board.tsx`, `CategoryColumn.tsx`, and `GroupCard.tsx`, and W8 consumes them. If W8 starts first, it builds a minimal read-only Board that W7 then extends.

### W1 Scaffold

- `package.json`, TS configs (separate `tsconfig` for worker types vs DOM), Biome (with a rule banning `dangerouslySetInnerHTML`), Vite with `@cloudflare/vite-plugin` and Preact preset, `wrangler.jsonc`, both Vitest configs, Playwright config, `index.html`.
- Stub Worker returning `404` for `/api/*`, stub DO class, Preact app rendering "Retro".
- Acceptance: `npm run dev` serves the app and the stub API; `npm run check` passes with one trivial test per runner.

### W2 Shared contracts

- Implement section 5 exactly: `constants.ts`, `roomCode.ts`, `protocol.ts` with zod schemas for every client intent and exported TS types for every server message.
- Acceptance: unit tests for `roomCode` and schema rejection of over-length and unknown messages.

### W3 Server domain

- `schema.ts`, `store.ts`, `commands.ts`, `views.ts`, `discussOrder.ts`, `rateLimit.ts` per section 6.
- Test through direct calls on a DO-hosted `SqlStorage` in the workers pool.
- Acceptance: command rule tests (including the grouping invariant), visibility tests for `snapshot` and `project` in every phase, `discussOrder` tests.

### W4 DO wiring and Worker routes

- `RoomDurableObject.ts` and `worker/index.ts` per sections 6.1 and 6.2, including the `hello` handshake, hibernation, auto-response ping, alarm, rate limits, close codes.
- Acceptance: integration tests in 9.2, including the leak test.

### W5 Client foundation

- `clientId.ts`, `api.ts`, `connection.ts`, `clock.ts`, `roomState.ts`, `optimistic.ts`, `roomStore.ts`, router, design tokens (light and dark), base layout, connection indicator.
- Acceptance: reducer, optimistic overlay, and clock unit tests; manual check that the Room page connects and receives a snapshot.

### W6 Home, Room shell, Write phase

- Home page, RoomNotFound page, Header, PhaseBar, OwnerControls shell (advance, vote limit), ready toggle and count, Write phase UI.
- Acceptance: two browser windows can create, join, write, see live counts, toggle ready, and the owner can advance.

### W7 Group phase

- Verify `@dnd-kit/core` under `preact/compat` (bundle size and touch behavior); fall back to a pointer-events implementation if it is a poor fit.
- Board, CategoryColumn, GroupCard (drag source and drop target, inline title edit), GroupWithMenu, ungroup, optimistic grouping via `optimistic.ts`.
- Acceptance: two windows grouping concurrently converge; keyboard-only grouping works; drag on a touch-emulated viewport works or the menu path is clearly offered.

### W8 Vote, Discuss, Done phases

- VoteBudget and vote controls on the Board, DiscussPanel with cursor, comments and actions with author edit and delete, owner navigation, Done view.
- Acceptance: a full flow works in two browser windows through to Done.

### W9 Timer and Export

- Timer component and owner timer controls in every phase but Done, beep, `markdown.ts`, ExportPanel.
- Acceptance: markdown golden test; timer correct across two windows with a skewed local clock (override `Date.now` in one window).

### W10 E2E, CI, deploy

- Playwright specs in 9.3.
- GitHub Actions workflow running `npm run check` and Playwright on pull requests.
- README section: local dev, deploy with `wrangler deploy`, free-plan notes.
- Acceptance: CI green; one manual deploy to a `workers.dev` subdomain verified end to end by the user.

## 11. Resolved decisions

These fill gaps in `SPEC.md` and were confirmed with the user.

1. **Participant cap** counts distinct `clientId`s that have ever joined, not concurrent sockets. A known participant can always rejoin.
2. **Ready denominator** is connected participants (distinct `clientId`s with an open socket), including the owner. Ready flags reset on every phase advance.
3. **Timer** is available in Write, Group, Vote, and Discuss. It is cleared on every phase advance and untouched by discuss navigation. `resumeTimer` is added. Duration range is 1 to 60 minutes.
4. **Discuss statuses**: arriving at a group marks it discussed; skip marks it skipped and moves on. Export "Not discussed" covers pending and skipped groups.
5. **Vote limit** is configurable until Discuss starts, range 1 to 20.
6. **Discuss order tie-break**: group category order, then earliest item creation time.
7. **Comments and action items** can be edited and deleted by their author during Discuss. Comment max 500 characters, action max 280, assignee max 60.
8. **Item `mine` flag** is shown to the author during Write only. From Group onward, items are fully anonymous to everyone, including their author.
9. **Grouping**: dedicated Group phase; anyone can group; groups may span categories and take the target's category; a group is the unit of voting, discussion, and export; optional title editable by anyone; drag and drop with a "Group with..." menu alternative; concurrent edits resolve as last write wins in server arrival order, with no undo.
10. **Room creation rate limit** is 10 per minute per IP.
11. **Socket rate limit** is a token bucket of 30 burst, 10 per second refill.
12. **Optimistic UI** only for grouping ops.
13. **`clientId` transport** is the first WebSocket message (`hello`). It is a bearer credential and is never included in any server message.

## 12. Out of scope

Everything listed under "Out of scope for v1" in `SPEC.md`, plus the secret owner link follow-up.
Agents that notice something worth doing outside their workstream should note it in their PR description rather than implementing it.
