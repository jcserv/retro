# Retro App Spec

## Goal

A very simple, rustpad-style web app for running team retros.
Deployable for $0.
No accounts.
A room is created or joined with a 6 character code.

## Stack

Cloudflare Workers with Durable Objects (SQLite-backed), static frontend served by Workers Assets.
One Durable Object per room, keyed by room code.
The Durable Object holds authoritative room state and fans out over WebSockets.
WebSocket Hibernation keeps idle rooms free.
A Durable Object alarm deletes the room at expiry.
Frontend is TypeScript with Preact and Vite.
No CRDT or OT is needed because there is no collaborative text editing.

## Roles and identity

On first visit the client generates a `clientId` (UUID) and stores it in localStorage.
The room creator's `clientId` is stored as the owner.
Reconnecting with the same `clientId` regains ownership.
Participants have no names.
Items are anonymous.
The server keeps a private item-to-client map so users can edit and delete their own items.
That map is never sent to any client.
Votes are tracked per `clientId` to enforce limits and are never exposed per person.
The owner is also a participant and can write and vote.

## Room code

6 characters from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
Collisions are checked at creation.
Room URL is `/r/ABC234`.
Joining a nonexistent or expired code shows "room not found".

## Categories

Default set, in order:

1. What went well?
2. What went less well?
3. What do we want to try next?
4. What puzzles us?
5. Shoutouts

Categories are a data-driven list on the room: `{ id, title }`.
The UI renders from that list, so presets can be added later without a rewrite.
v1 ships only the default set and has no category editing UI.

## Phases

The owner drives the state machine: `write -> group -> vote -> discuss -> done`.
Only the owner can advance.

### Write

Users add items to any category.
Users can edit and delete their own items.
Others' items are hidden.
Each user sees only their own items plus per-category counts.
The owner can set an optional timer.
Each user has a Ready toggle.
The owner sees a ready count such as "5/7 ready".
The owner can advance at any time regardless of ready state.

### Group

All items are revealed, shown by category.
Items are anonymous to everyone, including their author.
Anyone can group similar items.
See Grouping below.
The owner can set an optional timer.
Each user has a Ready toggle, and the owner sees the ready count.

### Vote

All groups are shown by category.
Votes are cast on groups.
An ungrouped item is a group of one.
Each user gets N votes, default 5, owner-configurable.
Multiple votes on one group are allowed.
Votes can be retracted.
Others' vote counts are hidden until the phase ends.
Each user sees only their own votes.
The owner can set an optional timer.

### Discuss

All groups are sorted by vote count, descending.
The owner steps next and previous, or jumps to any topic from the agenda.
Every client's view follows the current group.
The owner can skip groups.
Anyone can add comments and action items on the current group.
An action item has text, an optional free-text assignee, and an optional due date.
Comments and action items are shown in one column, comments first.
The author of a comment can convert it into an action item with the same text; the comment is removed.
A comment longer than the action item limit cannot be converted.

### Done

Read-only.
Markdown export is available.
The room remains until expiry.

## Reactions

Anyone can react to an item with any single emoji during Group, Vote and Discuss.
Grouped items keep their own reactions.
Each user can add a given emoji to an item once, and can remove their own reactions.
Reactions are anonymous: everyone sees each emoji's count and whether they reacted, never who.
Reactions are shown read-only in Done.

## Timer

The owner sets a duration.
The server stores `endsAt`.
Clients render the countdown locally using a server clock offset.
The owner can pause, add one minute, or clear.
The timer is a soft end.
It gives a visual and audio cue and never auto-advances.

## Grouping

Grouping happens in the dedicated Group phase, before any votes are cast.
Anyone can group items.
An item or a whole group is dragged onto another item or group to merge them.
On touch devices, a card is pressed and held before dragging.
Groups can span categories; a merged group takes the target's category.
An item is ungrouped by dragging it out of its group onto its original category.
A group has an optional title that anyone can edit.
While grouping, an untitled group shows an "Add a title" placeholder; elsewhere it shows its first item's text.
A group is the unit of voting, discussion, and export.
Concurrent grouping changes resolve as last write wins on the server.

## AI suggestions

The owner can ask for suggested groups and titles during the Group phase.
Suggestions come from Cloudflare Workers AI through a Worker binding, so the feature stays inside the $0 deployment.
Suggestions are a proposal only.
Nothing changes on the board until the owner accepts a suggestion.

### What gets suggested

The model sees every item in the room as either ungrouped or as part of an existing group.
Because every item starts in a group of its own, an ungrouped item here means an item alone in an untitled group, and an existing group means a group with two or more items or a title.
It may propose new groups made of two or more ungrouped items.
It may propose adding ungrouped items to an existing group.
It may propose a title for any untitled group, existing or new.
It never splits, merges, or retitles groups that people already made and titled.
An item appears in at most one suggestion.

### Flow

The owner presses "Suggest groups" in the owner controls.
The button is disabled with a reason when the request is not allowed (see Abuse prevention).
While the request runs, the owner sees a pending state.
Other participants see nothing.
When it finishes, the owner sees a panel listing each suggested group: its title, the items it would contain, and Accept and Dismiss buttons.
An "Accept all" button applies every remaining suggestion.
Dismissing is local to the owner's view.
A new run replaces the previous suggestion set.
The latest suggestion set is stored in the room, so it survives the owner reloading the page.
It is deleted when the room leaves the Group phase.

### Applying a suggestion

Applying runs as one atomic server command, like any other grouping change.
The server revalidates against the current board, because people may have kept grouping while the model ran.
Items that were deleted or grouped since the run are dropped from the suggestion.
A suggested new group that is left with fewer than two items is not created and is reported as out of date.
A suggestion for an existing group that no longer exists is reported as out of date.
A suggested title is applied only if the target group is still untitled.
A new group takes the category held by most of its items, with ties going to the earliest category in the room's order.
Applied changes reach every participant through the normal group patches.

### Model contract

The model is a constant in `src/shared/constants.ts`, available on the Workers Free plan, and must support JSON schema output.
It is chosen by running fixture retros through candidate models and keeping the cheapest one that groups them acceptably.
Items and groups are sent with short positional ids (`1`, `g1`) instead of real ids.
The server maps them back.
The prompt marks all item text as untrusted data to group, never as instructions.
The response schema is `{ groups: [{ target: string | null, itemIds: number[], title: string | null }] }`.
The response is validated with zod.
Invalid entries are dropped one by one, and the rest of the response is kept.
A response cut off by `max_tokens` keeps its complete entries and drops the last one.
Suggested titles are trimmed, put on a single line, and capped at 60 characters.
A response with no valid entries shows "No suggestions for this board".
A request times out after 60 seconds and shows an error to the owner.

### Abuse prevention and rate limiting

The binding costs money only on the Workers Paid plan, where usage above the free 10,000 Neurons per day is billed.
On the Free plan, overuse makes requests fail.
Either way, the shared daily allocation must not be exhausted by one room or one person.
Limits, from narrowest to widest:

1. **Who and when.** Only the owner, only in the Group phase. Non-owner and wrong-phase requests are rejected like other owner-only intents.
2. **Input size.** The board needs at least two ungrouped items or one untitled group. Each item's text is cut to 120 characters before it is sent. A board with more than 200 items or 12,000 characters of item text after that cut is refused with "Too many items for suggestions". The model's output is capped with `max_tokens`.
3. **Per room.** One request in flight at a time. A 30 second cooldown between requests. At most 5 requests over the room's lifetime. The count and the in-flight marker live in the room's SQLite, so hibernation cannot reset them. An in-flight marker older than the timeout is treated as cleared.
4. **Per IP.** A Workers rate limiting binding, `AI_SUGGEST_LIMITER`, keyed by the owner's connecting IP, allows 5 requests per 60 seconds. The IP is captured at WebSocket upgrade and kept in the socket attachment. This stops one person from spending budget across many rooms they created.
5. **Global daily budget.** A singleton Durable Object, `AiBudget`, counts requests per UTC day across the whole deployment. A request reserves a slot before calling the model. Failed calls are not refunded. When the day's budget is spent, the button shows "AI suggestions are used up for today". The daily request cap is a constant, set so that the cap times the worst case Neurons per request stays at or below 8,000. That leaves 20% of the free allocation as headroom.
6. **Kill switch.** The `AI_SUGGESTIONS` variable is `on`, `off`, or `fake`. `off`, or a missing binding, hides the feature. `fake` uses a deterministic local suggester for dev and tests, so they never spend real Neurons. Clients learn whether the feature is available from the snapshot.

A request that hits a limit spends no Neurons and returns a specific error code and message to the owner.

### Privacy

Item text, group titles, and category titles are sent to Workers AI.
Authorship, votes, reactions, and `clientId`s are never sent.
Prompts and responses are not logged.
The first time an owner opens the feature in a room, the button's tooltip says that card text is sent to Cloudflare Workers AI.

## Lifecycle

A room lives 7 days from creation.
The expiry is fixed, not sliding.
A Durable Object alarm at `createdAt + 7d` deletes all storage and closes sockets.
The UI shows time remaining.
Late joiners are allowed in any phase.

## Markdown export

Generated client-side from room state.
Download and copy buttons.
Available to everyone once the retro is done.

Format:

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
  - [ ] ... (assignee, due YYYY-MM-DD)

## Not discussed
- <group title> (2 votes) [What puzzles us?]
```

## Protocol

One WebSocket per client at `/ws/:code?clientId=...`.
The server sends a full filtered snapshot on join, then patch events.
Client messages are intents such as `addItem`, `editItem`, `deleteItem`, `ready`, `addReaction`, `removeReaction`, `vote`, `unvote`, `comment`, `addAction`, `advance`, `setTimer`, `next`, `prev`, `goTo`, `suggestGroups`, `applySuggestions`.
`applySuggestions` carries the suggestion set id and the indexes to apply.
Suggestion events are sent only to the owner.
Owner-only intents from non-owners are rejected.
Snapshots and patches are filtered per client.
Others' items are hidden in Write.
Vote counts are hidden in Vote.

## Limits

Item max length 280 characters.
Max 30 items per client per room.
Max 50 participants per room.
Max 20 different reaction emojis per item.
Per-socket message rate limit.
Per-IP room creation rate limit.
AI suggestion limits are listed under AI suggestions.
All content is rendered as plain text.

## Out of scope for v1

Accounts.
Persistence beyond 7 days.
Custom category UI and presets.
Display names.
Owner transfer.
Internationalization.
AI suggestions outside the Group phase, such as summarizing discussion or drafting action items.
Applying suggestions without the owner reviewing them.
Letting non-owners request suggestions.
Bring-your-own API keys or other model providers.

## Assumed answers to earlier open questions

Override any of these.

1. Owner recovery is localStorage only.
2. Others' items are hidden during Write.
3. Five votes per person, multiple votes on one item allowed.
4. Grouping is in v1 as a dedicated phase.
5. The fifth category is covered by "What do we want to try next?".
6. Cloudflare plus TypeScript is acceptable.
7. Participants are nameless.
8. The owner can write and vote.

## Known risk

If the owner clears localStorage, they lose ownership and the room cannot be advanced.
A secret owner link is the likely follow-up.
