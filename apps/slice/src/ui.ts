/** Tiny terminal formatting helpers for the vertical-slice demo. */

export function box(lines: string[], width = 44): string {
  const top = `┌${'─'.repeat(width - 2)}┐`;
  const bottom = `└${'─'.repeat(width - 2)}┘`;
  const body = lines.map((l) => `│ ${l.padEnd(width - 4).slice(0, width - 4)} │`);
  return [top, ...body, bottom].join('\n');
}

export function rule(title: string): string {
  return `\n━━━ ${title} ${'━'.repeat(Math.max(0, 60 - title.length))}`;
}

export function table(headers: string[], rows: string[][], gaps = 2): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const fmt = (cells: string[]): string =>
    cells
      .map((c, i) => c.padEnd((widths[i] ?? 0) + gaps))
      .join('')
      .trimEnd();
  return [fmt(headers), fmt(widths.map((w) => '─'.repeat(w))), ...rows.map(fmt)].join('\n');
}
