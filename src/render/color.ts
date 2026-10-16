/**
 * Tiny ANSI styling helper. Color and Unicode symbols are on only when stdout
 * is a TTY (docs/ARCHITECTURE.md section 2), so piped output stays plain and
 * stable. NO_COLOR disables color, FORCE_COLOR=1 forces it, DOJO_ASCII=1 forces
 * ASCII symbols.
 */

interface OutputMode {
  color: boolean;
  unicode: boolean;
}

function detectMode(): OutputMode {
  const env = process.env;
  const tty = Boolean(process.stdout.isTTY);
  const noColor = env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '';
  const forced = env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '' && env['FORCE_COLOR'] !== '0';
  return {
    color: !noColor && (forced || tty),
    unicode: tty && env['DOJO_ASCII'] !== '1',
  };
}

let mode: OutputMode = detectMode();

/** Re-read the environment; used after global flags such as --no-color are applied. */
export function configureOutput(options: { noColor?: boolean } = {}): void {
  mode = detectMode();
  if (options.noColor === true) mode = { ...mode, color: false };
}

const wrap = (open: number, close: number) => (text: string): string =>
  mode.color ? `\u001b[${open}m${text}\u001b[${close}m` : text;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/** Visible width of a string (ANSI codes do not take space). */
export function visibleLength(text: string): number {
  return [...stripAnsi(text)].length;
}

export function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleLength(text)));
}

export function padStart(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - visibleLength(text))) + text;
}

export interface Symbols {
  ok: string;
  bad: string;
  arrow: string;
  dot: string;
  barFull: string;
  barEmpty: string;
  rule: string;
}

export function symbols(): Symbols {
  return mode.unicode
    ? { ok: '✔', bad: '✖', arrow: '→', dot: '•', barFull: '█', barEmpty: '░', rule: '─' }
    : { ok: '+', bad: 'x', arrow: '->', dot: '*', barFull: '#', barEmpty: '.', rule: '-' };
}

/** Usable terminal width, clamped so layouts stay readable. */
export function terminalWidth(): number {
  const columns = process.stdout.columns;
  return Math.min(100, Math.max(60, typeof columns === 'number' && columns > 0 ? columns : 80));
}

/** Shorten text to `max` visible characters, ending with an ellipsis. */
export function truncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(1, max - 1)).join('') + (mode.unicode ? '…' : '~');
}

/** Clear the screen when interactive; otherwise print a separator line. */
export function clearScreen(): string {
  if (process.stdout.isTTY) return '\u001b[2J\u001b[3J\u001b[H';
  return `\n${symbols().rule.repeat(40)}\n`;
}
