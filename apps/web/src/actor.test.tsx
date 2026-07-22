import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ActorProvider, useActor } from "./actor.js";

function ActorHarness() {
  const { actorId, setActorId } = useActor();
  return (
    <div>
      <span>{actorId}</span>
      <button onClick={() => setActorId(" reviewer-one ")}>change</button>
      <button onClick={() => setActorId("   ")}>clear</button>
    </div>
  );
}

describe("ActorProvider", () => {
  it("restores, normalizes, and persists the local actor", async () => {
    localStorage.setItem("agentgitops.actorId", "owner-one");
    const user = userEvent.setup();
    render(
      <ActorProvider>
        <ActorHarness />
      </ActorProvider>,
    );

    expect(screen.getByText("owner-one")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "change" }));
    expect(screen.getByText("reviewer-one")).toBeInTheDocument();
    expect(localStorage.getItem("agentgitops.actorId")).toBe("reviewer-one");

    await user.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByText("local-user")).toBeInTheDocument();
  });
});
