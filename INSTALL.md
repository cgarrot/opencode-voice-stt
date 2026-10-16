# Installing OpenCode Voice STT

Voice dictation for the OpenCode TUI: press `Ctrl+R`, speak, and the transcript lands in your prompt.

## 1. Register the plugin

Add the plugin to your global `~/.config/opencode/opencode.json` (or `opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-voice-stt"]
}
```

If you installed this as an npm package instead of a local checkout, use the package name:

```jsonc
{ "plugins": ["opencode-voice-stt"] }
```

Restart the TUI (or open the plugins dialog with `/plugins` and reload) after changing the config.

## 2. Free the `Ctrl+R` key (optional)

OpenCode binds `ctrl+r` to `session.rename` by default. Add to `~/.config/opencode/cli.json`:

```jsonc
{ "keybinds": { "session.rename": "none" } }
```

Or keep the default and give the plugin another key via the plugin options:

```jsonc
{
  "plugins": [
    { "package": "/absolute/path/to/opencode-voice-stt", "options": { "keybind": "alt+r" } }
  ]
}
```

## 3. Configure a provider

Create `~/.config/opencode/stt.json` and pick a transcription backend. Example with Mistral:

```json
{
  "capture": {
    "type": "ffmpeg",
    "inputFormat": "avfoundation",
    "input": ":0",
    "sampleRate": 16000,
    "channels": 1,
    "maxSeconds": 120,
    "minBytes": 4096
  },
  "provider": {
    "type": "mistral",
    "model": "voxtral-mini-2602",
    "language": "fr",
    "apiKeyEnv": "MISTRAL_API_KEY"
  },
  "output": { "appendTrailingSpace": true }
}
```

Set the API key in your shell (`export MISTRAL_API_KEY=...`), or keep it in a private key file:

```bash
# ~/.config/opencode/opencode-voice-stt.env  (chmod 600)
export MISTRAL_API_KEY=sk-...
```

```json
{ "provider": { "type": "mistral", "apiKeyFile": "~/.config/opencode/opencode-voice-stt.env" } }
```

Ready-to-copy configs live in [`examples/`](examples/). On macOS, list devices with:

```bash
ffmpeg -f avfoundation -list_devices true -i ""
```

and set `capture.input` to your real microphone (e.g. `":1"`).

## 4. Verify

In a session, run:

```text
/stt doctor
```

This checks the config, the provider key, and `ffmpeg`. Then press `Ctrl+R`, say something, and press `Ctrl+R` again — the transcript should appear in the prompt. `Enter` while recording sends it directly.

## Troubleshooting

- **"Missing Mistral API key"** — export the key or point `apiKeyFile` at your key file; run `/stt doctor`.
- **"Recording is too small" / "Recording is silent"** — grant microphone permission to your terminal, and make sure `capture.input` points at a real microphone, not a virtual device.
- **Nothing appears in the prompt** — check whether your OpenCode version still exposes the prompt renderable (see the README section "Prompt delivery"). Set `"output": { "insertMethod": "clipboard" }` as a workaround.
- **Keys do not react** — make sure another command is not holding `ctrl+r` (see step 2), and reload the plugin after config changes.
