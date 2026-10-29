import { z } from 'zod';

const clientEnvSchema = z.object({
  MODE: z.string().optional(),
  VITE_API_BASE_URL: z.string().default('/api'),
  VITE_APP_TITLE: z.string().optional(),
  VITE_API_TIMEOUT_MS: z.coerce.number().positive().optional(),
  VITE_API_DEBUG: z.enum(['true', 'false']).optional(),
  // MAP backend base path (raw JSON, separate from the generic /api). Defaults to /map-api, proxied by Vite or Nginx.
  VITE_MAP_API_BASE_URL: z.string().default('/map-api'),
  VITE_DEFAULT_LOCALE: z.enum(['zh-CN', 'en-US']).default('en-US'),
  VITE_AUTH_PROFILE: z.enum(['legacy', 'gcp']).default('legacy'),
  VITE_COOKIE_CONSENT_ENABLED: z.enum(['true', 'false']).default('false'),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Validate VITE_* variables against import.meta.env at startup, so misconfiguration is not discovered only after deploy.
 * A failed check throws an Error with a readable message.
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
