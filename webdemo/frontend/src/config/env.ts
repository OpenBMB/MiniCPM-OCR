import { z } from 'zod';

const clientEnvSchema = z.object({
  MODE: z.string().optional(),
  VITE_API_BASE_URL: z.string().default('/api'),
  VITE_APP_TITLE: z.string().optional(),
  VITE_API_TIMEOUT_MS: z.coerce.number().positive().optional(),
  VITE_API_DEBUG: z.enum(['true', 'false']).optional(),
  // MAP 后端基路径（裸 JSON，独立于通用 /api），默认 /map-api 由 Vite/Nginx 代理
  VITE_MAP_API_BASE_URL: z.string().default('/map-api'),
  VITE_DEFAULT_LOCALE: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  VITE_AUTH_PROFILE: z.enum(['legacy', 'gcp']).default('legacy'),
  VITE_COOKIE_CONSENT_ENABLED: z.enum(['true', 'false']).default('false'),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * 启动时校验与 import.meta.env 同步的 VITE_* 变量，避免部署后才发现配置错误。
 * 校验失败会抛出带可读信息的 Error。
 */
export function validateClientEnv(): ClientEnv {
  return clientEnvSchema.parse({
    MODE: import.meta.env.MODE,
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_APP_TITLE: import.meta.env.VITE_APP_TITLE,
    VITE_API_TIMEOUT_MS: import.meta.env.VITE_API_TIMEOUT_MS,
    VITE_API_DEBUG: import.meta.env.VITE_API_DEBUG,
    VITE_MAP_API_BASE_URL: import.meta.env.VITE_MAP_API_BASE_URL,
    VITE_DEFAULT_LOCALE: import.meta.env.VITE_DEFAULT_LOCALE,
    VITE_AUTH_PROFILE: import.meta.env.VITE_AUTH_PROFILE,
    VITE_COOKIE_CONSENT_ENABLED: import.meta.env.VITE_COOKIE_CONSENT_ENABLED,
  });
}
