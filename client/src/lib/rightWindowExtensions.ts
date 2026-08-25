import type { ReactNode } from "react";

export type RightWindowState = {
  open: boolean;
  width: number;
  minWidth: number;
  activeExtensionId: string | null;
};

export type RightWindowApi = {
  open: (extensionId?: string) => void;
  close: () => void;
  toggle: (extensionId?: string) => void;
  setWidth: (width: number) => void;
  setMinWidth: (minWidth: number) => void;
  getState: () => RightWindowState;
};

export type RightWindowExtension = {
  id: string;
  label: string;
  description?: string;
  minWidth?: number;
  defaultWidth?: number;
  render: (api: RightWindowApi) => ReactNode;
};

const extensions = new Map<string, RightWindowExtension>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function registerRightWindowExtension(extension: RightWindowExtension) {
  if (extensions.has(extension.id)) {
    throw new Error(`Right-window extension already registered: ${extension.id}`);
  }
  extensions.set(extension.id, extension);
  notify();
  return () => {
    const removed = extensions.delete(extension.id);
    if (removed) notify();
    return removed;
  };
}

export function getRightWindowExtensions() {
  return Array.from(extensions.values());
}

export function subscribeRightWindowExtensions(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRightWindowExtension(id: string | null | undefined) {
  return id ? extensions.get(id) : undefined;
}
