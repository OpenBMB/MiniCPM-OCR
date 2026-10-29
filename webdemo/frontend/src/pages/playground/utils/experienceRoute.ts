/**
 * 体验中心 URL 与可见模型之间的路由收敛。
 *
 * 用途：把 `/playground/:experience` 收敛为合法体验键。语音合成 / 实时语音在对应
 * 可见模型为空时回退语言模型，避免直达 URL 停在空白页。
 */

/** 体验中心可切换的体验类型 */
export type ExperienceKey = 'language' | 'tts' | 'duplex' | 'image-parse' | 'field-extract';

/**
 * URL 体验段到内部体验键的映射。
 * `document-parse` 是对外规范路径，`image-parse` 仅保留为历史书签兼容入口。
 */
const EXPERIENCE_PARAMS: Record<string, ExperienceKey> = {
  tts: 'tts',
  duplex: 'duplex',
  'document-parse': 'image-parse',
  'image-parse': 'image-parse',
  'field-extract': 'field-extract',
};

/** 非语言体验是否对当前用户可见（由对应模型列表是否为空决定） */
export type ExperienceAvailability = {
  tts: boolean;
  duplex: boolean;
  'image-parse': boolean;
};

/**
 * 把 URL 参数收敛为合法体验键（非法/缺省回退语言模型）。
 * @param param 路由参数
 */
export function normalizeExperience(param?: string): ExperienceKey {
  return (param ? EXPERIENCE_PARAMS[param] : undefined) ?? 'language';
}

/**
 * 按当前用户可见模型收敛体验键。
 * 语音合成 / 实时语音 / 文档解析无可见模型时回退语言模型。
 * @param experience URL 收敛出的体验键
 * @param loading 模型列表是否仍在加载（加载期间不回退，避免闪跳）
 * @param available 各非语言体验是否有可见模型
 */
export function resolveExperience(
  experience: ExperienceKey,
  loading: boolean,
  available: ExperienceAvailability,
): ExperienceKey {
  if (loading || experience === 'language') return experience;
  if (available[experience === 'field-extract' ? 'image-parse' : experience]) return experience;
  return 'language';
}

/** 判断是否使用文档工作台，字段提取与全文识别共享模型权限及外壳。 */
export function isDocumentExperience(experience: ExperienceKey): boolean {
  return experience === 'image-parse' || experience === 'field-extract';
}

/**
 * 体验入口路径：语言模型落在 `/playground`，其余带体验段。
 * @param key 体验键
 */
export function experiencePath(key: ExperienceKey): string {
  if (key === 'language') return '/playground';
  if (key === 'image-parse') return '/playground/document-parse';
  return `/playground/${key}`;
}

/**
 * 返回体验对应的文档路径。
 * @param experience 当前体验键
 */
export function experienceDocsPath(experience: ExperienceKey): string {
  if (experience === 'tts') return '/docs/models/speech';
  if (experience === 'duplex') return '/docs/models/full-duplex';
  if (experience === 'image-parse') return '/docs/api/document-parse';
  if (experience === 'field-extract') return '/docs/api/kie';
  return '/docs/models/text';
}

/** 非语言体验顶栏所需的文案键（图标由页面按键装配，避免 util 引入 React）。 */
export interface ExperienceChromeCopy {
  titleKey: 'ttsExperienceTitle' | 'duplexExperienceTitle' | 'imageParseExperienceTitle';
  subtitleKey:
    | 'ttsExperienceSubtitle'
    | 'duplexExperienceSubtitle'
    | 'imageParseExperienceSubtitle';
}

/**
 * 非语言体验顶栏文案键。语言对话走独立顶栏，不经过这里。
 * @param experience 当前体验键
 */
export function experienceChromeCopy(experience: ExperienceKey): ExperienceChromeCopy {
  if (experience === 'tts') {
    return { titleKey: 'ttsExperienceTitle', subtitleKey: 'ttsExperienceSubtitle' };
  }
  if (isDocumentExperience(experience)) {
    return { titleKey: 'imageParseExperienceTitle', subtitleKey: 'imageParseExperienceSubtitle' };
  }
  return { titleKey: 'duplexExperienceTitle', subtitleKey: 'duplexExperienceSubtitle' };
}
