import { useMemo, type CSSProperties } from 'react';
import GoCaptcha from 'go-captcha-react';

/** 后端下发的滑块题目（不含答案）。坐标系与图片原始尺寸（300×220）一致。 */
export interface SlideCaptchaChallenge {
  /** 带缺口的背景大图（data URI） */
  masterB64: string;
  /** 拼图块（data URI） */
  tileB64: string;
  /** 拼图块初始展示 x */
  tileX: number;
  /** 拼图块展示 y（与缺口同高） */
  tileY: number;
  /** 拼图块宽 */
  tileWidth: number;
  /** 拼图块高 */
  tileHeight: number;
}

/** SlideCaptcha 入参 */
export interface SlideCaptchaProps {
  /** 题目；为 null 时渲染空白占位（加载中） */
  challenge: SlideCaptchaChallenge | null;
  /** 用户释放滑块时回调，point 为拼图落点；reset 可将滑块复位 */
  onConfirm: (point: { x: number; y: number }, reset: () => void) => void;
  /** 点击刷新换一题 */
  onRefresh: () => void;
  /** 点击 go-captcha 标题栏关闭图标时回调（用于取消验证、关闭弹窗） */
  onClose?: () => void;
  /** 提示文案 */
  title?: string;
  /** 状态：success 滑块停留并转绿；error 闪红；default 品牌蓝 */
  status?: 'default' | 'success' | 'error';
}

// 与后端 go-captcha 默认出题尺寸保持一致，确保前端落点坐标系与服务端答案坐标系对齐。
const MASTER_WIDTH = 300;
const MASTER_HEIGHT = 220;

// 不同状态下滑块（dragBlock/圆点）的主色：default 主色 / success 绿 / error 红。
const STATUS_COLOR: Record<NonNullable<SlideCaptchaProps['status']>, string> = {
  default: 'hsl(var(--primary))',
  success: 'hsl(var(--success))',
  error: 'hsl(var(--destructive))',
};

/**
 * 滑块人机验证（拼图）。基于 go-captcha-react 的 Slide 模式封装为纯展示组件：
 * 只负责渲染题目、把用户落点/刷新事件回调出去，不做任何数据请求（取题/校验由调用方编排）。
 *
 * 关键：data/config/events 均 useMemo 固定引用，避免父组件因状态变更重渲染时
 * 生成新 data 触发 go-captcha 内部「data 变化即复位」的 effect（否则成功后滑块会回退）。
 */
export function SlideCaptcha({
  challenge,
  onConfirm,
  onRefresh,
  onClose,
  title = '向右拖动滑块完成拼图',
  status = 'default',
}: SlideCaptchaProps) {
  // 仅当题目变化时才生成新的 data 引用，状态变更（变色）不触发 go-captcha 复位。
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

  // 用设计系统主色覆盖 go-captcha 主题变量；按状态切换滑块颜色（Slide 不消费 type，颜色只能走 CSS 变量）。
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
        // 取题中：渲染等尺寸占位，避免 go-captcha 在空图（image=''）时的「黑屏一闪」与布局跳动。
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
