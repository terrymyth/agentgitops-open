import { useEffect, useMemo, useState } from "react";

export type EventStreamStatus = "connecting" | "open" | "error" | "closed";

export interface EventStreamState {
  status: EventStreamStatus;
  lastEvent?: {
    name: string;
    at: string;
  };
}

export function useEventStream(
  eventNames: string[],
  onEvent: (eventName: string) => void,
): EventStreamState {
  const [state, setState] = useState<EventStreamState>({ status: "connecting" });
  const namesKey = useMemo(() => eventNames.join("|"), [eventNames]);

  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    const names = namesKey.split("|").filter(Boolean);

    source.onopen = () => {
      setState((current) => ({ ...current, status: "open" }));
    };
    source.onerror = () => {
      setState((current) => ({ ...current, status: "error" }));
    };

    const listeners = names.map((name) => {
      const listener = () => {
        setState({ status: "open", lastEvent: { name, at: new Date().toISOString() } });
        onEvent(name);
      };
      source.addEventListener(name, listener);
      return { name, listener };
    });

    return () => {
      for (const { name, listener } of listeners) {
        source.removeEventListener(name, listener);
      }
      source.close();
      setState((current) => ({ ...current, status: "closed" }));
    };
  }, [namesKey, onEvent]);

  return state;
}
