# Contributing

Thanks for helping improve OpenCode Voice STT.

## Development setup

```bash
bun install
npm run ci
```

Useful commands:

- `npm run check` — TypeScript typecheck (`tsc --noEmit`).
- `npm test` — unit tests (`node --import tsx --test tests/*.test.ts`).
- `npm run smoke` — loads both plugin entrypoints under Bun.
- `npm run ci` — all of the above.

## Trying the plugin locally

Add your checkout to `~/.config/opencode/opencode.json`:

```jsonc
{ "plugins": ["/absolute/path/to/opencode-voice-stt"] }
```

Reload the plugin from the `/plugins` dialog after code changes, or restart the TUI. For TUI-side debugging, run with `OPENCODE_STT_DEBUG=1` and watch `$TMPDIR/opencode-voice-stt.log`.

## Guidelines

- Keep provider code independent from OpenCode; new backends go in `src/providers/`.
- Keep the OpenCode integration thin: `src/tui.tsx` wires, `src/tui/` adapts.
- Add tests for behavior changes (config, pipeline, controller, prompt bridge).
- Code, comments, and commit messages stay in English.
- Never log or persist secrets, audio, or transcripts.
