import type { GroupView } from "../../shared/protocol";
import { copy } from "../copy";
import type { RoomState } from "../state/roomState";
import { boardGroupResolver, hasGroupHeading } from "./board";

export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s*\n\s*/g, " ")
    .replace(/[\\`]/g, "\\$&")
    .replace(/^([#>*+-])/, "\\$1")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

export function localDate(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function exportFileName(state: RoomState): string {
  return `retro-${state.code}-${localDate(state.createdAt)}.md`;
}

function byCreation<T extends { createdAt: number }>(entries: T[]): T[] {
  return entries.toSorted((a, b) => a.createdAt - b.createdAt);
}

function bulletList(lines: string[]): string[] {
  return lines.length > 0 ? lines.map((line) => `  - ${line}`) : [`  - ${copy.markdown.none}`];
}

export function toMarkdown(state: RoomState): string {
  const groups = new Map(state.groups.map((group) => [group.id, group]));
  const resolve = boardGroupResolver(state);
  const categoryTitle = new Map(state.categories.map((c) => [c.id, c.title]));
  const order = state.discuss?.order ?? state.groups.map((group) => group.id);
  const status = state.discuss?.status ?? {};

  const summary = (group: GroupView) => {
    const votes = state.voteTotals?.[group.id] ?? 0;
    const category = categoryTitle.get(group.categoryId) ?? group.categoryId;
    return `${escapeMarkdown(resolve(group).label)} (${copy.markdown.votes(votes)}) [${category}]`;
  };

  const ordered = order.flatMap((id) => {
    const group = groups.get(id);
    return group ? [group] : [];
  });
  const discussed = ordered.filter((group) => status[group.id] === "discussed");
  const notDiscussed = ordered.filter((group) => status[group.id] !== "discussed");

  const lines = [
    copy.markdown.title(localDate(state.createdAt)),
    copy.markdown.subtitle(state.code, state.presence.participantCount),
    "",
    copy.markdown.discussed,
  ];

  if (discussed.length === 0) lines.push(`- ${copy.markdown.none}`);
  discussed.forEach((group, index) => {
    lines.push("", `### ${index + 1}. ${summary(group)}`);
    const entry = resolve(group);
    if (hasGroupHeading(entry)) {
      const texts = entry.items.map((item) => escapeMarkdown(item.text));
      lines.push(copy.markdown.items, ...bulletList(texts));
    }
    const comments = byCreation(state.comments.filter((comment) => comment.groupId === group.id));
    lines.push(copy.markdown.comments, ...bulletList(comments.map((c) => escapeMarkdown(c.text))));
    const actions = byCreation(state.actions.filter((action) => action.groupId === group.id));
    lines.push(
      copy.markdown.actions,
      ...bulletList(
        actions.map((action) => {
          const details = [
            action.assignee && escapeMarkdown(action.assignee),
            action.dueDate && copy.markdown.due(action.dueDate),
          ].filter(Boolean);
          const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
          return `[ ] ${escapeMarkdown(action.text)}${suffix}`;
        }),
      ),
    );
  });

  lines.push("", copy.markdown.notDiscussed);
  if (notDiscussed.length === 0) lines.push(`- ${copy.markdown.none}`);
  for (const group of notDiscussed) lines.push(`- ${summary(group)}`);

  return `${lines.join("\n")}\n`;
}
