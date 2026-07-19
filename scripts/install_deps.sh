#!/usr/bin/env bash
# Install missing prerequisites for the gmaps-leads stack: docker, tmux, node/npm,
# python3 (+venv), google-chrome. Supports macOS (Homebrew), Debian/Ubuntu Linux (apt),
# and WSL2 Ubuntu (Docker Desktop integration or native engine with systemd).
# Called by start_all.sh, but can also be run standalone: ./scripts/install_deps.sh
set -euo pipefail

log() { printf '\033[1;34m[install_deps]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[install_deps]\033[0m %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"

# WSL detection (Ubuntu on Windows). Docker works differently there: either
# Docker Desktop on Windows with WSL integration, or a native engine (needs systemd).
IS_WSL=0
if [[ "$OS" == "Linux" ]] && grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
  IS_WSL=1
fi

systemd_running() { [[ "$(ps -p 1 -o comm= 2>/dev/null)" == "systemd" ]]; }

install_macos() {
  local pkg="$1"
  if ! command -v brew >/dev/null; then
    log "Homebrew not found — installing it first"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # brew lands outside PATH on fresh installs (Apple Silicon: /opt/homebrew)
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
  fi
  case "$pkg" in
    docker)
      log "installing Docker Desktop (brew cask)"
      brew install --cask docker
      log "launching Docker Desktop (first launch may ask for permissions)"
      open -a Docker || true
      ;;
    node) brew install node ;;
    *)    brew install "$pkg" ;;
  esac
}

install_linux() {
  local pkg="$1"
  command -v apt-get >/dev/null || die "no apt-get found — install $pkg manually for your distro"
  local SUDO=""
  [[ $EUID -ne 0 ]] && SUDO="sudo"
  case "$pkg" in
    docker)
      if [[ $IS_WSL -eq 1 ]] && ! systemd_running; then
        die "WSL without systemd: install Docker Desktop on Windows and enable Settings → Resources → WSL Integration for this distro (recommended), OR enable systemd (add [boot]\\nsystemd=true to /etc/wsl.conf, then 'wsl --shutdown' from PowerShell) and re-run"
      fi
      log "installing docker via get.docker.com"
      curl -fsSL https://get.docker.com | $SUDO sh
      if systemd_running; then
        $SUDO systemctl enable --now docker || true
      else
        $SUDO service docker start || true
      fi
      if [[ $EUID -ne 0 ]]; then
        $SUDO usermod -aG docker "$USER" || true
        if [[ $IS_WSL -eq 1 ]]; then
          log "added $USER to docker group — run 'wsl --shutdown' from PowerShell (or 'newgrp docker') for it to take effect"
        else
          log "added $USER to docker group — log out/in (or run 'newgrp docker') for it to take effect"
        fi
      fi
      ;;
    node)
      log "installing Node.js 20.x (NodeSource)"
      curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
      $SUDO apt-get install -y nodejs
      ;;
    python3)
      $SUDO apt-get update -qq
      $SUDO apt-get install -y python3 python3-venv python3-pip
      ;;
    *)
      $SUDO apt-get update -qq
      $SUDO apt-get install -y "$pkg"
      ;;
  esac
}

install_pkg() {
  local pkg="$1"
  log "installing missing dependency: $pkg"
  case "$OS" in
    Darwin) install_macos "$pkg" ;;
    Linux)  install_linux "$pkg" ;;
    *)      die "unsupported OS '$OS' — install $pkg manually" ;;
  esac
}

# tool-to-check -> package-to-install
command -v python3 >/dev/null || install_pkg python3
command -v node    >/dev/null || install_pkg node
command -v npm     >/dev/null || install_pkg node
command -v tmux    >/dev/null || install_pkg tmux
command -v docker  >/dev/null || install_pkg docker

# python3 may exist without the venv module (default on Ubuntu/WSL) — start_all.sh
# needs 'python3 -m venv' to work.
if [[ "$OS" == "Linux" ]] && ! python3 -c 'import ensurepip' >/dev/null 2>&1; then
  log "python3 present but venv module missing — installing python3-venv"
  SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y python3-venv python3-pip
fi

# Google Chrome — required by the scraper (Botasaurus runs headful Chrome).
# On WSL it renders on the Windows desktop via WSLg.
if [[ "$OS" == "Linux" ]] && ! command -v google-chrome >/dev/null && ! command -v google-chrome-stable >/dev/null; then
  log "installing Google Chrome (needed by the scraper)"
  SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"
  tmp_deb="$(mktemp --suffix=.deb)"
  curl -fsSL -o "$tmp_deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  $SUDO apt-get update -qq
  $SUDO apt-get install -y "$tmp_deb"
  rm -f "$tmp_deb"
fi

# Docker binary present but daemon not running (common right after install on macOS)
if command -v docker >/dev/null && ! docker info >/dev/null 2>&1; then
  if [[ "$OS" == "Darwin" ]]; then
    log "starting Docker Desktop and waiting for the daemon..."
    open -a Docker || true
    for i in $(seq 1 60); do
      docker info >/dev/null 2>&1 && break
      sleep 2
      [[ $i -eq 60 ]] && die "docker daemon did not start in 120s — open Docker Desktop manually, then re-run"
    done
  else
    SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"
    if systemd_running; then
      $SUDO systemctl start docker || true
    else
      $SUDO service docker start || true
    fi
    # give the daemon a moment to come up
    for i in $(seq 1 15); do
      docker info >/dev/null 2>&1 && break
      sleep 2
    done
    if ! docker info >/dev/null 2>&1; then
      if [[ $IS_WSL -eq 1 ]]; then
        die "docker daemon not reachable — if using Docker Desktop, start it on Windows and enable WSL integration (Settings → Resources → WSL Integration), then re-run"
      fi
      die "could not start docker daemon — start it manually, then re-run"
    fi
  fi
fi

log "all dependencies present: python3 (+venv), node, npm, tmux, docker, chrome"
