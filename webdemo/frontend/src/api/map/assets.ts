import { mapUpload } from './request';

export interface UploadedAsset {
  url: string;
  proxy_url?: string;
  public_url?: string;
  obs_url?: string;
  bucket: string;
  key: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  name: string;
  mime: string;
  size: number;
  environment: 'dev' | 'prod';
}

export const mapAssetsApi = {
  upload(file: File, signal?: AbortSignal): Promise<UploadedAsset> {
    const form = new FormData();
    form.append('file', file);
    return mapUpload<UploadedAsset>('/assets/upload', form, {}, signal);
  },
};
