# Firecracker microVMs for per-bot isolation: research note (Q3)

_2026-10-01. Question from the owner (STATE, round 2): could Firecracker give each Bot its own
machine instead of today's one shared Docker desktop container (D-007, D-032, D-034)?_

## What Firecracker is (from its FAQ and getting-started guide)

- An open-source VMM (Apache-2.0, AWS; Lambda and Fargate run on it) written in Rust.
- Minimal device model: virtio-net, virtio-block, virtio-vsock, virtio-balloon, serial console and
  an i8042 stub. No display, GPU, USB or sound devices. Starts in under 125 ms, with under 5 MiB of
  VMM memory overhead per microVM.
- **Host: Linux only, with KVM** (`/dev/kvm` read/write). x86_64 and aarch64; the guest must
  have the same architecture as the host. Another hypervisor holding `/dev/kvm` (VirtualBox,
  VMware) stops it from starting.
- Production use goes through the `jailer` (chroot, cgroups, seccomp, a separate uid per VM).
  Networking is a TAP device per VM plus host NAT/iptables, set up as root.
- Snapshots (memory plus device state) exist and are how Lambda gets fast cold starts.

## What OpenBot needs from a Bot's machine

A full Linux desktop (Xvfb, a window manager, Chromium with a persistent profile), VNC for the
live view and takeover, the CDP/daemon control port, a shared `/workspace`, shared sign-ins
(D-032), and a supervisor (D-034). All of this is userland, so it would run inside a microVM:
the screen is Xvfb (software, no display device needed) and the live view travels over the
network (VNC through virtio-net). The workspace would need a block device or a network
filesystem: Firecracker has no virtio-fs or 9p host-directory sharing, so the one shared
`/workspace` that D-032 relies on would become an NFS/SMB export from the host or a sync step.

## Where it does not fit today

1. **macOS and Windows hosts have no KVM.** Firecracker would have to run inside a Linux VM that
   allows nested virtualisation:
   - Windows: WSL2 can expose `/dev/kvm` with nested virtualisation on recent Windows 11 builds,
     but this must be enabled on each machine and doesn't work on every CPU or edition (to verify
     per machine).
   - macOS: Apple's Virtualization framework only allows nested virtualisation on recent Apple
     silicon with a recent macOS; Docker Desktop's own VM doesn't offer KVM to containers (to
     verify).
   - In both cases the owner would install and maintain a second VM layer, which costs more than
     today's single "install Docker Desktop".
2. **Root networking.** TAP devices and NAT need root or `CAP_NET_ADMIN` on the host (or inside
   the helper VM). OpenBot never asks for root today.
3. **Shared sign-ins and workspace.** D-032 shares one cookie jar and one `/workspace` through a
   Docker volume and bind mount. With microVMs, each Bot gets its own disk, so sharing needs a
   network filesystem or a sync agent: more moving parts and new failure modes.
4. **Image delivery.** We ship a Docker image through GHCR (D-020). Firecracker needs a kernel
   and an ext4 rootfs per architecture, plus our own update path.

## What it would buy

- Each Bot in a separate kernel (hardware isolation), instead of separate Linux users and
  processes in one container. A Bot that escapes its sandbox would reach only its own VM.
- Per-Bot resource limits and snapshots: a stuck Bot's machine could be reset to a known state in
  well under a second.

## Recommendation

Not now. The threat it addresses (one Bot reading another Bot's files or browser inside the shared
box) is real, but cheaper options cover most of it on every OS we ship:

- **Keep Docker and give each Bot its own container**, sharing only the workspace and the
  sign-in jar through volumes. Container isolation on Docker Desktop already sits inside Docker's
  Linux VM, so the host stays protected; Bots get process, filesystem and network namespaces from
  each other.
- **gVisor (`runsc`) as the container runtime** where available: a user-space kernel per
  container, with no KVM requirement in its ptrace/systrap platforms, and it works on Linux hosts
  and inside Docker Desktop's VM with some setup.
- **Revisit Firecracker for a Linux-server edition** (`openbot serve` on a Linux box with KVM, for
  example a home server or a cloud VM). There it is a strong fit: per-Bot microVMs, snapshots for
  instant reset, and the jailer. Prototype order:
  1. one microVM booting our desktop rootfs, built from `images/desktop`;
  2. VNC and the daemon over a TAP device;
  3. the workspace over virtio-block or NFS;
  4. snapshot and restore of a signed-in browser.

Sources: firecracker-microvm/firecracker `FAQ.md` and `docs/getting-started.md` (main branch,
read 2026-10-01).
