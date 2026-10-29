/**
 * Audio-device enumeration hook.
 *
 * Purpose: provide the microphone and speaker device list and a refresh for "realtime voice" (aligned with device selection in the MiniCPM-o demo).
 * Enumerate once on mount, and listen for hot-plug to refresh automatically; refresh is still exposed for the "refresh devices" button and for
 * filling in labels after the call is authorized. Device labels are fully visible only after microphone permission (a browser privacy limit).
 */

import { useCallback, useEffect, useState } from 'react';

/** One device item */
export interface DeviceOption {
  id: string;
  label: string;
}

/**
 * Enumerate audio input and output devices.
 */
export function useDevices() {
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [speakers, setSpeakers] = useState<DeviceOption[]>([]);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      // Filter the browser's default/communications alias items: they mean "system default", which duplicates the handwritten
      // "system default" (value=default) in the dropdown, and their deviceId is fixed, so they collide, duplicate options, and concatenate labels
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
      // Enumeration failure degrades silently
    }
  }, []);

  // Enumerate once on mount, and listen for hot-plug to refresh automatically (enumerate does not request permission; without permission, label falls back to a placeholder name).
  // refresh is async, and setState happens after await (not in the synchronous render phase), so it does not cause a cascading render; the rule is waived here.
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
