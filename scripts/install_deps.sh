#!/usr/bin/env bash
# Install missing prerequisites for the gmaps-leads stack: docker, tmux, node/npm, python3.
# Supports macOS (Homebrew) and Debian/Ubuntu Linux (apt). Called by start_all.sh,
# but can also be run standalone: ./scripts/install_deps.sh
set -euo pipefail

log() { printf '\033[1;34m[install_deps]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[install_deps]\033[0m %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"

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
      log "installing docker via get.docker.com"
      curl -fsSL https://get.docker.com | $SUDO sh
      $SUDO systemctl enable --now docker || true
      if [[ $EUID -ne 0 ]]; then
        $SUDO usermod -aG docker "$USER" || true
        log "added $USER to docker group — log out/in (or run 'newgrp docker') for it to take effect"
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
    $SUDO systemctl start docker || die "could not start docker daemon — start it manually, then re-run"
  fi
fi

log "all dependencies present: python3, node, npm, tmux, docker"
