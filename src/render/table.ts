/** Aligned plain-text table that ignores ANSI codes when measuring columns. */

import { bold, padEnd, padStart, visibleLength } from './color.ts';

export interface Column {
  header: string;
  align?: 'left' | 'right';
}

export function renderTable(columns: Column[], rows: string[][], indent = '  '): string {
  const widths = columns.map((column, index) =>
    Math.max(visibleLength(column.header), ...rows.map((row) => visibleLength(row[index] ?? ''))),
  );
  const line = (cells: string[]): string =>
    indent +
    columns
      .map((column, index) => {
        const cell = cells[index] ?? '';
        const width = widths[index] ?? 0;
        return column.align === 'right' ? padStart(cell, width) : padEnd(cell, width);
      })
      .join('  ')
      .trimEnd();
  const header = line(columns.map((column) => bold(column.header)));
  return [header, ...rows.map(line)].join('\n');
}
