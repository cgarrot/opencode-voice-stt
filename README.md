# OpenCode Voice STT

Provider-agnostic speech-to-text for [OpenCode](https://opencode.ai): interactive voice dictation in the TUI and audio file transcription for agents.

Press `Ctrl+R` to record your microphone, press it again to transcribe and insert the transcript into the active prompt, press `Enter` while recording to transcribe and send it directly to chat, or press `Esc` to cancel recording/transcription.

This project is intentionally small and hackable: an OpenCode TUI plugin for dictation, a server plugin exposing the `transcribe_audio` tool, local/bridge audio recorders, and OpenAI-compatible/Mistral transcription providers.

## Features

- OpenCode TUI plugin with the `/stt` command and `Ctrl+R` shortcut.
- Local audio file transcription with `/stt file <path>` and the agent tool `transcribe_audio`.
- `Enter`-to-send and `Esc`-to-cancel while recording.
- Prompt-footer status indicator (`voice ctrl+r`, `● recording`, `• transcribing`, `· polishing`).
- `ffmpeg` microphone capture to temporary WAV files.
- Optional native Mac microphone bridge for OpenCode running on a VPS over SSH.
- Mistral Voxtral provider.
- OpenAI / Groq / generic OpenAI-compatible provider for hosted and local Whisper-style endpoints.
- Native provider integrations for Deepgram, ElevenLabs Scribe, Gladia, AssemblyAI, and Soniox.
- Environment variable, key file, and macOS Keychain secret lookup.
- HTTPS-by-default endpoint policy; plain HTTP is allowed only for loopback hosts.
- AI cleanup pass (OpenAI-compatible endpoint or the session's own model).
- Voice commands (`send`, `clear`, `new line`), replacement dictionary, modes, and persistent profiles.
- English and French locales.

## Requirements

- OpenCode `2.0` or newer (CLI/TUI).
- Node.js `>= 20` or Bun when developing locally.
- For microphone capture: `ffmpeg` available in `PATH` or configured with `capture.ffmpegPath` (or the Mac bridge).
- For microphone capture: microphone permission for the terminal app running OpenCode, or for the Mac bridge daemon when using `capture.type: "bridge"`.
- A transcription backend (Mistral, OpenAI/Groq, Deepgram, ElevenLabs Scribe, Gladia, AssemblyAI, Soniox, or a local OpenAI-compatible server).

## Installation

Register the plugin in your global `~/.config/opencode/opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-voice-stt"]
}
```

The package exposes two entrypoints: the server plugin (registers the `transcribe_audio` tool) and the TUI plugin (dictation). OpenCode loads the TUI component automatically when the server lists a plugin that has one.

CLI-only alternative, `~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": [{ "package": "/absolute/path/to/opencode-voice-stt" }]
}
```

Options may be passed through either entrypoint:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-voice-stt",
      "options": { "configPath": "~/.config/opencode/stt.json", "keybind": "ctrl+r" }
    }
  ]
}
```

### Local development install

```bash
git clone https://github.com/cgarrot/opencode-voice-stt.git
cd opencode-voice-stt
bun install
npm run ci
```

## Prompt delivery — how the transcript reaches your prompt

OpenCode V2 does not expose a public API to write the prompt composer text (the V1 `appendPrompt` API is gone). This plugin therefore delivers transcripts through ordered strategies, configurable via `output.insertMethod`:

1. **`renderer` (default, first in `auto`)** — inserts directly into the prompt editor through the OpenTUI renderable tree (the same buffer you type into).
2. **`clipboard`** — writes the transcript to the clipboard, dispatches the built-in `prompt.paste` command, then restores the previous clipboard content.
3. **`send`** — explicit opt-in only: posts the transcript straight to the session with `session.prompt` (the draft in the composer is not merged).

`"auto"` tries renderer, then clipboard, and fails with an actionable toast instead of silently posting the transcript to the model. If OpenCode ever changes its renderable ids, set `output.insertMethod` to `"clipboard"` or `"send"` as a workaround and please open an issue.

Submitting (`Enter` while recording, `/stt send`, `submitOnStop`) dispatches the built-in `input.submit` command so the composer (existing draft + transcript) is sent exactly like a manual Enter.

## Configuration

The plugin reads configuration from the first available source:

1. `OPENCODE_STT_CONFIG=/path/to/config.json`
2. `options.configPath` in the plugin entry
3. `~/.config/opencode/stt.json` (or `$XDG_CONFIG_HOME/opencode/stt.json`)
4. built-in defaults

The shortcut defaults to `Ctrl+R`. Override it with either:

```bash
OPENCODE_STT_KEYBIND=alt+r opencode
```

or a top-level `keybind` in the config file, or the plugin option `keybind`. The environment wins at startup.

> Note: `ctrl+r` is bound to `session.rename` in OpenCode by default. Either free it in `~/.config/opencode/cli.json` (`"keybinds": { "session.rename": "none" }`) or pick another key for the plugin.

The profile menu shortcut defaults to `Alt+R` (`profileKeybind` / `OPENCODE_STT_PROFILE_KEYBIND`).

### Output options

```json
{
  "output": {
    "appendTrailingSpace": true,
    "submitOnStop": false,
    "insertMethod": "auto",
    "replacements": { "super base": "Supabase", "react native": "React Native" }
  }
}
```

- `appendTrailingSpace` (default `true`): append a space after the inserted transcript.
- `submitOnStop` (default `false`): when `true`, stopping a recording with the toggle shortcut also sends the transcript to chat.
- `insertMethod` (default `"auto"`): `"auto"`, `"renderer"`, `"clipboard"`, or `"send"` (see above).
- `replacements` (default `{}`): literal dictionary applied to the raw transcript before cleanup. Case-insensitive and word-boundary aware; longer keys win.

### Localization

Runtime labels and toasts default to English. Switch them with the top-level `locale` setting (or `OPENCODE_STT_LOCALE`). Built-in packs: `en` (default) and `fr`.

```json
{ "locale": "fr" }
```

Like the keybinding, the locale is resolved when the plugin loads — reload the plugin (`/plugins` dialog) or restart the TUI after changing it.

### Modes

Modes are named presets that override any part of the configuration. Built-in modes: `default` (no overrides) and `raw` (skips AI cleanup). Define your own under `modes` and switch at runtime with `/stt mode <name>` (or set a default via the top-level `mode` setting / `OPENCODE_STT_MODE`).

```json
{
  "mode": "default",
  "cleanup": { "enabled": true, "endpoint": "https://api.openai.com/v1/chat/completions", "model": "gpt-4o-mini", "apiKeyEnv": "OPENAI_API_KEY" },
  "modes": {
    "raw": { "cleanup": { "enabled": false } },
    "commit": { "cleanup": { "language": "en", "prompt": "Rewrite the dictation as a concise, imperative git commit subject line." } }
  }
}
```

### Profiles

Profiles are named presets that group a full configuration (provider, capture, cleanup, output…). Unlike modes, profiles persist: the last selection is written to a sidecar state file next to your config (`<config path>.profile.json`) and reused as the default.

```json
{
  "profile": "local",
  "profiles": {
    "local": {
      "provider": {
        "type": "openai-compatible",
        "endpoint": "http://127.0.0.1:8788/v1/audio/transcriptions",
        "model": "crisperwhisper-large",
        "language": "fr"
      }
    },
    "mistral": {
      "provider": { "type": "mistral", "model": "voxtral-mini-2602", "apiKeyEnv": "MISTRAL_API_KEY", "language": "fr" }
    }
  }
}
```

Effective profile resolution: `OPENCODE_STT_PROFILE` > persisted selection > top-level `profile` key > `default`. Commands: `/stt profile` lists; `/stt profile <name>` switches; the menu keybind opens a picker. When a profile changes the provider or capture `type`, that block is replaced entirely.

### Voice commands

Optionally trigger an action by ending your dictation with a keyword. Disabled by default; keywords are configurable.

```json
{
  "commands": {
    "enabled": true,
    "send": ["send", "send it"],
    "clear": ["scratch that", "delete that"],
    "newline": ["new line"]
  }
}
```

- `send`: strip the keyword and submit the prompt (even when `submitOnStop` is off).
- `clear`: discard the current dictation.
- `newline`: insert the text followed by a line break.

Voice commands apply to microphone dictation only (not to `/stt file` or the agent tool) and are parsed before the AI cleanup pass.

### Smart cleanup (AI)

Optionally run the raw transcript through an LLM before it is inserted, to fix punctuation, capitalization, and project terms.

```json
{
  "cleanup": {
    "enabled": true,
    "useSession": false,
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4o-mini",
    "apiKeyEnv": "OPENAI_API_KEY",
    "language": "auto",
    "useRepoContext": true,
    "projectTerms": ["Supabase", "HyperFrames"]
  }
}
```

- `enabled` (default `false`): turn the cleanup pass on.
- `useSession` (default `false`): run the pass with the current session's model through `session.generate` — no endpoint or key needed while a session is open. The endpoint settings remain the fallback for the agent tool.
- `endpoint` / `model` / `apiKeyEnv` / `keychainService` / `keychainAccount`: same secret handling as STT providers; HTTPS required unless localhost.
- `language` (default `"auto"`), `prompt` (base system prompt), `projectTerms` (glossary), `useRepoContext` (include the current git branch), `maxTokens` (default `2000`), `timeoutSeconds` (default `30`).

If the cleanup call fails or times out, the raw transcript is used — dictation is never blocked. The indicator shows a distinct `polishing` state.

### Language detection

Set `provider.language` to a specific code (`"en"`, `"fr"`) or leave it empty / `"auto"` to let the provider detect the spoken language.

### Mistral Voxtral

```json
{
  "provider": { "type": "mistral", "model": "voxtral-mini-2602", "apiKeyEnv": "MISTRAL_API_KEY", "language": "fr" }
}
```

### OpenAI / Groq / generic OpenAI-compatible

```json
{
  "provider": { "type": "openai", "model": "gpt-4o-mini-transcribe", "apiKeyEnv": "OPENAI_API_KEY", "language": "en" }
}
```

```json
{
  "provider": { "type": "groq", "model": "whisper-large-v3-turbo", "apiKeyEnv": "GROQ_API_KEY", "language": "en" }
}
```

```json
{
  "provider": {
    "type": "openai-compatible",
    "endpoint": "https://api.openai.com/v1/audio/transcriptions",
    "model": "whisper-1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "language": "en"
  }
}
```

### Deepgram / ElevenLabs / Gladia / AssemblyAI / Soniox

```json
{ "provider": { "type": "deepgram", "model": "nova-3", "apiKeyEnv": "DEEPGRAM_API_KEY", "language": "en", "smartFormat": true } }
```
```json
{ "provider": { "type": "elevenlabs", "model": "scribe_v1", "apiKeyEnv": "ELEVENLABS_API_KEY", "language": "en" } }
```
```json
{ "provider": { "type": "gladia", "apiKeyEnv": "GLADIA_API_KEY", "language": "en", "pollIntervalMs": 1000 } }
```
```json
{ "provider": { "type": "assemblyai", "model": "universal", "apiKeyEnv": "ASSEMBLYAI_API_KEY", "language": "en" } }
```
```json
{ "provider": { "type": "soniox", "model": "stt-async-v5", "apiKeyEnv": "SONIOX_API_KEY", "language": "en" } }
```

### Local STT server

```json
{
  "provider": {
    "type": "openai-compatible",
    "endpoint": "http://localhost:10301/v1/audio/transcriptions",
    "model": "whisper-1",
    "apiKeyEnv": "",
    "language": "en"
  }
}
```

Plain HTTP is accepted only for `localhost`, `127.0.0.1`, or `::1`.

## Audio file transcription

Insert a local recording's transcript into the current prompt:

```text
/stt file ./meeting.m4a
/stt file "./My recordings/meeting.wav"
```

The command appends to the prompt using the existing output formatting and never sends the prompt automatically, even when `output.submitOnStop` is enabled. Spoken keywords such as `send`, `clear` and `new line` are treated as transcript content, not voice commands.

Agents can use the `transcribe_audio` tool:

```text
Transcribe ./meeting.m4a and summarize the decisions and action items.
```

Both entry points use the active profile and mode, including the provider, language, replacements and optional AI cleanup. Use `/stt mode raw` to skip cleanup. Relative paths resolve from the session's working directory; absolute paths and a leading `@` are also accepted.

Supported file extensions: `.wav`, `.mp3`, `.m4a`, `.mp4`, `.aac`, `.flac`, `.ogg`, `.opus` and `.webm`. The original file is uploaded with its filename and matching MIME type. Source files are never modified. File transcription does not require a microphone or `ffmpeg`.

## Usage

| Action | Behavior |
| --- | --- |
| `Ctrl+R` while idle | Start recording |
| `Ctrl+R` while recording | Stop, transcribe, insert into the prompt (or send when `output.submitOnStop` is `true`) |
| `Enter` while recording | Stop, transcribe, insert, and send the prompt |
| `Esc` while recording/processing | Cancel recording or transcription |
| `/stt status` | Show current state, mode, profile, and config source |
| `/stt doctor` | Check config, provider readiness, and local `ffmpeg` or bridge health |
| `/stt start` / `/stt stop` / `/stt send` / `/stt cancel` | Same actions as the shortcuts |
| `/stt file <path>` | Transcribe a local audio file and append it to the prompt |
| `/stt mode [name]` | Show or switch the active preset |
| `/stt profile [name]` | Show, pick, or switch the active profile |

The voice state is overlaid at the right end of the composer status line (the row showing agent, model, and variant: `Build auto · <model> · max … voice ctrl+r`). While recording it blinks `● recording`, then shows `transcribing`/`polishing` during processing.

## Secret handling

Prefer environment variables:

```bash
export MISTRAL_API_KEY=...
export OPENAI_API_KEY=...
export GROQ_API_KEY=...
```

Or point at a file containing the raw key or an env-style line such as `export MISTRAL_API_KEY=...`:

```json
{
  "provider": {
    "type": "mistral",
    "apiKeyFile": "~/.config/opencode/opencode-voice-stt.env"
  }
}
```

On macOS you can also use Keychain:

```json
{
  "provider": { "type": "mistral", "keychainService": "opencode-voice-stt", "keychainAccount": "your-account" }
}
```

## Mac native microphone bridge

Use the bridge when OpenCode runs on a machine without direct microphone access (e.g. a VPS over SSH). The bridge is **opt-in**: it activates only with `capture.type: "bridge"`.

> See **[docs/macos-bridge.md](docs/macos-bridge.md)** for architecture, security, troubleshooting, and uninstall details.

```bash
tools/install-macos-bridge.sh --local      # OpenCode running on this Mac
tools/install-macos-bridge.sh my-vps       # OpenCode running on a VPS (SSH alias)
```

## Audio capture notes

With `capture.type: "ffmpeg"` the extension records through `ffmpeg`. Platform defaults are `avfoundation :0` (macOS), `pulse default` (Linux) and `dshow audio=Microphone` (Windows).

If recordings are "too small" or "silent":

1. **Microphone permission** — grant microphone access to the terminal running OpenCode (System Settings → Privacy & Security → Microphone).
2. **Pick the right device** — on macOS list devices with `ffmpeg -f avfoundation -list_devices true -i ""` and set `capture.input` (e.g. `":1"`); on Linux use `pactl list short sources` or `arecord -L`.
3. **Virtual devices** (ZoomAudioDevice, BlackHole, OBS) record silence — pick the real microphone.

## Development

```bash
bun install
npm run check   # tsc --noEmit
npm test        # node --import tsx --test tests/*.test.ts
npm run smoke   # both entrypoints load under Bun
npm run ci
```

Debug logging (TUI plugin): run with `OPENCODE_STT_DEBUG=1`; the plugin appends to `$TMPDIR/opencode-voice-stt.log` (override with `OPENCODE_STT_DEBUG_FILE`).

Project layout:

```text
src/tui.tsx                  TUI plugin entry (dictation, shortcuts, indicator)
src/index.ts                 server plugin entry (transcribe_audio tool)
src/tui/                     prompt bridge, commands, indicator, toasts
src/core/                    dictation state machine and transcript pipeline
src/audio/                   ffmpeg and bridge recorders
src/providers/               STT provider abstraction
src/cleanup/                 AI cleanup (endpoint or session model)
src/config/                  config loading, profiles, modes
tools/                       optional Mac bridge daemon/installer
```

## Design goals

- Keep provider code independent from OpenCode so new backends are easy to add.
- Keep the OpenCode integration thin and readable.
- Never send audio or transcripts anywhere except the configured provider.
- Avoid storing secrets in sessions or config examples.
- Fail safely: clean up temporary files and stop `ffmpeg` on cancel, reload, or exit.
- Degrade honestly: when the prompt cannot be reached, tell the user instead of guessing.

## License

MIT
