# Changelog

## Unreleased

- Rebuild a compose project from the UI (`docker compose up -d --build`) with live output and an optional "pull newer images first"
- Build-time fix: faster multi-arch image builds

## 0.1.0

First public release.

- Container list grouped by compose project with live CPU, memory and network
- Start, stop and restart, plus project-level Up and Down
- Per-container auto-start (restart policy) switch
- Cleanup with preview and per-item selection: stopped containers, dangling images, build cache, networks, volumes
- Log viewer, search and filter, light and dark themes
- Password login with rate limiting, `READ_ONLY` and `DEMO` modes
- Multi-arch image (amd64, arm64)
