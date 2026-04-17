import { useEffect, useRef } from "react";

export function useSSE<T>(
  url: string,
  onMessage: (data: T) => void,
  enabled = true,
) {
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        cbRef.current(JSON.parse(e.data));
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [url, enabled]);
}
