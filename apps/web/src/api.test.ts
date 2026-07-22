import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, fetchApi, postApi, putApi } from "./api.js";

afterEach(() => vi.restoreAllMocks());

describe("web API client", () => {
  it("returns envelope data and preserves POST input", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true }, meta: {} }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "task-1" }, meta: {} }), { status: 200 }),
      );

    await expect(fetchApi<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
    await expect(postApi("/api/tasks", { title: "Safe task" })).resolves.toEqual({ id: "task-1" });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "Safe task" }),
    });
  });

  it("throws structured errors for failed responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Reviewer required" } }), {
        status: 403,
      }),
    );

    const error = await putApi("/api/policy", {}).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", message: "Reviewer required" });
  });
});
