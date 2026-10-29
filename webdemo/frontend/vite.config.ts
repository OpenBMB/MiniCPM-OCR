import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/** 前端源码根目录，供 `@/` 路径别名解析 */
const srcDir = fileURLToPath(new URL('./src', import.meta.url));

/**
 * 解析站点静态标题（<title> 与 og:title），在构建期定死写入 index.html。
 * 链接预览爬虫不执行 JS、只读原始 HTML，故标题无法靠运行时 i18n 切换，必须在构建期按环境注入。
 * 优先级：显式 VITE_APP_TITLE > 构建期默认标题。
 */
function resolveAppTitle(): string {
  const explicit = process.env.VITE_APP_TITLE?.trim();
  if (explicit) return explicit;
  return 'MiniCPM-OCR';
}

/**
 * html-app-title：把 index.html 里的 %VITE_APP_TITLE% 占位替换为构建期解析出的标题。
 * order:'pre' 确保先于 Vite 内置的 %ENV% 替换执行，替换结果唯一确定。
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

// 免登录演示：独立部署在根路径，打开后直接进入 Playground。
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
      // PDF 的 CJK 字体映射与解码资源同源部署，预览不依赖第三方 CDN。
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
          // 手动拆分第三方依赖：稳定的运行时(react 全家桶)与重型可视化库(recharts)
          // 各自独立成 chunk，既提升长期缓存命中率，又能与业务 chunk 并行下载。
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            // recharts 及其依赖的 d3-* / victory-* 体积大且仅图表页用，单独成块
            if (/[\\/]node_modules[\\/](recharts|d3-|victory-|internmap|decimal\.js)/.test(id)) {
              return 'chart-vendor';
            }
            // React 运行时三件套放同一 chunk，避免跨块初始化顺序问题
            if (
              /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
                id,
              )
            ) {
              return 'react-vendor';
            }
            // 服务端状态库独立，便于单独缓存
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
