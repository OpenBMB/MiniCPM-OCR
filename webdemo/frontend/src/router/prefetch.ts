import { routePrefetchers } from './routes';

// 记录已触发预加载的前缀,避免重复发起请求
const prefetched = new Set<string>();

/**
 * 根据路径前缀找到对应的页面预加载工厂 key。
 * @param path 目标路径(如 /keys、/models)
 * @returns 匹配到的前缀 key,未匹配返回 undefined
 */
function matchPrefix(path: string): string | undefined {
  return Object.keys(routePrefetchers).find((key) => path === key || path.startsWith(`${key}/`));
}

/**
 * 预加载指定路径对应的页面 chunk(若有)。
 * 幂等:同一页面只会触发一次;import() 自带模块缓存,后续真正渲染时瞬时命中。
 * @param path 目标路由路径,通常为侧边栏菜单的 to
 */
export function prefetchRoute(path: string): void {
  const key = matchPrefix(path);
  if (!key || prefetched.has(key)) return;
  prefetched.add(key);
  // 预加载失败不影响主流程(真正点击时会再次尝试并走重试逻辑),静默吞掉
  routePrefetchers[key]().catch(() => {
    prefetched.delete(key);
  });
}

/**
 * 在浏览器空闲时依次预加载全部业务页面,消除首次切换的等待感。
 * 逐个排队而非并发,避免与首屏关键资源争抢带宽。
 * @returns 清理函数,用于在卸载时取消尚未执行的空闲任务
 */
export function prefetchAllRoutesOnIdle(): () => void {
  const keys = Object.keys(routePrefetchers);
  let cancelled = false;
  let handle: number | undefined;

  const ric: (cb: () => void) => number =
    typeof window.requestIdleCallback === 'function'
      ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => window.setTimeout(cb, 300);
  const cancel: (h: number) => void =
    typeof window.cancelIdleCallback === 'function'
      ? (h) => window.cancelIdleCallback(h)
      : (h) => window.clearTimeout(h);

  function step(index: number) {
    if (cancelled || index >= keys.length) return;
    handle = ric(() => {
      const key = keys[index];
      if (!prefetched.has(key)) {
        prefetched.add(key);
        routePrefetchers[key]()
          .catch(() => prefetched.delete(key))
          .finally(() => step(index + 1));
      } else {
        step(index + 1);
      }
    });
  }

  step(0);

  return () => {
    cancelled = true;
    if (handle !== undefined) cancel(handle);
  };
}
