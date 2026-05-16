# GameServerStatus

A **Drako Bot** addon that publishes a single auto-updating Discord embed per channel with the live status of your game servers — **Minecraft (Java & Bedrock), Garry's Mod, Counter-Strike 2, Rust, Valheim, ARK, Palworld, DayZ, 7 Days to Die, Squad, Project Zomboid**, and ~570 more games supported by [`gamedig`](https://github.com/gamedig/node-gamedig).

No spam, no duplicates — the same message is edited in place on every cycle. Optional voice-channel display renders the same data into channel names. Multilingual (English & Spanish out of the box, drop-in `lang/<code>.yml` to add more).

## Highlights

- **One embed per channel, edited in place** — clean, no flicker, no chat clutter.
- **Interactive buttons** — Connect (with `steam://` deep links for Source games), Copy IP, View All Players.
- **Voice-channel display** — read-only voice channels whose names show status, player count, IP, version, map, game mode. Rate-limit aware.
- **Self-healing** — orphan messages from previous runs (or older addons) are cleaned up automatically on boot.
- **Atomic state** — crash-safe JSON persistence (write-to-temp + rename).
- **i18n** — English + Spanish included; per-game footers and button hints.
- **570+ games** via gamedig.
- **Free & open-source** (MIT).

- **Version:** 1.0.0
- **License:** MIT (see [LICENSE.txt](LICENSE.txt))
- **Source:** <TODO: GitHub repo URL>

## Install

1. Add `"gamedig": "^5.3.2"` to your bot's `package.json`, run `npm install`.
2. Copy the `GameServerStatus/` folder into your bot's `addons/` directory.
3. Start the bot.

See [SETUP.md](SETUP.md) for the full walkthrough, configuration, and troubleshooting.

## Documentation

- [SETUP.md](SETUP.md) — installation, configuration, troubleshooting.
- [DOCS.md](DOCS.md) — architecture and internals.

## Support development

This addon is free and open-source. If it saves you time and you'd like to support further work on it, you can grab it for $2.99 at:

<TODO: marketplace listing URL>

PRs and issues on GitHub are also welcome.
