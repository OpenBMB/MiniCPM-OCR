/**
 * 引用来源站点图标。
 *
 * 用途：统一来源列表、引用标签、过程时间线、来源胶囊和预览浮层的 favicon 加载与失败回退。
 */

import { useState } from 'react';
import { Globe2 } from 'lucide-react';

import { cn } from '@map/ui';

import { citationFavicon } from '../utils/citations';

/*
  失败记录必须是模块级的：同一个站点在一条消息里会同时出现在工具行、来源胶囊、抽屉和
  hover 卡上，失败态若只存在组件内，没有根路径 favicon.ico 的站点每处都要各自失败一次。
  只记失败不记成功——成功的图片由浏览器 HTTP 缓存兜住，这里不需要再存一份。
*/
const failedFavicons = new Set<string>();

interface CitationFaviconProps {
  /** 来源地址。 */
  url: string;
  /** 图标容器样式。 */
  className?: string;
  /** 图片样式。 */
  imageClassName?: string;
}

/**
 * 显示来源 favicon；加载失败或 URL 无效时显示通用网页图标。
 * @param url 来源地址
 * @param className 图标容器样式
 * @param imageClassName 图片样式
 * @returns 来源站点图标
 */
export function CitationFavicon({ url, className, imageClassName }: CitationFaviconProps) {
  const favicon = citationFavicon(url);
  // 初值读缓存，让后挂载的同域图标直接走兜底图标，不再发一次注定失败的请求
  const [failed, setFailed] = useState(() => (favicon ? failedFavicons.has(favicon) : false));
  const broken = failed || (favicon ? failedFavicons.has(favicon) : false);

  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/40 bg-background/75',
        className,
      )}
    >
      {favicon && !broken ? (
        <img
          src={favicon}
          alt=""
          width={16}
          height={16}
          className={cn('size-4 object-contain', imageClassName)}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            failedFavicons.add(favicon);
            setFailed(true);
          }}
        />
      ) : (
        <Globe2 className="size-3.5 text-muted-foreground/80" aria-hidden="true" />
      )}
    </span>
  );
}
