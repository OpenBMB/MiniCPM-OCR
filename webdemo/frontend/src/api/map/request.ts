import { getDemoUpload } from './demoStore';

/**
 * 免登录演示请求器。
 *
 * 文档解析页在浏览器里保留一份本地会话。解析请求发给本机工人，不发给云端。
 */

const TOKEN_KEY = 'map_token';
const DEMO_USER_ID = 'demo-user';
const DEMO_PROJECT_ID = 'demo-project';
const DEMO_TOKEN = `demo.${btoa(JSON.stringify({ sub: DEMO_USER_ID }))}.demo`;

if (!localStorage.getItem(TOKEN_KEY)) {
  localStorage.setItem(TOKEN_KEY, DEMO_TOKEN);
}

const DEMO_MODEL = {
  id: 'minicpm-ocr',
  display_name: 'MiniCPM OCR',
  context_window: 112000,
  max_output_tokens: 4096,
  capabilities: {
    document_parse: true,
    input_image: true,
    input_text: false,
  },
  protocols: ['document_parse' as const],
  is_free: true,
};

const DEMO_USER = {
  id: DEMO_USER_ID,
  email: 'local@localhost',
  phone: '',
  username: 'demo-user',
  name: 'Demo User',
  org_type: 'personal',
  org_status: 'active' as const,
  account_enabled: true,
  role: 'external_owner',
  platform_role: 'user',
  default_project_id: DEMO_PROJECT_ID,
  email_verified: true,
  phone_verified: true,
  has_password: true,
  phone_binding_required: false,
};

const DEMO_KEY = {
  id: 'demo-key',
  project_id: DEMO_PROJECT_ID,
  project_name: 'Demo Project',
  name: 'Demo Key',
  prefix: 'demo-',
  status: 'active',
  created_at: '2026-10-28T00:00:00Z',
};

const DEMO_TRIAL = {
  remaining: {
    language: 10,
    tts: 10,
    realtime: 10,
    'image-parse': 10,
  },
  api_key_id: 'demo-trial-key',
  project_id: DEMO_PROJECT_ID,
  secret: 'demo-trial-secret',
};

interface DemoBlock {
  label: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

interface DemoOcrResponse {
  metadata: { page_index: number };
  choices: { message: { content: string } }[];
  ocr: {
    request_id: string;
    mode: 'ocr_only' | 'kie';
    image_width: number;
    image_height: number;
    blocks: unknown[];
  };
}

interface DemoJob {
  id: string;
  task: 'standard' | 'kie';
  status: 'Running' | 'Success';
  pages_done: number;
  pages_total: number;
  pages: DemoOcrResponse[];
}

interface DemoHistoryEntry {
  id: string;
  createdAt: number;
  snapshot: Record<string, unknown>;
}

const jobs = new Map<string, DemoJob>();
const historyEntries = new Map<string, DemoHistoryEntry>();
let jobSequence = 0;
let historySequence = 0;

function parseBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') return {};
  try {
    const value: unknown = JSON.parse(init.body);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizePath(path: string): string {
  return new URL(path, window.location.origin).pathname;
}

function query(path: string): URLSearchParams {
  return new URL(path, window.location.origin).searchParams;
}

function pixelBlocks(blocks: readonly DemoBlock[]): unknown[] {
  const width = 1000;
  const height = 1400;
  return blocks.map((block, index) => ({
    order: index,
    label: block.label,
    bbox: [
      Math.round(block.x * width),
      Math.round(block.y * height),
      Math.round((block.x + block.w) * width),
      Math.round((block.y + block.h) * height),
    ],
    content: block.text,
    status: 'ok',
    score: block.score,
  }));
}

const STANDARD_BLOCKS: readonly DemoBlock[] = [
  {
    label: 'doc_title',
    text: 'ModelBest 图片文档解析',
    x: 0.08,
    y: 0.08,
    w: 0.84,
    h: 0.08,
    score: 0.994,
  },
  {
    label: 'paragraph_title',
    text: '一、识别结果',
    x: 0.08,
    y: 0.2,
    w: 0.32,
    h: 0.04,
    score: 0.991,
  },
  {
    label: 'paragraph',
    text: '当前演示直接进入 Playground，无需登录，也不依赖真实后端。页面保持当前 Portal 的文档工作台交互。',
    x: 0.08,
    y: 0.26,
    w: 0.84,
    h: 0.08,
    score: 0.989,
  },
  {
    label: 'paragraph_title',
    text: '二、费用明细',
    x: 0.08,
    y: 0.37,
    w: 0.32,
    h: 0.04,
    score: 0.992,
  },
  {
    label: 'table',
    text: [
      '| 项目 | 数量 | 单价 | 金额 |',
      '| --- | --- | --- | --- |',
      '| GPU 评测机时 | 12 | ¥80 | ¥960 |',
      '| 对象存储流量 | 1 | ¥36 | ¥36 |',
      '| 合计 |  |  | ¥996 |',
    ].join('\n'),
    x: 0.08,
    y: 0.43,
    w: 0.84,
    h: 0.18,
    score: 0.962,
  },
  {
    label: 'paragraph_title',
    text: '三、公式摘录',
    x: 0.08,
    y: 0.64,
    w: 0.32,
    h: 0.04,
    score: 0.99,
  },
  {
    label: 'display_formula',
    text: 'Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V',
    x: 0.08,
    y: 0.7,
    w: 0.84,
    h: 0.05,
    score: 0.912,
  },
  {
    label: 'paragraph_title',
    text: '四、待办',
    x: 0.08,
    y: 0.79,
    w: 0.22,
    h: 0.04,
    score: 0.993,
  },
  {
    label: 'list',
    text: '- 上传图片或 PDF 后自动识别',
    x: 0.08,
    y: 0.85,
    w: 0.62,
    h: 0.035,
    score: 0.974,
  },
  {
    label: 'list',
    text: '- 在预览和 Markdown 之间切换',
    x: 0.08,
    y: 0.895,
    w: 0.62,
    h: 0.035,
    score: 0.978,
  },
];

const KIE_TAXI_VALUES: Record<string, string> = {
  发票代码: '133025391507',
  发票号码: '48216790',
  日期: '2026-10-18',
  金额: '¥86.00',
};

const KIE_RESTAURANT_VALUES: Record<string, string> = {
  商户名称: '杭州湖畔小馆',
  日期: '2026-10-18',
  消费明细: '西湖醋鱼 ×1；龙井虾仁 ×1；莼菜汤 ×2',
  总金额: '¥370.00',
};

function kieValues(fields: readonly string[], upload?: File): Record<string, string> {
  const requested =
    fields.length > 0 ? fields : ['发票代码', '发票号码', '日期', '金额'];
  const name = upload?.name ?? '';
  const values = name.includes('出租车')
    ? KIE_TAXI_VALUES
    : name.includes('餐厅') || name.includes('小票')
      ? KIE_RESTAURANT_VALUES
      : {};
  return Object.fromEntries(
    requested.map((field, index) => [field, values[field] ?? `演示值 ${index + 1}`]),
  );
}

function ocrResponse(
  task: 'standard' | 'kie',
  fields: readonly string[],
  upload?: File,
  pageIndex = 0,
): DemoOcrResponse {
  const requestId = '0123456789abcdef0123456789abcdef';
  if (task === 'kie') {
    const markdown = JSON.stringify(kieValues(fields, upload), null, 2);
    return {
      metadata: { page_index: pageIndex },
      choices: [{ message: { content: markdown } }],
      ocr: {
        request_id: requestId,
        mode: 'kie',
        image_width: 1000,
        image_height: 1400,
        blocks: pixelBlocks([
          {
            label: 'text',
            text: markdown,
            x: 0.08,
            y: 0.12,
            w: 0.84,
            h: 0.76,
            score: 0.98,
          },
        ]),
      },
    };
  }

  const markdown = STANDARD_BLOCKS.map((block) => block.text).join('\n\n');
  return {
    metadata: { page_index: pageIndex },
    choices: [{ message: { content: markdown } }],
    ocr: {
      request_id: requestId,
      mode: 'ocr_only',
      image_width: 1000,
      image_height: 1400,
      blocks: pixelBlocks(STANDARD_BLOCKS),
    },
  };
}

function createJob(init: RequestInit): Promise<DemoJob> {
  const body = parseBody(init);
  const upload = getDemoUpload(typeof body.file_id === 'string' ? body.file_id : undefined);
  if (!upload) throw new Error('imageParseFileReferenceRequired');
  const form = new FormData();
  form.append('file', upload, upload.name || 'document');
  form.append('upright', body.upright === false ? 'false' : 'true');
  if (typeof body.page_index === 'number' && Number.isSafeInteger(body.page_index)) {
    form.append('page_index', String(body.page_index));
  }
  return postDocumentJob(form);
}

async function postDocumentJob(form: FormData): Promise<DemoJob> {
  const response = await fetch('/api/document-parse/jobs', { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : 'imageParseRequestFailed';
    throw new Error(message);
  }
  return payload as DemoJob;
}

async function readJob(id: string): Promise<DemoJob> {
  const response = await fetch(`/api/document-parse/jobs/${encodeURIComponent(id)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('imageParseInvalidResult');
  return payload as DemoJob;
}

function historySummary(entry: DemoHistoryEntry) {
  const snapshot = entry.snapshot as {
    attachment?: { id?: string; name?: string };
    mode?: string;
  };
  return {
    id: entry.id,
    attachmentId: snapshot.attachment?.id ?? '',
    name: snapshot.attachment?.name ?? '未命名文档',
    createdAt: entry.createdAt,
    ...(snapshot.mode ? { mode: snapshot.mode } : {}),
  };
}

function saveHistory(body: Record<string, unknown>, id?: string): unknown {
  const snapshot = body.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('imageParseHistoryInvalid');
  }
  historySequence += 1;
  const entryId = id ?? `demo-history-${historySequence}`;
  const entry: DemoHistoryEntry = {
    id: entryId,
    createdAt: Date.now(),
    snapshot: snapshot as Record<string, unknown>,
  };
  historyEntries.set(entryId, entry);
  return historySummary(entry);
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || DEMO_TOKEN;
}

export function getTokenSubject(): string {
  return DEMO_USER_ID;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.setItem(TOKEN_KEY, DEMO_TOKEN);
}

export function consumeAuthNotice(): string {
  return '';
}

export async function mapRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  init.signal?.throwIfAborted();
  const pathname = normalizePath(path);
  const method = (init.method ?? 'GET').toUpperCase();

  if (pathname === '/models') return { list: [DEMO_MODEL] } as T;
  if (pathname === '/me') return DEMO_USER as T;
  if (pathname === '/keys') return { list: [DEMO_KEY] } as T;
  if (pathname === '/playground/trial') return DEMO_TRIAL as T;
  if (pathname === '/conversations') {
    return { list: [], total: 0, page: 1, page_size: 20 } as T;
  }
  if (pathname === '/image-parse/capabilities') {
    return {
      pipeline: true,
      enabled: true,
      modes: ['standard', 'kie'],
      seal: true,
      kie: true,
      upright: true,
      cross_page_merge: false,
    } as T;
  }
  if (pathname === '/image-parse/jobs' && method === 'POST') {
    return (await createJob(init)) as T;
  }

  const jobMatch = /^\/image-parse\/jobs\/([^/]+)$/.exec(pathname);
  if (jobMatch) {
    if (method === 'DELETE') {
      const id = decodeURIComponent(jobMatch[1]);
      await fetch(`/api/document-parse/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
      return { status: 'cancelled' } as T;
    }
    return (await readJob(decodeURIComponent(jobMatch[1]))) as T;
  }

  if (pathname === '/image-parse/history') {
    if (method === 'POST') return saveHistory(parseBody(init)) as T;
    const task = query(path).get('task');
    const summaries = [...historyEntries.values()]
      .map(historySummary)
      .filter((summary) => !task || summary.mode === task);
    return { list: summaries, hasMore: false } as T;
  }

  const historyMatch = /^\/image-parse\/history\/([^/]+)$/.exec(pathname);
  if (historyMatch) {
    const id = decodeURIComponent(historyMatch[1]);
    if (method === 'DELETE') {
      historyEntries.delete(id);
      return { status: 'deleted' } as T;
    }
    if (method === 'PUT') return saveHistory(parseBody(init), id) as T;
    const entry = historyEntries.get(id);
    if (!entry) throw new Error('imageParseHistoryInvalid');
    return {
      id: entry.id,
      createdAt: entry.createdAt,
      snapshot: entry.snapshot,
    } as T;
  }

  return {} as T;
}

export async function mapUpload<T>(
  _path: string,
  _formData: FormData,
  _extraHeaders: HeadersInit = {},
  _signal?: AbortSignal,
): Promise<T> {
  return {} as T;
}

export async function mapDownload(_path: string, _filename: string): Promise<void> {
  // 免登录演示不提供远端下载接口。
}

export async function mapBlobUrl(_path: string): Promise<string> {
  return URL.createObjectURL(new Blob(['ModelBest OCR Demo'], { type: 'text/plain' }));
}
