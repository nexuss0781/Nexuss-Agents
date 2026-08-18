import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPortal, { getLoginProviderPath } from "./LoginPortal";

describe("login portal", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { search: "", assign: vi.fn() } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders both configured provider entry actions and its account-creation guidance", () => {
    const html = renderToStaticMarkup(<LoginPortal />);

    expect(html).toContain("Continue with Google");
    expect(html).toContain("Continue with GitHub");
    expect(html).toContain("First visit? Your workspace is created after you sign in.");
    expect(html).toContain("NEXUSS-AGENT");
  });

  it("surfaces safe configuration feedback when the server names a missing setting", () => {
    vi.stubGlobal("window", { location: { search: "?error=configuration&missing=JWT_SECRET", assign: vi.fn() } });

    const html = renderToStaticMarkup(<LoginPortal />);

    expect(html).toContain("Add JWT_SECRET in Render, then redeploy.");
  });

  it("keeps the Google and GitHub actions mapped to their established authentication routes", () => {
    expect(getLoginProviderPath("google")).toBe("/auth/google");
    expect(getLoginProviderPath("github")).toBe("/auth/github");
  });
});
