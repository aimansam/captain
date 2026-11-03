# Security policy

Captain talks to the Docker socket, so a flaw in it can mean control of the host. Reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository. Include steps to reproduce and the version you tested. You should get a reply within a few days.

## Hardening checklist for users

- Set a long, unique `ADMIN_PASSWORD`.
- Don't publish the port to the internet. Use a VPN, or a reverse proxy or tunnel with its own authentication.
- Set `SECURE_COOKIE=true` behind HTTPS.
- Use `READ_ONLY=true` when you only need to view.

## Supported versions

Only the latest release receives fixes.
