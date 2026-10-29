import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/** Frontend source root, used to resolve the `@/` path alias. */
const srcDir = fileURLToPath(new URL('./src', import.meta.url));

/**
 * Resolve the static site title (<title> and og:title) and write it into index.html at build time.
 * Link-preview crawlers do not run JS and only read the raw HTML, so the title cannot switch with runtime i18n and must be injected per environment at build time.
 * Priority: an explicit VITE_APP_TITLE, then the build-time default title.
 */
function resolveAppTitle(): string {
  const explicit = process.env.VITE_APP_TITLE?.trim();
  if (explicit) return explicit;
  return 'MiniCPM-OCR';
}

/**
 * html-app-title: replace the %VITE_APP_TITLE% placeholder in index.html with the title resolved at build time.
 * order: 'pre' runs before Vite’s built-in %ENV% replacement, so the result is determined in one place.
 */
function htmlAppTitlePlugin() {
  const title = resolveAppTitle();
  return {
    name: 'html-app-title',
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string) {
        return html.replace(/%VITE_APP_TITLE%/g, title);
      },
    },
  };
}

// Login-free demo: deployed on its own at the root path, and opens straight into the Playground.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return {
    base: '/',
    plugins: [
      react(),
      htmlAppTitlePlugin(),
      // PDF CJK font maps and decode assets are served from the same origin, so preview does not depend on a third-party CDN.
      viteStaticCopy({
        targets: ['cmaps', 'standard_fonts', 'wasm'].map((directory) => ({
          src: fileURLToPath(new URL(`./node_modules/pdfjs-dist/${directory}`, import.meta.url)),
          dest: 'pdfjs',
        })),
      }),
    ],
    resolve: {
      alias: {
        '@': srcDir,
      },
    },
    server: {
      proxy: {
        '/api/document-parse': {
          target: process.env.VITE_OCR_TARGET ?? 'http://127.0.0.1:8966',
          changeOrigin: true,
        },
        '/api/image-parse': {
          target: process.env.VITE_OCR_TARGET ?? 'http://127.0.0.1:8966',
          changeOrigin: true,
        },
        '/api/kie': {
          target: process.env.VITE_OCR_TARGET ?? 'http://127.0.0.1:8966',
          changeOrigin: true,
        },
        '/v1': {
          target: process.env.VITE_OCR_TARGET ?? 'http://127.0.0.1:8966',
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      port: 10111,
      proxy: {
        '/api/document-parse': {
          target: process.env.VITE_OCR_TARGET ?? 'http://127.0.0.1:8966',
          changeOrigin: true,
        },
        '/api/image-parse': {
          target: process.env.VITE_OCR_TARGET ?? 'http://127.0.0.1:8966',
          changeOrigin: true,
        },
        '/api/kie': {
          target: process.env.VITE_OCR_TARGET ?? 'http://127.0.0.1:8966',
          changeOrigin: true,
        },
        '/v1': {
          target: process.env.VITE_OCR_TARGET ?? 'http://127.0.0.1:8966',
          changeOrigin: true,
        },
      },
    },
    build: {
      modulePreload: false,
      target: 'esnext',
      minify: 'esbuild',
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          // Split third-party dependencies by hand: the stable runtime (the React family) and the heavy chart library (recharts)
          // each become their own chunk, which improves long-term cache hits and can download in parallel with app chunks.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            // recharts and its d3-* / victory-* dependencies are large and only the chart pages use them, so they get their own chunk.
            if (/[\\/]node_modules[\\/](recharts|d3-|victory-|internmap|decimal\.js)/.test(id)) {
              return 'chart-vendor';
            }
            // The three React runtime packages share one chunk, so initialization order does not break across chunks.
            if (
              /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
                id,
              )
            ) {
              return 'react-vendor';
            }
            // The server-state library stands alone, so it can be cached separately.
            if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) {
              return 'query-vendor';
            }
            return undefined;
          },
        },
      },
    },
  };
});
