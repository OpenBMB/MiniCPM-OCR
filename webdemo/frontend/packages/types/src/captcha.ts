/**
 * Shared captcha types.
 *
 * Purpose: the portal and admin login pages share one backend slide-captcha contract, so the types are declared here
 * to avoid field drift from defining them separately in each app.
 */

/** Slide captcha challenge (backend snake_case, unchanged). The coordinate system matches the original image size of 300×220. */
export interface CaptchaChallengeDTO {
  id: string;
  master_b64: string;
  tile_b64: string;
  tile_x: number;
  tile_y: number;
  tile_width: number;
  tile_height: number;
}
