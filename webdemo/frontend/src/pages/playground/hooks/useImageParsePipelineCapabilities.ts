import { useQuery } from '@tanstack/react-query';

import {
  loadImageParsePipelineCapabilities,
  type ImageParsePipelineCapabilities,
} from '@/api/map/imageParsePipeline';

const UNAVAILABLE: ImageParsePipelineCapabilities = {
  enabled: false,
  modes: [],
  seal: false,
  kie: false,
  upright: true,
};

/**
 * 探测后端流水线能力。仅在用户与文档解析模型就绪时请求，测试和无权限用户
 * 不会因为多一次网络请求改变原有工作台行为。
 */
export function useImageParsePipelineCapabilities(enabled: boolean): ImageParsePipelineCapabilities {
  const query = useQuery({
    queryKey: ['image-parse', 'pipeline-capabilities'],
    queryFn: ({ signal }) => loadImageParsePipelineCapabilities(signal),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return enabled ? (query.data ?? UNAVAILABLE) : UNAVAILABLE;
}
