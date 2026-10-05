import type { ComponentChildren } from "preact";
import type { BoardColumn, BoardGroup } from "../lib/board";
import styles from "./Board.module.css";
import { CategoryColumn } from "./CategoryColumn";
import { GroupCard } from "./GroupCard";

type BoardProps = {
  columns: readonly BoardColumn[];
  renderGroup?: (group: BoardGroup, column: BoardColumn) => ComponentChildren;
  columnDropKey?: (column: BoardColumn) => string | undefined;
};

export function Board({ columns, renderGroup, columnDropKey }: BoardProps) {
  return (
    <div class={styles.board}>
      {columns.map((column) => (
        <CategoryColumn key={column.category.id} column={column} dropKey={columnDropKey?.(column)}>
          {column.groups.map((entry) => (
            <li key={entry.group.id} class={styles.slot}>
              {renderGroup ? renderGroup(entry, column) : <GroupCard group={entry} />}
            </li>
          ))}
        </CategoryColumn>
      ))}
    </div>
  );
}
