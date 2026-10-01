/** Plan §4.5 (WS9 implements; WS2/WS4/WS5 consume). `packages/computer/fake` implements this with DOM fixtures for CI. */

export interface ComputerStatus {
  ready: boolean;
  detail?: string;
}

export interface ObservedElement {
  index: number;
  role: string;
  label: string;
  value?: string;
}

export interface Observation {
  url?: string;
  title?: string;
  screenshotPath?: string;
  elements: ObservedElement[];
  /** The page's readable text (whitespace collapsed, capped), for reading what a page says. */
  text?: string;
}

export type ActionOp =
  "click" | "type" | "key" | "scroll" | "select" | "navigate" | "wait" | "done" | "blocked";

/** `target` MUST be an observed element index (or `url` for `navigate`) — never a raw coordinate or an unobserved guess. */
export interface Action {
  op: ActionOp;
  target?: number;
  text?: string;
  url?: string;
}

export interface ActResult {
  ok: boolean;
  blocked?: boolean;
  reason?: string;
}

export interface Screen {
  observe(o?: { mode?: "dom" | "ax" | "ocr" | "auto" }): Promise<Observation>;
  act(a: Action): Promise<ActResult>;
  liveView(): Promise<{ url: string; token: string; expiresAt: string }>;
  takeover(on: boolean): Promise<void>;
}

/** What a command run inside the bots' machine printed and how it ended. */
export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Only the end of a long output is kept. */
  truncated: boolean;
}

export interface ComputerProvider {
  /** `'docker' | 'local' | 'fake'`. */
  id: string;
  status(): Promise<ComputerStatus>;
  ensureStarted(): Promise<void>;
  screen(botId: string): Promise<Screen>;
  /**
   * Runs a shell command inside the bots' machine (the shared workspace is the default working
   * directory). Only providers with their own machine have it: the virtual machine does, this
   * computer does not (D-033).
   */
  exec?(request: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
    stdin?: string;
  }): Promise<ExecResult>;
  /** Runs the machine's self-checks (the virtual machine has them; D-034). */
  diagnose?(): Promise<BoxDiagnostics>;
  /** A fresh machine that keeps files and sign-ins (the first recovery to try; D-034). */
  recreate?(): Promise<void>;
  /**
   * B5: a filtered DevTools endpoint (http URL) for a browser-automation connector to drive this
   * bot's browser in the machine. It cannot read sign-ins, storage or other sites' data.
   */
  browserEndpoint?(
    botId: string,
    options?: { allowHosts?: string[]; mode?: "read" | "act" },
  ): Promise<string>;
}

/** One self-check of the bots' machine: PASS/FAIL and what it found. */
export interface BoxCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** The machine's self-checks, its screens' processes and its latest telemetry (D-034). */
export interface BoxDiagnostics {
  ok: boolean;
  checks: BoxCheck[];
  screens: Array<{
    botId: string;
    display: number;
    components: Array<{
      name: string;
      up: boolean;
      restartsInWindow: number;
      crashloop: boolean;
      downReason?: string;
    }>;
  }>;
  /** The newest box telemetry events (component crashes, sign-in restores). */
  telemetry: Array<Record<string, unknown>>;
}

export interface ComputerTaskRequest {
  botId: string;
  chainId: string;
  goal: string;
  startUrl?: string;
  maxSteps?: number;
  provider?: string;
}

export interface ComputerTaskResult {
  status: "completed" | "failed" | "escalated";
  steps: number;
  usd: number;
  summary?: string;
}

export interface ComputerAgent {
  runTask(t: ComputerTaskRequest): Promise<ComputerTaskResult>;
}

/** Plan §4.7 addendum: the docker provider's desktop image, distinct from container/task status (D-020). */
export type ComputerImageState = "missing" | "pulling" | "building" | "ready" | "error";

export interface ComputerImageStatus {
  state: ComputerImageState;
  tag: string;
  source?: "registry" | "local";
  detail?: string;
  localBuildAvailable: boolean;
}

/** `packages/computer/docker`'s `ImageManager` implements this; `CoreContext.computerImageManager` (core routes only depend on this shape, never the docker package). */
export interface ComputerImageManager {
  getStatus(): ComputerImageStatus;
  isBusy(): boolean;
  refresh(): Promise<ComputerImageStatus>;
  get(source?: "registry" | "local"): Promise<ComputerImageStatus>;
  reset(removeImage?: boolean): Promise<ComputerImageStatus>;
}
