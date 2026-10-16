# Security Policy

OpenCode plugins run with the same permissions as your user account. Review code before installing any plugin package.

## Secrets

OpenCode Voice STT never intentionally writes API keys to session history and never logs secrets. Prefer environment variables, a `0600` key file, or macOS Keychain for secrets. Do not commit config files containing `apiKey`.

The TUI debug log (`OPENCODE_STT_DEBUG=1`) records state transitions and delivery strategies, not transcripts and not secrets.

## Audio and transcripts

Audio captured from the microphone is written to a temporary file and deleted after transcription. The only network destinations are the STT/cleanup providers you configure. Nothing is uploaded anywhere else, and file transcription never modifies the source file.

## Endpoint policy

Non-local transcription endpoints must use HTTPS. Plain HTTP is accepted only for loopback hosts (`localhost`, `127.0.0.1`, `::1`) to support local STT servers.

## Reporting issues

Please report security issues privately if possible. If private reporting is not available, open a minimal public issue without credentials or sensitive logs.
