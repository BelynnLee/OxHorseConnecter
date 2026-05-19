import { useEffect, useRef, useState } from 'react';
import {
  getTaskStreamUrl,
  type TaskStreamEnvelope,
} from '../api.ts';

export type SSEConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting';

export interface PartialTextPayload {
  taskId: string;
  text: string;
  isFinal: boolean;
  turnId?: string;
  sentAt: string;
}

interface UseSSEOptions {
  taskId?: string;
  onMessage: (envelope: TaskStreamEnvelope) => void;
  onPartialText?: (payload: PartialTextPayload) => void;
  onError?: () => void;
  reconnectDelayMs?: number;
  inactivityTimeoutMs?: number;
}

interface HeartbeatPayload {
  sentAt?: string;
}

export function useSSE({
  taskId,
  onMessage,
  onPartialText,
  onError,
  reconnectDelayMs = 3_000,
  inactivityTimeoutMs = 60_000,
}: UseSSEOptions): SSEConnectionState {
  const [connectionState, setConnectionState] = useState<SSEConnectionState>(
    taskId ? 'connecting' : 'idle',
  );
  const streamRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const lastEventIdRef = useRef<string>('0');
  const lastActivityAtRef = useRef<number>(Date.now());
  const onMessageRef = useRef(onMessage);
  const onPartialTextRef = useRef(onPartialText);
  const onErrorRef = useRef(onError);
  const manualCloseRef = useRef(false);

  onMessageRef.current = onMessage;
  onPartialTextRef.current = onPartialText;
  onErrorRef.current = onError;

  useEffect(() => {
    lastEventIdRef.current = '0';
    lastActivityAtRef.current = Date.now();
    setConnectionState(taskId ? 'connecting' : 'idle');
  }, [taskId]);

  useEffect(() => {
    if (!taskId) {
      return undefined;
    }
    const activeTaskId = taskId;

    manualCloseRef.current = false;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function closeStream() {
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
    }

    function scheduleReconnect() {
      clearReconnectTimer();
      setConnectionState('reconnecting');
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, reconnectDelayMs);
    }

    function markActivity(eventId?: string) {
      if (eventId) {
        lastEventIdRef.current = eventId;
      }
      lastActivityAtRef.current = Date.now();
    }

    function connect() {
      if (manualCloseRef.current) {
        return;
      }

      closeStream();
      setConnectionState(lastEventIdRef.current !== '0' ? 'reconnecting' : 'connecting');

      const stream = new EventSource(
        getTaskStreamUrl(
          activeTaskId,
          lastEventIdRef.current !== '0' ? lastEventIdRef.current : undefined,
        ),
        { withCredentials: true },
      );

      streamRef.current = stream;

      const handleHeartbeat = (event: Event) => {
        const message = event as MessageEvent<string>;
        try {
          const payload = JSON.parse(message.data) as HeartbeatPayload;
          markActivity(typeof payload.sentAt === 'string' ? message.lastEventId : undefined);
        } catch {
          markActivity(message.lastEventId);
        }
      };

      const handlePartial = (event: Event) => {
        const message = event as MessageEvent<string>;
        markActivity();
        try {
          const payload = JSON.parse(message.data) as PartialTextPayload;
          onPartialTextRef.current?.(payload);
        } catch {
          // ignore malformed partial events
        }
      };

      stream.onopen = () => {
        markActivity();
        setConnectionState('open');
      };

      stream.onmessage = (message) => {
        try {
          const envelope = JSON.parse(message.data) as TaskStreamEnvelope;
          markActivity(message.lastEventId);
          onMessageRef.current(envelope);
        } catch {
          markActivity(message.lastEventId);
        }
      };

      stream.addEventListener('heartbeat', handleHeartbeat);
      stream.addEventListener('partial', handlePartial);

      stream.onerror = () => {
        stream.removeEventListener('heartbeat', handleHeartbeat);
        stream.removeEventListener('partial', handlePartial);
        closeStream();
        if (manualCloseRef.current) {
          return;
        }

        onErrorRef.current?.();
        scheduleReconnect();
      };
    }

    connect();

    watchdogTimerRef.current = window.setInterval(() => {
      if (manualCloseRef.current || !streamRef.current) {
        return;
      }

      if (Date.now() - lastActivityAtRef.current >= inactivityTimeoutMs) {
        closeStream();
        scheduleReconnect();
      }
    }, 15_000);

    return () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      if (watchdogTimerRef.current != null) {
        window.clearInterval(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      closeStream();
    };
  }, [inactivityTimeoutMs, reconnectDelayMs, taskId]);

  return connectionState;
}
