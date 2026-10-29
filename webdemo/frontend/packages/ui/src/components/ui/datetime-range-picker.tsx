import * as React from 'react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  FloatingFocusManager,
} from '@floating-ui/react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowRight,
} from 'lucide-react';
import { cn } from '../../utils';

/** Shortcut preset: pick a date range, or clear the time filter with the All item. */
export type DateRangePreset = DateRangeValuePreset | DateRangeAllPreset;

interface DateRangeValuePreset {
  label: string;
  range: () => [Date, Date];
}

interface DateRangeAllPreset {
  label: string;
  all: true;
}

export interface DateTimeRangePickerProps {
  /** Start time; YYYY-MM-DD HH:mm:ss in datetime mode, YYYY-MM-DD in date mode; empty means unset. */
  start?: string;
  /** End time; same format as start; empty means unset. */
  end?: string;
  /** Called on confirm with (start, end); called with ('', '') when cleared. */
  onChange?: (start: string, end: string) => void;
  /** Called when "All" is clicked; when omitted, behaves the same as clear. */
  onSelectAll?: () => void;
  /** Whether the "All" state is active, for controlled display. */
  allSelected?: boolean;
  /** Called when input validity changes; false when the input is invalid. */
  onValidityChange?: (valid: boolean) => void;
  /** 'datetime' (default, with hour-minute-second columns) or 'date' (date only, no time columns, output YYYY-MM-DD). */
  mode?: 'datetime' | 'date';
  /** Shortcuts on the left; omit them to use the built-ins (All / today / yesterday / last 7 days / last 30 days), or pass [] to hide the preset bar. */
  presets?: DateRangePreset[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

interface YMD {
  y: number;
  m: number; // 0-11
  d: number;
}

interface Parts {
  ymd: YMD | null;
  h: number;
  mi: number;
  s: number;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Parse "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm[:ss]"; on failure the time part falls back to 0. */
function parse(value?: string): Parts {
  const empty: Parts = { ymd: null, h: 0, mi: 0, s: 0 };
  if (!value) return empty;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) {
    const ymd = { y: +match[1], m: +match[2] - 1, d: +match[3] };
    const h = +match[4];
    const mi = +match[5];
    const s = match[6] ? +match[6] : 0;
    if (!isValidYMD(ymd) || h > 23 || mi > 59 || s > 59) return empty;
    return {
      ymd,
      h,
      mi,
      s,
    };
  }
  if (dateOnly) {
    const ymd = { y: +dateOnly[1], m: +dateOnly[2] - 1, d: +dateOnly[3] };
    return isValidYMD(ymd) ? { ymd, h: 0, mi: 0, s: 0 } : empty;
  }
  return empty;
}

function formatOut(p: Parts): string {
  if (!p.ymd) return '';
  return `${p.ymd.y}-${pad(p.ymd.m + 1)}-${pad(p.ymd.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** Date-only output YYYY-MM-DD (used in date mode). */
function formatDate(p: Parts): string {
  if (!p.ymd) return '';
  return `${p.ymd.y}-${pad(p.ymd.m + 1)}-${pad(p.ymd.d)}`;
}

function sameDay(a: YMD | null, b: YMD | null): boolean {
  return !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
}

/** < 0 means a is earlier than b (year, month, and day only). */
function compareDay(a: YMD, b: YMD): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function todayYMD(): YMD {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

function dateToYMD(d: Date): YMD {
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
}

function shiftDatePart(ymd: YMD, field: 'y' | 'm' | 'd', delta: number): YMD {
  const date = new Date(ymd.y, ymd.m, ymd.d);
  if (field === 'd') {
    date.setDate(date.getDate() + delta);
    return dateToYMD(date);
  }

  const next = new Date(
    ymd.y + (field === 'y' ? delta : 0),
    ymd.m + (field === 'm' ? delta : 0),
    1,
  );
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  return {
    y: next.getFullYear(),
    m: next.getMonth(),
    d: Math.min(ymd.d, lastDay),
  };
}

function formatTriggerText(
  start: string | undefined,
  end: string | undefined,
  allSelected: boolean,
  mode: 'datetime' | 'date' = 'datetime',
): string {
  if (allSelected) return '全部';
  const formatValue = (value?: string) => {
    if (!value) return '';
    const parsed = parse(value);
    if (!parsed.ymd) return '';
    return mode === 'date' ? formatDate(parsed) : formatOut(parsed);
  };
  const formattedStart = formatValue(start);
  const formattedEnd = formatValue(end);
  if (formattedStart && formattedEnd) return `${formattedStart}  →  ${formattedEnd}`;
  if (formattedStart || formattedEnd) return `${formattedStart || '…'}  →  ${formattedEnd || '…'}`;
  return '';
}

function isValidYMD(ymd: YMD): boolean {
  if (ymd.y < 1 || ymd.m < 0 || ymd.m > 11 || ymd.d < 1 || ymd.d > 31) return false;
  const date = new Date(ymd.y, ymd.m, ymd.d);
  return date.getFullYear() === ymd.y && date.getMonth() === ymd.m && date.getDate() === ymd.d;
}

function compareParts(a: Parts, b: Parts): number {
  const day = compareDay(a.ymd!, b.ymd!);
  if (day !== 0) return day;
  if (a.h !== b.h) return a.h - b.h;
  if (a.mi !== b.mi) return a.mi - b.mi;
  return a.s - b.s;
}

function formatEditablePart(parts: Parts, isDate: boolean): string {
  return isDate ? formatDate(parts) : formatOut(parts);
}

function formatEditableRange(start: Parts, end: Parts, isDate: boolean): string {
  const left = start.ymd ? formatEditablePart(start, isDate) : '…';
  const right = end.ymd ? formatEditablePart(end, isDate) : '…';
  return `${left}  →  ${right}`;
}

/**
 * Parse a complete range from the input. Only explicit date formats are accepted, so the browser cannot
 * auto-correct an invalid date such as 2026-02-31 and submit a wrong query.
 */
function parseEditableRange(
  value: string,
  mode: 'datetime' | 'date',
): { start: Parts; end: Parts } | null {
  const match =
    value.trim().match(/^(.+?)\s+(?:→|->|to|至)\s+(.+)$/i) ??
    value.trim().match(/^(.+?)\s+-\s+(.+)$/);
  if (!match) return null;

  const parsePart = (raw: string, isEnd: boolean): Parts | null => {
    const dateTimeMatch = raw
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!dateTimeMatch) return null;

    const ymd: YMD = {
      y: Number(dateTimeMatch[1]),
      m: Number(dateTimeMatch[2]) - 1,
      d: Number(dateTimeMatch[3]),
    };
    if (!isValidYMD(ymd)) return null;

    if (mode === 'date') {
      if (dateTimeMatch[4] || dateTimeMatch[5] || dateTimeMatch[6]) return null;
      return { ymd, h: 0, mi: 0, s: 0 };
    }

    const hasTime = Boolean(dateTimeMatch[4]);
    let h = 0;
    let mi = 0;
    let s = 0;
    if (hasTime) {
      h = Number(dateTimeMatch[4]);
      mi = Number(dateTimeMatch[5]);
      s = dateTimeMatch[6] ? Number(dateTimeMatch[6]) : 0;
    } else if (isEnd) {
      h = 23;
      mi = 59;
      s = 59;
    }
    if (h > 23 || mi > 59 || s > 59) return null;
    return { ymd, h, mi, s };
  };

  const start = parsePart(match[1], false);
  const end = parsePart(match[2], true);
  if (!start || !end || compareParts(start, end) > 0) return null;
  return { start, end };
}

/** Whether the input has reached a complete range format, so typing can tell "not finished" from "invalid". */
function isCompleteEditableRange(value: string, mode: 'datetime' | 'date'): boolean {
  const match =
    value.trim().match(/^(.+?)\s+(?:→|->|to|至)\s+(.+)$/i) ??
    value.trim().match(/^(.+?)\s+-\s+(.+)$/);
  if (!match) return false;
  const date = '\\d{4}-\\d{2}-\\d{2}';
  const time = mode === 'datetime' ? '(?:[ T]\\d{2}:\\d{2}(?::\\d{2})?)?' : '';
  const partPattern = new RegExp(`^${date}${time}$`);
  return partPattern.test(match[1].trim()) && partPattern.test(match[2].trim());
}

/** Keep only characters allowed in a date-range input, so unrelated text never enters the control state. */
function sanitizeEditableInput(value: string): string {
  return value.replace(/[^\d\-: Tto至→>]/g, '');
}

type EditableRangeTarget = {
  side: 'start' | 'end';
  field: 'y' | 'm' | 'd' | 'h' | 'mi' | 's';
};
type EditableDateTarget = {
  side: 'start' | 'end';
  field: 'y' | 'm' | 'd';
};
type EditableTimeTarget = {
  side: 'start' | 'end';
  field: 'h' | 'mi' | 's';
};

function getEditableRangeTarget(value: string, caret: number): EditableRangeTarget | null {
  const separatorIndex = value.indexOf('\u2192');
  if (separatorIndex < 0) return null;

  const startText = value.slice(0, separatorIndex).trimEnd();
  const endText = value.slice(separatorIndex + 1).trimStart();
  const endStart = value.indexOf(endText, separatorIndex + 1);

  function fieldAt(part: string, localCaret: number): EditableRangeTarget['field'] | null {
    if (localCaret >= 0 && localCaret < 4) return 'y';
    if (localCaret >= 5 && localCaret < 7) return 'm';
    if (localCaret >= 8 && localCaret < 10) return 'd';
    const dateTimeSeparator = part.indexOf(' ');
    if (dateTimeSeparator < 0) return null;
    const timeStart = dateTimeSeparator + 1;
    if (localCaret >= timeStart && localCaret < timeStart + 3) return 'h';
    if (localCaret >= timeStart + 3 && localCaret < timeStart + 6) return 'mi';
    if (localCaret >= timeStart + 6 && localCaret <= timeStart + 9) return 's';
    return null;
  }

  if (caret <= separatorIndex) {
    const field = fieldAt(startText, Math.min(caret, startText.length));
    return field ? { side: 'start', field } : null;
  }
  if (endStart < 0) return null;
  const field = fieldAt(endText, Math.max(0, caret - endStart));
  return field ? { side: 'end', field } : null;
}

const DEFAULT_PRESETS: DateRangePreset[] = [
  { label: '全部', all: true },
  { label: '今天', range: () => [new Date(), new Date()] },
  {
    label: '昨天',
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return [d, new Date(d)];
    },
  },
  {
    label: '最近 7 天',
    range: () => {
      const s = new Date();
      s.setDate(s.getDate() - 6);
      return [s, new Date()];
    },
  },
  {
    label: '最近 30 天',
    range: () => {
      const s = new Date();
      s.setDate(s.getDate() - 29);
      return [s, new Date()];
    },
  },
];

/**
 * Date-time range picker (@map/ui).
 *
 * Purpose: replace the loose "two date fields plus a hand-typed time" filter with one popover that matches the design system:
 * shortcuts on the left (All / today / yesterday / last 7 days / last 30 days), a range calendar in the middle, hour/minute/second columns on the right, and confirm at the bottom.
 * Built on @floating-ui/react (same base as this library’s DatePicker). Controlled: the caller owns the value, and it is returned on confirm.
 */
function DateTimeRangePicker({
  start,
  end,
  onChange,
  onSelectAll,
  allSelected = false,
  onValidityChange,
  mode = 'datetime',
  presets,
  placeholder = '选择时间范围',
  disabled,
  className,
  id,
  ariaLabel,
}: DateTimeRangePickerProps) {
  const isDate = mode === 'date';
  const presetList = presets ?? DEFAULT_PRESETS;
  // Date mode outputs YYYY-MM-DD; datetime includes hours, minutes, and seconds.
  const emit = isDate ? formatDate : formatOut;
  const [open, setOpen] = React.useState(false);
  // Draft: edit inside the panel after open, and write back only when "Confirm" is clicked.
  const [draftStart, setDraftStart] = React.useState<Parts>({ ymd: null, h: 0, mi: 0, s: 0 });
  const [draftEnd, setDraftEnd] = React.useState<Parts>({ ymd: null, h: 23, mi: 59, s: 59 });
  const [active, setActive] = React.useState<'start' | 'end'>('start');
  const [activeTimeField, setActiveTimeField] = React.useState<'h' | 'mi' | 's'>('h');
  const [inputValue, setInputValue] = React.useState(() =>
    formatTriggerText(start, end, allSelected, mode),
  );
  const [inputError, setInputError] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inputCaretRequestRef = React.useRef<number | null>(null);
  const calendarGridRef = React.useRef<HTMLDivElement>(null);
  const calendarFocusRequestRef = React.useRef<string | null>(null);
  const inputDirtyRef = React.useRef(false);
  const pendingInputValueRef = React.useRef<string | null>(null);
  const lastValidInputRef = React.useRef(formatTriggerText(start, end, allSelected, mode));
  const [view, setView] = React.useState<{ y: number; m: number }>(() => {
    const base = parse(start).ymd ?? todayYMD();
    return { y: base.y, m: base.m };
  });

  function openPicker(preserveInput = false) {
    const s = parse(start);
    const e = parse(end);
    const t = todayYMD();
    setDraftStart(s.ymd ? s : { ymd: t, h: 0, mi: 0, s: 0 });
    setDraftEnd(e.ymd ? e : { ymd: t, h: 23, mi: 59, s: 59 });
    setActive('start');
    if (!preserveInput) {
      const formatted = allSelected ? '全部' : formatTriggerText(start, end, false, mode);
      setInputValue(formatted);
      lastValidInputRef.current = formatted;
      pendingInputValueRef.current = null;
    }
    setInputError('');
    if (!preserveInput) onValidityChange?.(true);
    inputDirtyRef.current = preserveInput
      ? inputValue !== formatTriggerText(start, end, allSelected, mode)
      : false;
    const base = s.ymd ?? t;
    setView({ y: base.y, m: base.m });
    setOpen(true);
  }

  React.useEffect(() => {
    const formatted = formatTriggerText(start, end, allSelected, mode);
    // onChange is a controlled callback, and the parent may pass the new value back only on the next render; until then, keep
    // the value just confirmed, so a sync effect does not flash the old range back.
    if (pendingInputValueRef.current !== null) {
      if (pendingInputValueRef.current !== formatted) return;
      pendingInputValueRef.current = null;
    }
    if (!open && !inputDirtyRef.current && inputValue !== formatted) {
      setInputValue(formatted);
    }
  }, [allSelected, end, inputValue, mode, open, start]);

  React.useLayoutEffect(() => {
    const caret = inputCaretRequestRef.current;
    if (caret === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(caret, caret);
    inputCaretRequestRef.current = null;
  }, [inputValue]);

  const {
    refs: floatingRefs,
    floatingStyles,
    context,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const today = todayYMD();

  const cells = React.useMemo(() => {
    // Monday is the start of the week: getDay() Sunday = 0 maps to 6.
    const firstWeekday = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
    const startDate = new Date(view.y, view.m, 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() } as YMD;
    });
  }, [view]);

  React.useEffect(() => {
    const requested = calendarFocusRequestRef.current;
    if (!requested) return;
    const button = calendarGridRef.current?.querySelector<HTMLButtonElement>(
      `[data-date="${requested}"]`,
    );
    if (button) {
      button.focus();
      calendarFocusRequestRef.current = null;
    }
  }, [cells]);

  function moveCalendarFocus(cell: YMD, delta: number) {
    const nextDate = new Date(cell.y, cell.m, cell.d + delta);
    const next = dateToYMD(nextDate);
    calendarFocusRequestRef.current = `${next.y}-${next.m}-${next.d}`;
    if (next.y !== view.y || next.m !== view.m) {
      setView({ y: next.y, m: next.m });
      return;
    }
    const button = calendarGridRef.current?.querySelector<HTMLButtonElement>(
      `[data-date="${calendarFocusRequestRef.current}"]`,
    );
    button?.focus();
    calendarFocusRequestRef.current = null;
  }

  function handleCalendarKeyDown(cell: YMD, event: React.KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        moveCalendarFocus(cell, -1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveCalendarFocus(cell, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveCalendarFocus(cell, -7);
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveCalendarFocus(cell, 7);
        break;
      case 'Home':
        event.preventDefault();
        moveCalendarFocus(cell, -((new Date(cell.y, cell.m, cell.d).getDay() + 6) % 7));
        break;
      case 'End':
        event.preventDefault();
        moveCalendarFocus(cell, 6 - ((new Date(cell.y, cell.m, cell.d).getDay() + 6) % 7));
        break;
      case 'PageUp':
        event.preventDefault();
        setView((current) => {
          const next = new Date(current.y, current.m - 1, 1);
          return { y: next.getFullYear(), m: next.getMonth() };
        });
        break;
      case 'PageDown':
        event.preventDefault();
        setView((current) => {
          const next = new Date(current.y, current.m + 1, 1);
          return { y: next.getFullYear(), m: next.getMonth() };
        });
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pickDay(cell);
        break;
      default:
        break;
    }
  }

  function pickDay(cell: YMD) {
    const sHas = !!draftStart.ymd;
    const eHas = !!draftEnd.ymd;
    if (!sHas || (sHas && eHas)) {
      // Start a new range.
      const nextStart = { ...draftStart, ymd: cell };
      const nextEnd = { ...draftEnd, ymd: null };
      setDraftStart(nextStart);
      setDraftEnd(nextEnd);
      setActive('end');
      setInputValue(formatEditableRange(nextStart, nextEnd, isDate));
      inputDirtyRef.current = false;
      setInputError('');
      return;
    }
    // A start is set; waiting for the end.
    if (compareDay(cell, draftStart.ymd!) < 0) {
      const nextStart = { ...draftStart, ymd: cell };
      setDraftStart(nextStart);
      setActive('end');
      setInputValue(formatEditableRange(nextStart, draftEnd, isDate));
    } else {
      const nextEnd = { ...draftEnd, ymd: cell };
      setDraftEnd(nextEnd);
      setActive('end');
      setInputValue(formatEditableRange(draftStart, nextEnd, isDate));
    }
    inputDirtyRef.current = false;
    setInputError('');
  }

  function setActiveTime(field: 'h' | 'mi' | 's', val: number) {
    setTime(active, field, val);
  }

  function setTime(side: 'start' | 'end', field: 'h' | 'mi' | 's', val: number, caret?: number) {
    const setter = side === 'start' ? setDraftStart : setDraftEnd;
    setter((p) => ({ ...p, [field]: val }));
    const next = {
      ...(side === 'start' ? draftStart : draftEnd),
      [field]: val,
    };
    setInputValue(
      formatEditableRange(
        side === 'start' ? next : draftStart,
        side === 'end' ? next : draftEnd,
        isDate,
      ),
    );
    if (caret !== undefined) {
      inputCaretRequestRef.current = Math.min(
        caret,
        formatEditableRange(
          side === 'start' ? next : draftStart,
          side === 'end' ? next : draftEnd,
          isDate,
        ).length,
      );
    }
    inputDirtyRef.current = false;
    setInputError('');
  }

  function moveActiveTime(delta: number) {
    const count = activeTimeField === 'h' ? 24 : 60;
    const next = (activeParts[activeTimeField] + delta + count) % count;
    setActiveTime(activeTimeField, next);
  }

  function moveInputDate(target: EditableDateTarget, delta: number, caret: number) {
    const parts = target.side === 'start' ? draftStart : draftEnd;
    if (!parts.ymd) return;
    const next = { ...parts, ymd: shiftDatePart(parts.ymd, target.field, delta) };
    if (target.side === 'start') {
      setDraftStart(next);
    } else {
      setDraftEnd(next);
    }
    setInputValue(
      formatEditableRange(
        target.side === 'start' ? next : draftStart,
        target.side === 'end' ? next : draftEnd,
        isDate,
      ),
    );
    inputCaretRequestRef.current = caret;
    inputDirtyRef.current = false;
    setInputError('');
  }

  function moveInputTime(target: EditableTimeTarget, delta: number, caret: number) {
    const parts = target.side === 'start' ? draftStart : draftEnd;
    const count = target.field === 'h' ? 24 : 60;
    const next = (parts[target.field] + delta + count) % count;
    setActive(target.side);
    setActiveTimeField(target.field);
    setTime(target.side, target.field, next, caret);
  }

  // Shortcuts are "quick picks": a click fills the range and closes the popover, with no extra "Confirm".
  function applyPreset(startYMD: YMD, endYMD: YMD) {
    const s: Parts = { ymd: startYMD, h: 0, mi: 0, s: 0 };
    const e: Parts = { ymd: endYMD, h: 23, mi: 59, s: 59 };
    onChange?.(emit(s), emit(e));
    const nextInputValue = formatTriggerText(emit(s), emit(e), false, mode);
    pendingInputValueRef.current = nextInputValue;
    lastValidInputRef.current = nextInputValue;
    setInputValue(nextInputValue);
    inputDirtyRef.current = false;
    setInputError('');
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const next = new Date(v.y, v.m + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });
  }
  function shiftYear(delta: number) {
    setView((v) => ({ y: v.y + delta, m: v.m }));
  }

  function applyInput(value: string): boolean {
    const sanitizedValue = sanitizeEditableInput(value);
    const parsed = parseEditableRange(sanitizedValue, mode);
    if (!parsed) {
      setInputValue(lastValidInputRef.current);
      setInputError('请输入有效的日期时间区间');
      onValidityChange?.(false);
      return false;
    }
    setDraftStart(parsed.start);
    setDraftEnd(parsed.end);
    setView({ y: parsed.start.ymd!.y, m: parsed.start.ymd!.m });
    onChange?.(emit(parsed.start), emit(parsed.end));
    const nextInputValue = formatTriggerText(emit(parsed.start), emit(parsed.end), false, mode);
    pendingInputValueRef.current = nextInputValue;
    lastValidInputRef.current = nextInputValue;
    setInputValue(nextInputValue);
    inputDirtyRef.current = false;
    setInputError('');
    onValidityChange?.(true);
    setOpen(false);
    return true;
  }

  function confirm() {
    if (inputDirtyRef.current) {
      applyInput(inputValue);
      return;
    }
    // Selecting only one end (including a single day click on the calendar) still counts as a one-day range: fill the other end with that day,
    // keeping the start’s time (default 00:00:00) and the end’s time (default 23:59:59).
    if (!draftStart.ymd && !draftEnd.ymd) return;
    const s: Parts = draftStart.ymd ? draftStart : { ...draftStart, ymd: draftEnd.ymd };
    const e: Parts = draftEnd.ymd ? draftEnd : { ...draftEnd, ymd: draftStart.ymd };
    onChange?.(emit(s), emit(e));
    const nextInputValue = formatTriggerText(emit(s), emit(e), false, mode);
    pendingInputValueRef.current = nextInputValue;
    lastValidInputRef.current = nextInputValue;
    setInputValue(nextInputValue);
    inputDirtyRef.current = false;
    setInputError('');
    onValidityChange?.(true);
    setOpen(false);
  }
  function clear() {
    onChange?.('', '');
    pendingInputValueRef.current = '';
    lastValidInputRef.current = '';
    setInputValue('');
    inputDirtyRef.current = false;
    setInputError('');
    onValidityChange?.(true);
    setOpen(false);
  }

  const activeParts = active === 'start' ? draftStart : draftEnd;
  return (
    <>
      <div className={cn('flex w-full flex-col gap-1', className)}>
        <div
          ref={floatingRefs.setReference}
          className={cn(
            'group flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 py-1.5 text-[13px]',
            'transition-[color,border-color,box-shadow] duration-150 hover:border-primary/30',
            'focus-within:outline-none focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20',
            open && 'border-primary/30',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <input
            ref={inputRef}
            id={id}
            type="text"
            value={inputValue}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-invalid={Boolean(inputError)}
            aria-describedby={inputError ? `${id || 'datetime-range'}-error` : undefined}
            placeholder={placeholder}
            title={
              isDate
                ? '格式：YYYY-MM-DD → YYYY-MM-DD'
                : '格式：YYYY-MM-DD HH:mm:ss → YYYY-MM-DD HH:mm:ss'
            }
            className={cn(
              'min-w-0 flex-1 bg-transparent text-[13px] tabular-nums text-foreground outline-none',
              'placeholder:text-muted-foreground/60 disabled:cursor-not-allowed',
            )}
            onClick={() => {
              if (!disabled && !open) {
                openPicker(true);
              }
            }}
            onChange={(event) => {
              const value = sanitizeEditableInput(event.target.value);
              const parsed = parseEditableRange(value, mode);
              if (parsed) {
                setInputValue(value);
                setDraftStart(parsed.start);
                setDraftEnd(parsed.end);
                setView({ y: parsed.start.ymd!.y, m: parsed.start.ymd!.m });
                lastValidInputRef.current = value;
                setInputError('');
                onValidityChange?.(true);
                inputDirtyRef.current = true;
                return;
              }

              if (isCompleteEditableRange(value, mode)) {
                setInputValue(value);
                setInputError('请输入有效的日期时间区间');
                onValidityChange?.(false);
                inputDirtyRef.current = true;
                return;
              }

              setInputValue(value);
              inputDirtyRef.current = true;
              setInputError('');
              onValidityChange?.(false);
            }}
            onBlur={() => {
              if (parseEditableRange(inputValue, mode)) return;
              setInputValue(lastValidInputRef.current);
              inputDirtyRef.current = false;
              setInputError('');
              onValidityChange?.(true);
            }}
            onKeyDown={(event) => {
              if (open && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                const target = getEditableRangeTarget(
                  inputValue,
                  event.currentTarget.selectionStart ?? 0,
                );
                event.preventDefault();
                if (target) {
                  const delta = event.key === 'ArrowUp' ? -1 : 1;
                  const caret = event.currentTarget.selectionStart ?? 0;
                  if (target.field === 'y' || target.field === 'm' || target.field === 'd') {
                    moveInputDate({ side: target.side, field: target.field }, delta, caret);
                  } else {
                    moveInputTime({ side: target.side, field: target.field }, delta, caret);
                  }
                } else {
                  moveActiveTime(event.key === 'ArrowUp' ? -1 : 1);
                }
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                applyInput(inputValue);
              }
              if (event.key === 'Escape') {
                pendingInputValueRef.current = null;
                const formatted = formatTriggerText(start, end, allSelected, mode);
                setInputValue(formatted);
                lastValidInputRef.current = formatted;
                inputDirtyRef.current = false;
                setInputError('');
                onValidityChange?.(true);
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => {
              if (open) {
                setOpen(false);
              } else {
                openPicker();
              }
            }}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 disabled:cursor-not-allowed"
          >
            <CalendarIcon className="size-3.5" strokeWidth={2} />
          </button>
        </div>
        {inputError && (
          <p
            id={`${id || 'datetime-range'}-error`}
            role="alert"
            className="text-[11px] leading-4 text-destructive"
          >
            {inputError}
          </p>
        )}
      </div>

      {open && (
        <FloatingPortal>
          <FloatingFocusManager
            context={context}
            modal={false}
            initialFocus={-1}
            getInsideElements={() => (inputRef.current ? [inputRef.current] : [])}
          >
            <div
              // eslint-disable-next-line react-hooks/refs -- Floating UI’s callback ref must be passed during render.
              ref={floatingRefs.setFloating}
              style={floatingStyles}
              className={cn(
                'z-[80] flex max-w-[calc(100vw-1rem)] flex-col rounded-xl border border-border/60 bg-card text-card-foreground',
                isDate ? 'w-[26rem]' : 'w-[42rem]',
                'shadow-[0_8px_30px_-4px_rgba(0,0,0,0.12),0_2px_8px_-2px_rgba(0,0,0,0.06)] focus:outline-none',
              )}
              {...getFloatingProps()}
            >
              <div className="flex">
                {/* Left: shortcuts (hidden when an empty array is passed) */}
                {presetList.length > 0 && (
                  <div className="flex w-28 shrink-0 flex-col gap-1 border-r border-border/60 p-2">
                    {presetList.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          if ('all' in preset) {
                            if (onSelectAll) {
                              onSelectAll();
                              pendingInputValueRef.current = '全部';
                              setInputValue('全部');
                              lastValidInputRef.current = '全部';
                              onValidityChange?.(true);
                              setOpen(false);
                            } else {
                              clear();
                            }
                            return;
                          }
                          const [s, e] = preset.range();
                          applyPreset(dateToYMD(s), dateToYMD(e));
                        }}
                        className="rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground/80 transition-colors hover:bg-primary/[0.08] hover:text-foreground"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Middle: range calendar */}
                <div className="min-w-0 flex-1 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-0.5">
                      <NavButton ariaLabel="上一年" onClick={() => shiftYear(-1)}>
                        <ChevronsLeft className="size-4" />
                      </NavButton>
                      <NavButton ariaLabel="上个月" onClick={() => shiftMonth(-1)}>
                        <ChevronLeft className="size-4" />
                      </NavButton>
                    </div>
                    <span className="text-[13px] font-semibold text-foreground">
                      {view.y}年 {pad(view.m + 1)}月
                    </span>
                    <div className="flex items-center gap-0.5">
                      <NavButton ariaLabel="下个月" onClick={() => shiftMonth(1)}>
                        <ChevronRight className="size-4" />
                      </NavButton>
                      <NavButton ariaLabel="下一年" onClick={() => shiftYear(1)}>
                        <ChevronsRight className="size-4" />
                      </NavButton>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-0.5">
                    {WEEKDAYS.map((w) => (
                      <div
                        key={w}
                        className="flex h-7 items-center justify-center text-[11px] font-medium text-muted-foreground/60"
                      >
                        {w}
                      </div>
                    ))}
                  </div>

                  <div ref={calendarGridRef} className="grid grid-cols-7 gap-y-0.5">
                    {cells.map((cell) => {
                      const inMonth = cell.m === view.m;
                      const isStart = sameDay(cell, draftStart.ymd);
                      const isEnd = sameDay(cell, draftEnd.ymd);
                      const inRange =
                        draftStart.ymd &&
                        draftEnd.ymd &&
                        compareDay(cell, draftStart.ymd) > 0 &&
                        compareDay(cell, draftEnd.ymd) < 0;
                      const isEdge = isStart || isEnd;
                      const isToday = sameDay(cell, today);
                      const focusDay = activeParts.ymd ?? draftStart.ymd ?? today;
                      return (
                        <button
                          key={`${cell.y}-${cell.m}-${cell.d}`}
                          type="button"
                          onClick={() => pickDay(cell)}
                          onKeyDown={(event) => handleCalendarKeyDown(cell, event)}
                          data-date={`${cell.y}-${cell.m}-${cell.d}`}
                          tabIndex={sameDay(cell, focusDay) ? 0 : -1}
                          className={cn(
                            'flex h-8 items-center justify-center text-[13px] tabular-nums transition-colors',
                            'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30',
                            inRange && 'bg-primary/[0.10]',
                            isStart && draftEnd.ymd && 'rounded-l-md',
                            isEnd && draftStart.ymd && 'rounded-r-md',
                            !isEdge && 'rounded-md',
                            !inMonth && !isEdge && 'text-muted-foreground/35',
                            inMonth &&
                              !isEdge &&
                              !inRange &&
                              'text-foreground hover:bg-primary/[0.08]',
                            inMonth && !isEdge && inRange && 'text-foreground',
                            isEdge && 'bg-primary font-medium text-primary-foreground',
                            !isEdge && isToday && 'font-semibold text-primary',
                          )}
                        >
                          {cell.d}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right: hours, minutes, and seconds (hidden in date mode) */}
                {!isDate && (
                  <div className="flex w-[15.5rem] shrink-0 flex-col border-l border-border/60">
                    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-[13px]">
                      <EdgeTab
                        label="开始"
                        activeTab={active === 'start'}
                        onClick={() => setActive('start')}
                      />
                      <ArrowRight className="size-3 text-muted-foreground/50" />
                      <EdgeTab
                        label="结束"
                        activeTab={active === 'end'}
                        onClick={() => setActive('end')}
                      />
                    </div>
                    <div className="px-3 py-1.5 text-center text-[12px] tabular-nums text-muted-foreground">
                      {activeParts.ymd
                        ? `${activeParts.ymd.y}-${pad(activeParts.ymd.m + 1)}-${pad(activeParts.ymd.d)} ${pad(activeParts.h)}:${pad(activeParts.mi)}:${pad(activeParts.s)}`
                        : '请选择日期'}
                    </div>
                    <div className="grid flex-1 grid-cols-3">
                      <TimeColumn
                        unit="时"
                        count={24}
                        value={activeParts.h}
                        onFocus={() => setActiveTimeField('h')}
                        onPick={(v) => setActiveTime('h', v)}
                      />
                      <TimeColumn
                        unit="分"
                        count={60}
                        value={activeParts.mi}
                        onFocus={() => setActiveTimeField('mi')}
                        onPick={(v) => setActiveTime('mi', v)}
                      />
                      <TimeColumn
                        unit="秒"
                        count={60}
                        value={activeParts.s}
                        onFocus={() => setActiveTimeField('s')}
                        onPick={(v) => setActiveTime('s', v)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  清除
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={!draftStart.ymd && !draftEnd.ymd}
                  className={cn(
                    'rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors',
                    'hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                >
                  确定
                </button>
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

function EdgeTab({
  label,
  activeTab,
  onClick,
}: {
  label: string;
  activeTab: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-0.5 font-medium transition-colors',
        activeTab
          ? 'bg-primary/[0.10] text-primary'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function TimeColumn({
  unit,
  count,
  value,
  onFocus,
  onPick,
}: {
  unit: string;
  count: number;
  value: number;
  onFocus: () => void;
  onPick: (v: number) => void;
}) {
  const activeRef = React.useRef<HTMLButtonElement>(null);
  const focusValueRef = React.useRef(false);
  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
    if (focusValueRef.current) {
      activeRef.current?.focus();
      focusValueRef.current = false;
    }
  }, [value]);

  function moveValue(delta: number) {
    const next = (value + delta + count) % count;
    focusValueRef.current = true;
    onPick(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        moveValue(-1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveValue(1);
        break;
      case 'PageUp':
        event.preventDefault();
        moveValue(-10);
        break;
      case 'PageDown':
        event.preventDefault();
        moveValue(10);
        break;
      case 'Home':
        event.preventDefault();
        focusValueRef.current = true;
        onPick(0);
        break;
      case 'End':
        event.preventDefault();
        focusValueRef.current = true;
        onPick(count - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div className="flex flex-col border-l border-border/60 first:border-l-0">
      <div className="py-1 text-center text-[11px] text-muted-foreground/60">{unit}</div>
      <div className="no-scrollbar max-h-[13.5rem] overflow-auto px-1 pb-1">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={`${unit}-${i}`}
            ref={i === value ? activeRef : undefined}
            type="button"
            onClick={() => {
              onFocus();
              onPick(i);
            }}
            onFocus={onFocus}
            onKeyDown={handleKeyDown}
            aria-label={`${unit} ${pad(i)}`}
            aria-current={i === value ? 'true' : 'false'}
            tabIndex={i === value ? 0 : -1}
            className={cn(
              'flex h-7 w-full items-center justify-center rounded-md text-[13px] tabular-nums transition-colors',
              i === value
                ? 'bg-primary font-medium text-primary-foreground'
                : 'text-foreground/80 hover:bg-primary/[0.08]',
            )}
          >
            {pad(i)}
          </button>
        ))}
      </div>
    </div>
  );
}

function NavButton({
  children,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
    >
      {children}
    </button>
  );
}

export { DateTimeRangePicker };
