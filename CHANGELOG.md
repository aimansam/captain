# Changelog

## Unreleased

- Reframed as a container-security tool: new tagline, README and social preview now lead with security checks and the vulnerability scan
- Security tab: configuration checks for every container and the Docker daemon, with fix hints and an ignore label for accepted risks
- Image vulnerability scanning with Trivy (results persisted in `/data`), CVE list with severity and fixable-only filters
- Risk badge on dashboard rows for containers with high or medium findings
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
