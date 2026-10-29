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
 * Probe backend pipeline capabilities. Request only when the user and the document-parsing model are ready; tests and users without permission
 * do not change existing workspace behavior because of one extra network request.
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
