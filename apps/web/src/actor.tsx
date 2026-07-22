import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ActorContextValue {
  actorId: string;
  setActorId: (actorId: string) => void;
}

const ActorContext = createContext<ActorContextValue | null>(null);

export function ActorProvider({ children }: { children: ReactNode }) {
  const [actorId, setActorIdState] = useState(
    () => localStorage.getItem("agentgitops.actorId") || "local-user",
  );

  useEffect(() => {
    localStorage.setItem("agentgitops.actorId", actorId);
  }, [actorId]);

  const value = useMemo(
    () => ({
      actorId,
      setActorId: (next: string) => setActorIdState(next.trim() || "local-user"),
    }),
    [actorId],
  );

  return <ActorContext.Provider value={value}>{children}</ActorContext.Provider>;
}

export function useActor(): ActorContextValue {
  const context = useContext(ActorContext);
  if (!context) throw new Error("useActor must be used within ActorProvider");
  return context;
}
