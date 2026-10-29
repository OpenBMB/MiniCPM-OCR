/**
 * 人机验证相关共享类型。
 *
 * 用途：portal 与 admin 登录页均使用同一套后端滑块验证契约，类型在此集中声明,
 * 避免两 app 各自重复定义导致字段漂移。
 */

/** 滑块人机验证题目（后端 snake_case 原样）。坐标系与图片原始尺寸 300×220 一致。 */
export interface CaptchaChallengeDTO {
  id: string;
  master_b64: string;
  tile_b64: string;
  tile_x: number;
  tile_y: number;
  tile_width: number;
  tile_height: number;
}
