import { useMemo, type CSSProperties } from 'react';
import GoCaptcha from 'go-captcha-react';

/** Slide challenge from the backend (no answer). The coordinate system matches the original image size (300×220). */
export interface SlideCaptchaChallenge {
  /** Background image with the gap (data URI). */
  masterB64: string;
  /** Puzzle piece (data URI). */
  tileB64: string;
  /** Initial display x of the puzzle piece. */
  tileX: number;
  /** Display y of the puzzle piece (same height as the gap). */
  tileY: number;
  /** Puzzle piece width. */
  tileWidth: number;
  /** Puzzle piece height. */
  tileHeight: number;
}

/** SlideCaptcha props. */
export interface SlideCaptchaProps {
  /** Challenge; when null, render an empty placeholder (loading). */
  challenge: SlideCaptchaChallenge | null;
  /** Called when the user releases the slider; point is where the piece lands. reset can move the slider back. */
  onConfirm: (point: { x: number; y: number }, reset: () => void) => void;
  /** Refresh click loads a new challenge. */
  onRefresh: () => void;
  /** Called when the go-captcha title-bar close icon is clicked (cancel verification and close the dialog). */
  onClose?: () => void;
  /** Hint copy. */
  title?: string;
  /** Status: success leaves the slider in place and turns it green; error flashes red; default is brand blue. */
  status?: 'default' | 'success' | 'error';
}

// Match the backend go-captcha default challenge size so the frontend drop-point coordinates line up with the server answer coordinates.
const MASTER_WIDTH = 300;
const MASTER_HEIGHT = 220;

// Slider (dragBlock / dot) primary color by status: default is the brand color, success is green, error is red.
const STATUS_COLOR: Record<NonNullable<SlideCaptchaProps['status']>, string> = {
  default: 'hsl(var(--primary))',
  success: 'hsl(var(--success))',
  error: 'hsl(var(--destructive))',
};

/**
 * Slide captcha (puzzle). A presentational wrapper around go-captcha-react Slide mode:
 * it only renders the challenge and forwards the drop point and refresh events. It makes no requests (the caller fetches and checks the challenge).
 *
 * Important: data, config, and events are all stable useMemo references, so a parent re-render from a status change
 * does not create new data and trip go-captcha’s "data changed, so reset" effect (otherwise the slider jumps back after success).
 */
export function SlideCaptcha({
  challenge,
  onConfirm,
  onRefresh,
  onClose,
  title = '向右拖动滑块完成拼图',
  status = 'default',
}: SlideCaptchaProps) {
  // Create a new data reference only when the challenge changes; a status change (color) does not reset go-captcha.
  const data = useMemo(
    () => ({
      thumbX: challenge?.tileX ?? 0,
      thumbY: challenge?.tileY ?? 0,
      thumbWidth: challenge?.tileWidth ?? 0,
      thumbHeight: challenge?.tileHeight ?? 0,
      image: challenge?.masterB64 ?? '',
      thumb: challenge?.tileB64 ?? '',
    }),
    [challenge],
  );

  const config = useMemo(
    () => ({ width: MASTER_WIDTH, height: MASTER_HEIGHT, title, showTheme: false }),
    [title],
  );

  const events = useMemo(
    () => ({ confirm: onConfirm, refresh: onRefresh, close: onClose }),
    [onConfirm, onRefresh, onClose],
  );

  // Override go-captcha theme variables with the design-system primary color; the slider color follows status (Slide does not consume type, so color can only go through CSS variables).
  const themeVars = useMemo(
    () =>
      ({
        ['--go-captcha-theme-round-color']: STATUS_COLOR[status],
        ['--go-captcha-theme-drag-bg-color']: STATUS_COLOR[status],
        ['--go-captcha-theme-drag-icon-color']: 'hsl(var(--primary-foreground))',
        ['--go-captcha-theme-btn-bg-color']: 'hsl(var(--primary))',
        ['--go-captcha-theme-btn-border-color']: 'hsl(var(--primary))',
      }) as CSSProperties,
    [status],
  );

  return (
    <div style={themeVars}>
      {challenge ? (
        <GoCaptcha.Slide data={data} config={config} events={events} />
      ) : (
        // While the challenge is loading, render a same-size placeholder so go-captcha does not flash black or jump the layout on an empty image (image='').
        <div
          className="flex items-center justify-center rounded-md bg-muted/50"
          style={{ width: MASTER_WIDTH, height: MASTER_HEIGHT }}
        >
          <span className="text-sm text-muted-foreground">加载中…</span>
        </div>
      )}
    </div>
  );
}
