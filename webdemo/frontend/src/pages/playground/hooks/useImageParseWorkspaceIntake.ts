import type { DocumentFileRules } from '../utils/documentUpload';
import { useImageParsePageDrop } from './useImageParsePageDrop';
import { useImageParseWorkspacePaste } from './useImageParseWorkspacePaste';

/**
 * 合并工作台页面级拖放与粘贴入口，统一使用当前识别档位的文件边界。
 * @param onFile 已通过校验的单文件回调
 * @param pasteEnabled 是否允许空白工作台接收粘贴
 * @param rules 当前档位的格式、数量与大小限制
 * @returns 页面拖放高亮状态与容器事件
 */
export function useImageParseWorkspaceIntake(
  onFile: (file: File) => void,
  pasteEnabled: boolean,
  rules?: DocumentFileRules,
) {
  const pageDrop = useImageParsePageDrop(onFile, rules);
  useImageParseWorkspacePaste(pasteEnabled, onFile, rules);
  return pageDrop;
}
