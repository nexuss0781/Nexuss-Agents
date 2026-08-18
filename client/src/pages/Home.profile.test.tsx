import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import Home from "./Home";

describe("workspace account navigation", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => undefined,
      },
    });
  });

  it("renders the signed-in user's real account details in the workspace navigation", () => {
    const html = renderToStaticMarkup(
      <Home
        profileName="Tadi Ivhu"
        profileEmail="tadi@example.com"
        profileAvatarUrl="https://images.example.com/tadi.png"
        onSignOut={() => undefined}
      />,
    );

    expect(html).toContain("Tadi Ivhu");
    expect(html).toContain("tadi@example.com");
    expect(html).toContain("https://images.example.com/tadi.png");
    expect(html).toContain("Sign out");
  });
});
