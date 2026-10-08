import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Board } from "../components/Board";
import { GroupCard, GroupTitle } from "../components/GroupCard";
import {
  type BoardColumn,
  type BoardGroup,
  buildBoard,
  type DragSource,
  decodeDropTarget,
  dropIntent,
  encodeDropTarget,
  hasGroupHeading,
} from "../lib/board";
import { createPointerDrag, DROP_ATTRIBUTE } from "../lib/pointerDrag";
import type { GroupingIntent } from "../state/optimistic";
import { useRoomStore } from "../state/roomContext";
import type { RoomState } from "../state/roomState";
import type { RoomStore } from "../state/roomStore";
import styles from "./GroupPhase.module.css";

type DragHandlers = {
  "data-draggable"?: "true";
  onPointerDown?: (event: PointerEvent & { currentTarget: HTMLElement }) => void;
};

function quote(text: string): string {
  return `“${text}”`;
}

function findGroup(columns: readonly BoardColumn[], groupId: string): BoardGroup | undefined {
  for (const column of columns) {
    const found = column.groups.find((entry) => entry.group.id === groupId);
    if (found) return found;
  }
  return undefined;
}

function announcementFor(intent: GroupingIntent, room: RoomState): string {
  const columns = buildBoard(room);
  const label = (groupId: string) => quote(findGroup(columns, groupId)?.label ?? "group");
  const text = (itemId: string) =>
    quote(room.items.find((entry) => entry.id === itemId)?.text ?? "item");
  switch (intent.type) {
    case "mergeGroups":
      return `Grouped ${label(intent.sourceGroupId)} with ${label(intent.targetGroupId)}.`;
    case "moveItemToGroup":
      return `Moved ${text(intent.itemId)} to ${label(intent.groupId)}.`;
    case "ungroupItem":
      return `Ungrouped ${text(intent.itemId)}.`;
  }
}

function send(store: RoomStore, intent: GroupingIntent) {
  switch (intent.type) {
    case "mergeGroups":
      return store.mergeGroups(intent.sourceGroupId, intent.targetGroupId);
    case "moveItemToGroup":
      return store.moveItemToGroup(intent.itemId, intent.groupId);
    case "ungroupItem":
      return store.ungroupItem(intent.itemId);
  }
}

export function GroupPhase() {
  const store = useRoomStore();
  const room = store.room.value;
  const live = store.isLive.value;
  const columns = useMemo(() => (room ? buildBoard(room) : []), [room]);
  const [announcement, setAnnouncement] = useState("");

  const roomRef = useRef(room);
  roomRef.current = room;

  const perform = (intent: GroupingIntent) => {
    const current = roomRef.current;
    if (!current) return;
    setAnnouncement(announcementFor(intent, current));
    void send(store, intent);
  };
  const performRef = useRef(perform);
  performRef.current = perform;

  const drag = useMemo(
    () =>
      createPointerDrag<DragSource>({
        ghostClass: styles.ghost ?? "",
        inheritedProperties: ["--category-color", "--category-color-subtle"],
        canDrop: (source, key) => {
          const target = decodeDropTarget(key);
          return !!(target && roomRef.current && dropIntent(roomRef.current, source, target));
        },
        onDrop: (source, key) => {
          const target = decodeDropTarget(key);
          const intent = target && roomRef.current && dropIntent(roomRef.current, source, target);
          if (intent) performRef.current(intent);
        },
      }),
    [],
  );
  useEffect(() => drag.cancel, [drag]);
  useEffect(() => {
    if (!live) drag.cancel();
  }, [live, drag]);

  if (!room) return null;

  const dragHandlers = (source: DragSource, enabled: boolean): DragHandlers =>
    enabled
      ? {
          "data-draggable": "true",
          onPointerDown: (event) => drag.begin(event, source, event.currentTarget),
        }
      : {};

  const renderGroup = (entry: BoardGroup) => {
    const { group, items, pending } = entry;
    const multi = items.length > 1;
    const canGroup = live && !pending;
    return (
      <GroupCard
        group={entry}
        class={styles.card}
        {...{
          [DROP_ATTRIBUTE]: pending
            ? undefined
            : encodeDropTarget({ kind: "group", groupId: group.id }),
        }}
        {...dragHandlers({ kind: "group", groupId: group.id }, canGroup)}
        heading={
          hasGroupHeading(entry) ? (
            <GroupTitle
              group={entry}
              disabled={!canGroup}
              onRename={(title) => void store.renameGroup(group.id, title)}
            />
          ) : undefined
        }
        itemProps={
          multi ? (item) => dragHandlers({ kind: "item", itemId: item.id }, live) : undefined
        }
      />
    );
  };

  return (
    <section class={styles.phase} aria-labelledby="group-phase-heading">
      <div class={styles.intro}>
        <h2 id="group-phase-heading" class={styles.heading}>
          Group similar items
        </h2>
        <p class={styles.hint}>
          <span class={styles.hintFine}>Drag a card onto another to group them</span>
          <span class={styles.hintCoarse}>Press and hold a card, then drag it onto another</span>.
          Drag an item out of a group onto its column to ungroup it.
        </p>
      </div>
      {room.items.length === 0 ? (
        <p class={styles.empty}>No items were written in this retro.</p>
      ) : (
        <Board
          columns={columns}
          renderGroup={renderGroup}
          columnDropKey={(column) =>
            encodeDropTarget({ kind: "column", categoryId: column.category.id })
          }
        />
      )}
      <p class="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
