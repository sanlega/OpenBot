# OpenBot shared Linux desktop (plan WS9 `images/desktop`).
FROM node:22-bookworm AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@openbot/computer-docker..." run build

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    OPENBOT_MAX_SCREENS=4 \
    OPENBOT_BOX_UID=1000 \
    OPENBOT_CONTROL_PORT=8787 \
    NOVNC_PORT=6080

# The bots' shell also runs here (D-033): the everyday tools of a developer machine.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
    xvfb x11vnc fluxbox \
    novnc websockify \
    chromium \
    xdotool at-spi2-core \
    tesseract-ocr \
    python3 python3-gi gir1.2-atspi-2.0 \
    fonts-dejavu-core \
    git openssh-client python3-pip python3-venv build-essential \
    jq unzip zip wget less nano procps file ripgrep \
    tini iptables tzdata util-linux \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# GitHub's CLI: bots sign in once (device flow) and the login stays in their home on the volume.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# The bots' commands run as `box` (uid 1000), never as root: no capabilities, no way to read the
# daemon's token or the browser profiles, and no route to the daemon, CDP, VNC or X sockets
# (entrypoint.sh). `apt-get install` still works through a root-only helper in the daemon.
RUN useradd --uid 1000 --create-home --home-dir /home/box --shell /bin/bash box
COPY images/desktop/box-apt.sh /usr/local/bin/openbot-apt
RUN chmod 755 /usr/local/bin/openbot-apt     && ln -s /usr/local/bin/openbot-apt /usr/local/bin/apt-get     && ln -s /usr/local/bin/openbot-apt /usr/local/bin/apt     && ln -s /usr/local/bin/openbot-apt /usr/local/bin/sudo

WORKDIR /opt/openbot
RUN mkdir -p /root/.fluxbox
COPY images/desktop/fluxbox-init /root/.fluxbox/init
COPY --from=build /repo/packages/computer/docker/dist/desktop-daemon.js ./desktop-daemon.js
COPY images/desktop/entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN mkdir -p /workspace /data/browser /data/home /run/openbot
VOLUME ["/workspace"]

EXPOSE 8787 6080

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD curl -fsS -H "Authorization: Bearer ${OPENBOT_CONTROL_TOKEN}" http://127.0.0.1:${OPENBOT_CONTROL_PORT}/health || exit 1

# tini reaps Chromium's orphans and forwards signals (`docker stop` no longer waits 10 s). The
# provider also sets `Init: true`; `-s` keeps tini working as a subreaper under Docker's init.
ENTRYPOINT ["/usr/bin/tini", "-s", "-g", "--", "./entrypoint.sh"]
