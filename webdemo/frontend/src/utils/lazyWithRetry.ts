/**
 * 动态模块加载失败时按递增延时重试，并保留默认导出的完整类型。
 * @param factory 动态导入函数
 * @param retries 首次失败后的最大重试次数
 * @returns 加载成功的模块；重试耗尽后交由调用方错误边界处理
 */
export function lazyWithRetry<T>(
  factory: () => Promise<{ default: T }>,
  retries = 3,
): Promise<{ default: T }> {
  return new Promise((resolve, reject) => {
    function attempt(remaining: number) {
      factory()
        .then(resolve)
        .catch((err: Error) => {
          if (remaining <= 0) {
            reject(err);
            return;
          }
          const delay = (retries - remaining + 1) * 1000;
          setTimeout(() => attempt(remaining - 1), delay);
        });
    }
    attempt(retries);
  });
}
