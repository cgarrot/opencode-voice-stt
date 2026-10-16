# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-16

### Added

- OpenCode TUI plugin: dictation with `Ctrl+R` toggle, `Enter` to send while
  recording, `Esc` to cancel, and a prompt-footer status indicator.
- Prompt delivery through ordered strategies (`output.insertMethod`):
  OpenTUI renderer insertion, clipboard + `prompt.paste`, or direct send.
  Submission dispatches the built-in `input.submit` command.
- `/stt` slash command: `start`, `stop`, `send`, `file <path>`, `cancel`,
  `mode [name]`, `profile [name]`, `status`, `doctor`; palette entries and the
  profile picker dialog.
- Server plugin exposing the `transcribe_audio` agent tool for local audio
  files.
- `ffmpeg` microphone capture with silence detection, plus the optional native
  macOS microphone bridge for VPS setups (`capture.type: "bridge"`).
- Providers: Mistral Voxtral, OpenAI-compatible (OpenAI, Groq, local servers),
  Deepgram, ElevenLabs Scribe, Gladia, AssemblyAI, and Soniox.
- Voice commands (`send`, `clear`, `new line`), literal replacement dictionary,
  runtime modes (`default`, `raw`, custom) and persistent profiles.
- AI cleanup pass through an OpenAI-compatible chat endpoint or the session's
  own model (`cleanup.useSession`).
- Secret resolution through environment variables, key files, and macOS
  Keychain; HTTPS-by-default endpoint policy with loopback HTTP allowance.
- English and French locales (`locale` / `OPENCODE_STT_LOCALE`).
- Debug logging for the TUI bridge (`OPENCODE_STT_DEBUG=1`,
  `OPENCODE_STT_DEBUG_FILE`).
