/**
 * 音频设备枚举 Hook。
 *
 * 用途：为「实时语音」提供麦克风/扬声器设备列表与刷新（对齐 MiniCPM-o demo 的设备选择）。
 * 挂载即自动枚举一次，并监听设备热插拔自动刷新；仍暴露 refresh 供「刷新设备」按钮与
 * 通话授权后补全 label 调用。设备 label 需在麦克风授权后才完整可见（浏览器隐私限制）。
 */

import { useCallback, useEffect, useState } from 'react';

/** 设备项 */
export interface DeviceOption {
  id: string;
  label: string;
}

/**
 * 枚举音频输入/输出设备。
 */
export function useDevices() {
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [speakers, setSpeakers] = useState<DeviceOption[]>([]);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      // 过滤浏览器的 default/communications 别名项：它们语义即「系统默认」，与下拉里手写的
      // 「系统默认」(value=default) 重复，且 deviceId 固定，会撞车导致选项重复、标签拼接
      const real = (kind: MediaDeviceKind) =>
        list.filter(
          (d) =>
            d.kind === kind &&
            d.deviceId &&
            d.deviceId !== 'default' &&
            d.deviceId !== 'communications',
        );
      setMics(
        real('audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `麦克风 ${i + 1}` })),
      );
      setSpeakers(
        real('audiooutput').map((d, i) => ({
          id: d.deviceId,
          label: d.label || `扬声器 ${i + 1}`,
        })),
      );
    } catch {
      // 枚举失败静默降级
    }
  }, []);

  // 挂载即自动枚举一次，并监听热插拔自动刷新（enumerate 不申请权限，未授权时 label 退化为占位名）。
  // refresh 是异步的，setState 发生在 await 之后（非渲染同步阶段），不会引发级联渲染，故此处豁免规则。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return undefined;
    md.addEventListener('devicechange', refresh);
    return () => md.removeEventListener('devicechange', refresh);
  }, [refresh]);

  return { mics, speakers, refresh };
}
