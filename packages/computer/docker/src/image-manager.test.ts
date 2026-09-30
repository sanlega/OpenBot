import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComputerImageStatus } from "@openbot/contracts";
import { ImageManager, findLocalDockerfile, type DockerImageEngine } from "./image-manager.js";

describe("findLocalDockerfile", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("finds images/desktop/Dockerfile by walking up from a nested start directory", async () => {
    dir = await mkdtemp(join(tmpdir(), "openbot-checkout-"));
    await mkdir(join(dir, "images", "desktop"), { recursive: true });
    await writeFile(join(dir, "images", "desktop", "Dockerfile"), "FROM scratch\n");
    const nested = join(dir, "packages", "computer", "docker", "src");
    await mkdir(nested, { recursive: true });

    expect(findLocalDockerfile(nested)).toBe(join(dir, "images", "desktop", "Dockerfile"));
  });

  it("returns undefined when no Dockerfile is reachable (a packaged install)", async () => {
    dir = await mkdtemp(join(tmpdir(), "openbot-packaged-"));
    const nested = join(dir, "resources", "app");
    await mkdir(nested, { recursive: true });

    expect(findLocalDockerfile(nested)).toBeUndefined();
  });
});

function fakeDocker(overrides: Partial<DockerImageEngine> = {}): DockerImageEngine {
  return {
    getImage: () => ({
      inspect: async () => {
        throw new Error("no such image");
      },
      remove: async () => {},
    }),
    pull: async () => ({}) as NodeJS.ReadableStream,
    modem: {
      followProgress: (_stream, onFinished) => onFinished(null, []),
    },
    listContainers: async () => [],
    getContainer: () => ({
      inspect: async () => ({ State: { Running: false } }),
      stop: async () => {},
      remove: async () => {},
    }),
    ...overrides,
  };
}

describe("ImageManager", () => {
  it("refresh() reports ready when the image is present, missing otherwise", async () => {
    const present = new ImageManager({
      docker: fakeDocker({
        getImage: () => ({ inspect: async () => ({}), remove: async () => {} }),
      }),
    });
    expect((await present.refresh()).state).toBe("ready");

    const absent = new ImageManager({ docker: fakeDocker() });
    expect((await absent.refresh()).state).toBe("missing");
  });

  it("get('registry') pulls and reports pulling then ready, publishing status transitions", async () => {
    const statuses: ComputerImageStatus[] = [];
    const manager = new ImageManager({
      tag: "ghcr.io/sanlega/openbot-desktop:latest",
      docker: fakeDocker(),
      onStatus: (s) => statuses.push(s),
    });

    const result = await manager.get("registry");

    expect(result.state).toBe("ready");
    expect(result.source).toBe("registry");
    expect(statuses.map((s) => s.state)).toEqual(["pulling", "ready"]);
    expect(manager.isBusy()).toBe(false);
  });

  it("get('local') is rejected when no local Dockerfile was found", async () => {
    const manager = new ImageManager({ docker: fakeDocker() });
    await expect(manager.get("local")).rejects.toThrow(/local build/);
  });

  it("get('local') shells out to docker build against the checkout root, not the images/desktop dir", async () => {
    const runBuild = vi.fn(async () => {});
    const repoRoot = resolve("/repo");
    const dockerfile = join(repoRoot, "images", "desktop", "Dockerfile");
    const manager = new ImageManager({
      docker: fakeDocker(),
      localDockerfile: dockerfile,
      runBuild,
    });

    const result = await manager.get("local");

    expect(result.state).toBe("ready");
    expect(result.source).toBe("local");
    expect(runBuild).toHaveBeenCalledWith([
      "build",
      "-t",
      "ghcr.io/sanlega/openbot-desktop:latest",
      "-f",
      dockerfile,
      repoRoot,
    ]);
  });

  it("a second get() while one is in progress is rejected as already_in_progress", async () => {
    let releasePull: (() => void) | undefined;
    const pullGate = new Promise<void>((resolvePromise) => {
      releasePull = resolvePromise;
    });
    const manager = new ImageManager({
      docker: fakeDocker({
        modem: {
          followProgress: (_stream, onFinished) => {
            void pullGate.then(() => onFinished(null, []));
          },
        },
      }),
    });

    const first = manager.get("registry");
    await expect(manager.get("registry")).rejects.toThrow("already_in_progress");
    releasePull?.();
    await first;
  });

  it("get() reports state error with the failure detail when the pull fails", async () => {
    const manager = new ImageManager({
      docker: fakeDocker({
        modem: {
          followProgress: (_stream, onFinished) =>
            onFinished(new Error("registry unreachable"), []),
        },
      }),
    });

    await expect(manager.get("registry")).rejects.toThrow("registry unreachable");
    expect(manager.getStatus()).toMatchObject({ state: "error", detail: "registry unreachable" });
  });

  it("reset() stops/removes an existing container, removes the image, then re-pulls", async () => {
    const calls: string[] = [];
    const manager = new ImageManager({
      docker: fakeDocker({
        listContainers: async () => [{ Id: "ctr_1", Names: ["/openbot-desktop"] }],
        getContainer: () => ({
          inspect: async () => ({ State: { Running: true } }),
          stop: async () => {
            calls.push("stop");
          },
          remove: async () => {
            calls.push("remove_container");
          },
        }),
        getImage: () => ({
          inspect: async () => {
            throw new Error("no such image");
          },
          remove: async () => {
            calls.push("remove_image");
          },
        }),
      }),
    });

    const result = await manager.reset(true);

    expect(calls).toEqual(["stop", "remove_container", "remove_image"]);
    expect(result.state).toBe("ready");
  });

  it("reset(false) keeps the cached image (skips removeImage) but still re-pulls", async () => {
    const calls: string[] = [];
    const manager = new ImageManager({
      docker: fakeDocker({
        listContainers: async () => [],
        getImage: () => ({
          inspect: async () => {
            throw new Error("no such image");
          },
          remove: async () => {
            calls.push("remove_image");
          },
        }),
      }),
    });

    await manager.reset(false);

    expect(calls).toEqual([]);
  });

  it("reset() is a no-op cleanup when neither a container nor an image exist", async () => {
    const manager = new ImageManager({ docker: fakeDocker() });
    await expect(manager.reset(true)).resolves.toMatchObject({ state: "ready" });
  });
});

describe("ImageManager updates", () => {
  const tag = "ghcr.io/sanlega/openbot-desktop:v0.1.17";

  it("an older OpenBot image on this computer means the new one is pulled at start-up", async () => {
    const pulled: string[] = [];
    const manager = new ImageManager({
      tag,
      docker: fakeDocker({
        listImages: async () => [{ RepoTags: ["ghcr.io/sanlega/openbot-desktop:latest"] }],
        pull: async (t) => {
          pulled.push(t);
          return {} as NodeJS.ReadableStream;
        },
      }),
    });
    expect((await manager.checkForUpdate()).state).toBe("ready");
    expect(pulled).toEqual([tag]);
  });

  it("with no OpenBot image at all, start-up downloads nothing (the owner chooses in Settings)", async () => {
    const pull = vi.fn();
    const manager = new ImageManager({
      tag,
      docker: fakeDocker({ listImages: async () => [{ RepoTags: ["postgres:16"] }], pull }),
    });
    expect((await manager.checkForUpdate()).state).toBe("missing");
    expect(pull).not.toHaveBeenCalled();
  });

  it("ensure() pulls once, even when asked twice at the same time", async () => {
    let pulls = 0;
    let present = false;
    const manager = new ImageManager({
      tag,
      docker: fakeDocker({
        getImage: () => ({
          inspect: async () => {
            if (!present) throw new Error("no such image");
            return {};
          },
          remove: async () => {},
        }),
        pull: async () => {
          pulls += 1;
          present = true;
          return {} as NodeJS.ReadableStream;
        },
      }),
    });
    await Promise.all([manager.ensure(), manager.ensure()]);
    await manager.ensure();
    expect(pulls).toBe(1);
  });
});
