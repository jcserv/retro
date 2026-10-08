import type { GroupView } from "../../shared/protocol";
import type { RoomState } from "../state/roomState";
import { boardGroupResolver, hasGroupHeading } from "./board";
import { plural } from "./format";

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
  return lines.length > 0 ? lines.map((line) => `  - ${line}`) : ["  - (none)"];
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
    return `${escapeMarkdown(resolve(group).label)} (${plural(votes, "vote")}) [${category}]`;
  };

  const ordered = order.flatMap((id) => {
    const group = groups.get(id);
    return group ? [group] : [];
  });
  const discussed = ordered.filter((group) => status[group.id] === "discussed");
  const notDiscussed = ordered.filter((group) => status[group.id] !== "discussed");

  const lines = [
    `# Retro: ${localDate(state.createdAt)}`,
    `Room ${state.code} · ${plural(state.presence.participantCount, "participant")}`,
    "",
    "## Discussed",
  ];

  if (discussed.length === 0) lines.push("- (none)");
  discussed.forEach((group, index) => {
    lines.push("", `### ${index + 1}. ${summary(group)}`);
    const entry = resolve(group);
    if (hasGroupHeading(entry)) {
      const texts = entry.items.map((item) => escapeMarkdown(item.text));
      lines.push("- Items:", ...bulletList(texts));
    }
    const comments = byCreation(state.comments.filter((comment) => comment.groupId === group.id));
    lines.push("- Comments:", ...bulletList(comments.map((c) => escapeMarkdown(c.text))));
    const actions = byCreation(state.actions.filter((action) => action.groupId === group.id));
    lines.push(
      "- Action items:",
      ...bulletList(
        actions.map((action) => {
          const details = [
            action.assignee && escapeMarkdown(action.assignee),
            action.dueDate && `due ${action.dueDate}`,
          ].filter(Boolean);
          const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
          return `[ ] ${escapeMarkdown(action.text)}${suffix}`;
        }),
      ),
    );
  });

  lines.push("", "## Not discussed");
  if (notDiscussed.length === 0) lines.push("- (none)");
  for (const group of notDiscussed) lines.push(`- ${summary(group)}`);

  return `${lines.join("\n")}\n`;
}
