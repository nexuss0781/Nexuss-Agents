# Right Window Extensions

The workspace exposes a small extension surface for tools that need to stay visible beside the conversation. A Git browser, terminal, web preview, or another tool can register a window and receive an imperative controller for opening, closing, resizing, and declaring its minimum usable width.

## The contract

The API lives in `client/src/lib/rightWindowExtensions.ts`.

| Type | Purpose |
| --- | --- |
| `RightWindowExtension` | Describes a tool that can render inside the right window. |
| `RightWindowApi` | Controls the window from an extension or its UI. |
| `RightWindowState` | Describes the current open state, width, minimum width, and active extension. |

An extension must provide a unique `id`, an `icon`, a concise `name`, and a `render(api)` function. It may provide `description`, `defaultWidth`, and `minWidth`. The `name` is the launcher’s short app name; the launcher keeps it on one line and truncates it with an ellipsis when the responsive grid cell is narrow.

## Registering an extension

```tsx
import { registerRightWindowExtension } from "@/lib/rightWindowExtensions";

const unregister = registerRightWindowExtension({
  id: "terminal",
  name: "Terminal",
  icon: <TerminalIcon size={20} />,
  description: "Run commands beside the active conversation.",
  defaultWidth: 520,
  minWidth: 360,
  render: (api) => (
    <section>
      <h2>Terminal</h2>
      <button onClick={() => api.setWidth(680)}>Widen</button>
      <button onClick={api.close}>Close</button>
    </section>
  ),
});

// Call unregister when the host feature is removed or unloaded.
```

Registration is intentionally synchronous and local to the client. Duplicate IDs are rejected so a tool cannot silently replace another tool. The host can later attach a dynamic loader or capability permission layer without changing the extension render contract.

## Controlling the window

The controller exposes the following methods.

| Method | Behavior |
| --- | --- |
| `open(extensionId?)` | Opens the window and optionally selects an extension. Without an ID, the first registered extension is selected. |
| `close()` | Closes the window while retaining the selected extension. |
| `toggle(extensionId?)` | Opens or closes the window. When opening, it selects the requested extension. |
| `setWidth(width)` | Sets the width in pixels, clamped to the active minimum and the available viewport. |
| `setMinWidth(minWidth)` | Raises or lowers the active minimum, with a safe host floor. The current width is expanded if required. |
| `getState()` | Returns the current window state. |

The user can always resize the panel by dragging the narrow rail on its left edge. The host enforces the extension minimum during that gesture and during programmatic calls, so an extension cannot collapse below its declared usable size.

## Design and behavior rules

Extensions should render a self-contained tool surface and keep destructive actions explicit. They should use the existing workspace tokens and avoid taking over the full viewport. The host provides the header, close control, active extension title, app-icon launcher, back navigation, and resizing rail; the extension owns its internal content. Selecting an app icon opens that extension in the same right window.

The launcher is intentionally a clean host surface until the first real tools are registered. Future tools appear as app icons without changing the main conversation layout.

## Example: open from a host control

```tsx
const api: RightWindowApi = /* supplied by the host */;

api.open("terminal");
api.setMinWidth(420);
api.setWidth(560);
```

The API is deliberately small: registration describes what the tool is, while the host retains layout ownership and applies the final size constraints.
