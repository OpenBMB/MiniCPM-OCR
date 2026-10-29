/**
 * Route resolution between experience-center URLs and visible models.
 *
 * Purpose: collapse `/playground/:experience` to a legal experience key. Speech synthesis and realtime voice fall back
 * to the language model when their visible model list is empty, so a direct URL does not sit on a blank page.
 */

/** Experience types the experience center can switch among */
export type ExperienceKey = 'language' | 'tts' | 'duplex' | 'image-parse' | 'field-extract';

/**
 * Map a URL experience segment to an internal experience key.
 * `document-parse` is the public canonical path; `image-parse` remains only as a compatibility entry for old bookmarks.
 */
const EXPERIENCE_PARAMS: Record<string, ExperienceKey> = {
  tts: 'tts',
  duplex: 'duplex',
  'document-parse': 'image-parse',
  'image-parse': 'image-parse',
  'field-extract': 'field-extract',
};

/** Whether a non-language experience is visible to the current user (decided by whether the matching model list is empty) */
export type ExperienceAvailability = {
  tts: boolean;
  duplex: boolean;
  'image-parse': boolean;
};

/**
 * Collapse URL parameters to a legal experience key (illegal or missing falls back to the language model).
 * @param param route parameter
 */
export function normalizeExperience(param?: string): ExperienceKey {
  return (param ? EXPERIENCE_PARAMS[param] : undefined) ?? 'language';
}

/**
 * Collapse the experience key by the models visible to the current user.
 * Speech synthesis, realtime voice, and document parsing fall back to the language model when no model is visible.
 * @param experience experience key resolved from the URL
 * @param loading whether the model list is still loading (do not fall back while loading, to avoid a flicker)
 * @param available whether each non-language experience has a visible model
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

/** Whether to use the document workspace; field extraction and full-text recognition share model permission and the shell. */
export function isDocumentExperience(experience: ExperienceKey): boolean {
  return experience === 'image-parse' || experience === 'field-extract';
}

/**
 * Experience entry path: the language model lives at `/playground`; the others carry an experience segment.
 * @param key experience key
 */
export function experiencePath(key: ExperienceKey): string {
  if (key === 'language') return '/playground';
  if (key === 'image-parse') return '/playground/document-parse';
  return `/playground/${key}`;
}

/**
 * Return the document path for an experience.
 * @param experience current experience key
 */
export function experienceDocsPath(experience: ExperienceKey): string {
  if (experience === 'tts') return '/docs/models/speech';
  if (experience === 'duplex') return '/docs/models/full-duplex';
  if (experience === 'image-parse') return '/docs/api/document-parse';
  if (experience === 'field-extract') return '/docs/api/kie';
  return '/docs/models/text';
}

/** Copy keys the non-language experience top bar needs (the icon is assembled by the page from the key, so the util does not import React). */
export interface ExperienceChromeCopy {
  titleKey: 'ttsExperienceTitle' | 'duplexExperienceTitle' | 'imageParseExperienceTitle';
  subtitleKey:
    | 'ttsExperienceSubtitle'
    | 'duplexExperienceSubtitle'
    | 'imageParseExperienceSubtitle';
}

/**
 * Top-bar copy keys for a non-language experience. Language chat uses its own top bar and does not come through here.
 * @param experience current experience key
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
