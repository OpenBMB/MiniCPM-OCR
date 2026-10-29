/**
 * 双工对话记录（纯列表）。
 *
 * 用途：展示语音对话的文字气泡，每轮回复后加「本轮结束」分隔（借鉴 MiniCPM-o Omni
 * Conversation）。无外层卡片与标题，供「查看记录」弹窗或其他容器包裹复用。纯展示组件。
 */

import type { SessionMetrics } from '../../utils/realtimeSessionMetrics';
import type { VoiceEvent, VoiceMessage } from '../../hooks/useRealtimeSession';
import { useTranslation } from 'react-i18next';

/**
 * 对话记录列表。
 */
export function DuplexConversation({
  messages,
  events = [],
  metrics,
}: {
  messages: VoiceMessage[];
  events?: VoiceEvent[];
  metrics?: SessionMetrics;
}) {
  const { t } = useTranslation('playground');
  if (messages.length === 0 && events.length === 0) {
    return (
      <p className="rounded-xl bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground/60">
        {t('callTranscriptEmpty')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {metrics && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground sm:grid-cols-4">
          <span>
            {t('session')} <b className="font-medium text-foreground">{metrics.sessionId}</b>
          </span>
          <span>
            {t('metricChunks')} <b className="font-medium text-foreground">{metrics.chunks}</b>
          </span>
          <span>
            {t('metricVision')} <b className="font-medium text-foreground">{metrics.vision}</b>
          </span>
          <span>
            {t('metricTtfs')}{' '}
            <b className="font-medium text-foreground">
              {metrics.ttfsMs == null ? '-' : `${metrics.ttfsMs}ms`}
            </b>
          </span>
        </div>
      )}
      {events.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-border/50 px-3 py-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-2 text-[11px] text-muted-foreground"
            >
              <span className="font-mono text-[10px] text-muted-foreground/60">
                {new Date(event.at).toLocaleTimeString()}
              </span>
              <span>{event.label}</span>
              {event.detail && (
                <span className="truncate text-muted-foreground/60">{event.detail}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {messages.map((m) => (
          <div key={m.id}>
            <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <span
                className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                {m.text}
              </span>
            </div>
            {m.role === 'assistant' && (
              <div className="my-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/50">
                <span className="h-px flex-1 bg-border/60" />
                {t('sessionEnd')}
                <span className="h-px flex-1 bg-border/60" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
