#!/usr/bin/env bash
# Bots' commands run as `box`, without root. This stands in for `apt-get`, `apt` and `sudo` so
# that installing system packages still works: package installs are handed to the desktop
# daemon (running as root) over a local socket, which only accepts package names.
set -uo pipefail

SOCKET=/run/openbot/apt.sock
name="$(basename "$0")"

if [ "$(id -u)" = "0" ]; then
  case "$name" in
    sudo) exec "$@" ;;
    *) exec "/usr/bin/$name" "$@" ;;
  esac
fi

install_packages() {
  local packages=()
  for arg in "$@"; do
    case "$arg" in
      -*) ;; # -y, --no-install-recommends, ... the helper always installs non-interactively
      *) packages+=("$arg") ;;
    esac
  done
  if [ "${#packages[@]}" -eq 0 ]; then
    echo "openbot-apt: no packages named" >&2
    return 2
  fi
  local body response code
  body="$(jq -cn '$ARGS.positional | {packages: .}' --args "${packages[@]}")"
  if ! response="$(curl -sS --max-time 900 --unix-socket "$SOCKET" \
    -H 'content-type: application/json' -d "$body" http://openbot/install)"; then
    echo "openbot-apt: the package helper is not available" >&2
    return 1
  fi
  printf '%s' "$response" | jq -r '.output // ""'
  code="$(printf '%s' "$response" | jq -r '.code // 1')"
  return "$code"
}

run_apt() {
  local sub=""
  for arg in "$@"; do
    case "$arg" in
      -*) ;;
      *) sub="$arg"; break ;;
    esac
  done
  case "$sub" in
    install)
      local rest=() seen=0
      for arg in "$@"; do
        if [ "$seen" = "0" ] && [ "$arg" = "install" ]; then seen=1; continue; fi
        rest+=("$arg")
      done
      install_packages "${rest[@]}"
      ;;
    update)
      # The helper refreshes the package lists itself before installing.
      echo "Package lists are refreshed when packages are installed."
      ;;
    remove | purge | autoremove | upgrade | dist-upgrade | full-upgrade)
      echo "openbot-apt: only 'install' is available inside the OpenBot machine" >&2
      return 1
      ;;
    *) "/usr/bin/apt-get" "$@" ;;
  esac
}

case "$name" in
  apt | apt-get) run_apt "$@" ;;
  sudo)
    while [ "$#" -gt 0 ] && [ "${1#-}" != "$1" ]; do shift; done
    if [ "$#" -eq 0 ]; then
      echo "usage: sudo <command>" >&2
      exit 1
    fi
    cmd="$1"
    shift
    case "$cmd" in
      apt | apt-get | /usr/bin/apt | /usr/bin/apt-get) run_apt "$@" ;;
      *)
        echo "note: there is no root inside the OpenBot machine; running '$cmd' as the bot user" >&2
        "$cmd" "$@"
        ;;
    esac
    ;;
  *) run_apt "$@" ;;
esac
