/** Renderer-facing API exposed through preload `contextBridge`. */
export interface OpenbotDesktopApi {
  /** `process.platform`, so the UI can make room for macOS window controls. */
  platform: string;
  getHarnessStatus(): Promise<string>;
  /** D-036: this install's owner key for the app's own window (undefined until the harness made it). */
  getLocalOwnerKey(): string | undefined;
  getLocalComputerPermissions(): Promise<LocalComputerPermissionStatus>;
  onNavigate(callback: (target: DeepLinkTarget) => void): () => void;
}

export interface DeepLinkTarget {
  kind: "thread" | "setup" | "home" | "settings";
  threadId?: string;
}

export interface LocalComputerPermissionStatus {
  screenRecording?: "granted" | "denied" | "restricted" | "unknown" | "not-determined";
  accessibilityTrusted?: boolean;
  waylandNote?: string;
}
