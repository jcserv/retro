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
Client messages are intents such as `addItem`, `editItem`, `deleteItem`, `ready`, `addReaction`, `removeReaction`, `vote`, `unvote`, `comment`, `addAction`, `advance`, `setTimer`, `next`, `prev`, `goTo`.
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
All content is rendered as plain text.

## Out of scope for v1

Accounts.
Persistence beyond 7 days.
Custom category UI and presets.
Display names.
Owner transfer.
Internationalization.

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
