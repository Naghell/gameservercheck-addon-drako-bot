# GameServerStatus — Setup

A **Drako Bot** addon that publishes a single auto-updating Discord embed per channel with the live status of your game servers — **Minecraft (Java & Bedrock), Garry's Mod, Counter-Strike 2, Rust, Valheim, ARK, Palworld, DayZ, Squad, Project Zomboid**, and ~570 more games supported by [`gamedig`](https://github.com/gamedig/node-gamedig). Same message edited in place every cycle — no spam, no duplicates. Optional voice-channel display, English & Spanish out of the box.

> Looking for architecture, internals, or extension points? See [DOCS.md](DOCS.md).

---

## 1. Install

The addon has **one dependency** (`gamedig`) that you need to add to your bot's `package.json` once. This is a single-time setup.

### 1.1 Add `gamedig` to the bot's `package.json`

Open `package.json` at the **root of your Drako Bot** (the same folder as `index.js`). Inside the `"dependencies"` block — next to `"discord.js"`, `"express"`, etc. — add this line:

```json
"gamedig": "^5.3.2"
```

For example, your `dependencies` block should look like this (the order doesn't matter):

```json
"dependencies": {
    "discord.js": "^14.23.2",
    "gamedig": "^5.3.2",
    "...": "..."
}
```

### 1.2 Install the dependency

From the bot's root folder (where `package.json` lives), run:

```bash
npm install
```

If you're on a host that doesn't let you open a terminal (e.g. some Pterodactyl panels), use the panel's package-manager UI to install dependencies, or upload the addon to a host that does. Most Pterodactyl Node.js eggs include a "Run npm install" startup option.

### 1.3 Drop the addon and start the bot

1. Copy the `GameServerStatus/` folder into your bot's `addons/` directory.
2. Start the bot (`npm start`).

On first boot the addon will:

- **Generate a default `config.yml`** next to this file, with two placeholder servers showing the schema.
- **Log a reminder** in the console telling you to edit `config.yml` with your real Discord channels and server IPs.

Once you fill in real values, restart the bot and the live embeds will appear in the configured channels.

> [!NOTE]
> If you skip step 1.1 or 1.2, you'll see `The 'gamedig' package is not installed ...` in the console and the addon will refuse to load. The bot itself does **not** crash — the addon just sits inactive until `gamedig` is available.

---

## 2. Configure `config.yml`

Open [config.yml](config.yml) and adjust to your needs. Top-level shape:

```yaml
# Active language. Must match a file in lang/ (without the .yml extension).
Language: "en"

Enabled: true

# Seconds between server queries. Minimum: 15.
UpdateInterval: 60

# On boot, sweep any orphan addon messages left in the channel.
CleanupOnStartup: true

# How many recent messages cleanup scans. Hard cap: 100 (Discord limit).
CleanupScanLimit: 50

# Verbose logs. Turn on when diagnosing failed queries.
Debug: false

Servers:
  - ServerName: "My Minecraft Server"
    ChannelID: "1234567890123456789"   # Real Discord channel ID (18–20 digits)
    ServerIP: "play.myserver.net:25565"
    GameType: "minecraft"
    EmbedSettings:
      # ... see below
    VoiceDisplay:
      # ... see section 6 (optional)
```

> The shipped defaults use `REPLACE_WITH_CHANNEL_ID` and `*.example.com` as placeholders. Servers using those values are skipped at startup with a console reminder — replace them with real values before restarting.

### Per-server fields

| Field | Type | Description |
|---|---|---|
| `ServerName` | string | Internal label, shown in logs and inside button responses. |
| `ChannelID` | string | Discord channel ID where the embed is published. Right-click the channel → Copy ID. |
| `ServerIP` | string | `host` or `host:port`. If you omit the port, the game's default is used. |
| `GameType` | string | `gamedig` identifier (see section 3). |
| `EmbedSettings` | object | Visual customisation (see below). |
| `VoiceDisplay` | object | Optional voice-channel display (see section 6). |

### `EmbedSettings`

```yaml
EmbedSettings:
  # Custom thumbnail URL. Empty = auto icon (Minecraft Java only, via mcstatus.io).
  ThumbnailImage: ""

  OnlineColor: "#0bee00"
  OfflineColor: "#ee0000"
  EnableTimestamp: true

  # Hide the port from the displayed IP. The Connect button still uses the full address.
  HidePort: true

  # Max players listed inline in the embed. If more, the "View all players" button appears.
  MaxPlayersInList: 10

  ConnectButton:
    Enabled: true
    Emoji: "🔌"
  CopyIPButton:
    Enabled: true
    Emoji: "📥"
  PlayersButton:
    Enabled: true
    Emoji: "📋"

  # Optional: rename the embed fields. Defaults below.
  FieldTitles:
    Address: "📡 IP"
    Version: "💻 Version"
    Map: "🗺️ Map"
    GameMode: "🎮 Game Mode"
    Players: "👥 Players"
```

**Notes**

- Each button can be disabled independently with `Enabled: false`.
- The footer text is auto-resolved from the active language file per `GameType` (e.g. `Minecraft | Server Status`, `Garry's Mod | Server Status`). No need to set it manually.
- Button labels also come from the language file. To rename them, edit `embed.buttons.*` in `lang/<your-language>.yml`.

### Bot permissions

In each `ChannelID` channel the bot needs:
- ✅ Send Messages
- ✅ Embed Links
- ✅ Read Message History

If you enable voice display (section 6), also at the guild or category level:
- ✅ Manage Channels
- ✅ View Channels

---

## 3. Supported games (`GameType`)

`gamedig` supports **~570 games**. Most common ones:

| Game | `GameType` | Default port |
|---|---|---|
| Minecraft (Java) | `minecraft` | 25565 |
| Minecraft Bedrock | `minecraftpe` | 19132 |
| Garry's Mod | `garrysmod` | 27015 |
| Counter-Strike 2 | `counterstrike2` | 27015 |
| CS:GO | `csgo` | 27015 |
| Counter-Strike: Source | `css` | 27015 |
| Team Fortress 2 | `teamfortress2` | 27015 |
| Left 4 Dead 2 | `l4d2` | 27015 |
| Rust | `rust` | 28015 |
| ARK: Survival Evolved | `ase` | 27015 |
| ARK: Survival Ascended | `asa` | 27015 |
| Valheim | `valheim` | 2457 |
| DayZ | `dayz` | 27016 |
| 7 Days to Die | `7d2d` | 26900 |
| Squad | `squad` | 27165 |
| Insurgency: Sandstorm | `insurgencysandstorm` | 27102 |
| Conan Exiles | `conanexiles` | 27015 |
| Unturned | `unturned` | 27015 |
| Space Engineers | `spaceengineers` | 27016 |
| Project Zomboid | `projectzomboid` | 16261 |
| Palworld | `palworld` | 8211 |
| Quake 3 | `quake3` | 27960 |
| Mumble | `mumble` | 64738 |
| TeamSpeak 3 | `teamspeak3` | 9987 |

**Full list:** [GAMES_LIST.md in the gamedig repo](https://github.com/gamedig/node-gamedig/blob/master/GAMES_LIST.md).

> Source-engine games (CS, GMod, TF2, Rust, ARK, etc.) all use the same protocol. If your game isn't in the table but runs on Source, it probably works as long as you point at the right query port.

### Query port vs game port

Some games use **two different ports**: one to connect, another for status queries. If the query fails but the server is up, this is usually why. The `ServerIP` field needs the **query port**, not the connection port. Common cases:

- **ARK**: game 7777, query 27015 → `host:27015`.
- **Rust**: game 28015, query typically the same.
- **Valheim**: game 2456, query 2457 → `host:2457`.

Check the game's documentation if you're unsure.

---

## 4. First run

1. Make sure `gamedig` is installed (section 1).
2. Edit `Servers[]` with your real channels and server IPs.
3. Start the bot (`npm start`).
4. The console should show something like:
   ```
   [GameServerStatus] Started. Interval: 60s. Servers: 2.
   ```
5. Within a few seconds the embed appears in each configured channel.

If there were old messages piled up in the channel from a previous run, you'll see:
```
[GameServerStatus] Cleanup in #server-status (My server): 8 duplicate(s) deleted.
```

---

## 5. Using the buttons

The embed includes up to three buttons:

- **🔌 Connect** — replies (only visible to you) with the connection address. For Source-engine games it also adds a `steam://connect/...` quick link. Disabled automatically while the server is offline.
- **📥 Copy IP** — replies with the IP in a code block so you can copy it with one tap.
- **📋 View all players** — appears only when the server has **more players than `MaxPlayersInList`**. Shows the full list of players (and bots, if any).

Disable any of them independently in `EmbedSettings.<Button>.Enabled: false`.

> Right after a bot restart, buttons take up to one `UpdateInterval` to wake up. If you click before the first query completes you'll get *"I don't have fresh data for that server yet."* — just wait a few seconds and click again.

---

## 6. Voice Display (optional)

A second, opt-in display mode: the addon creates **read-only voice channels** whose *names* reflect the server status. Same data as the embed — just rendered into channel names. By default the channels are created at the **guild root** (no category) so you can drag them anywhere in your server. You can also opt into a category if you prefer a grouped block.

Looks like this in the channel list (default — no category):

```
🔊 ━━━━━━━━━━━━━━━
🔊 🎮 Hypixel
🔊 🟢 Status: Online
🔊 👥 Online: 68753/90000
🔊 📡 IP: mc.hypixel.net
🔊 ━━━━━━━━━━━━━━━
```

Or with a category (set `CategoryName: "SERVER STATUS"`):

```
▼ SERVER STATUS
  🔊 ━━━━━━━━━━━━━━━
  🔊 🎮 Hypixel
  🔊 🟢 Status: Online
  🔊 👥 Online: 68753/90000
  🔊 📡 IP: mc.hypixel.net
  🔊 ━━━━━━━━━━━━━━━
```

### Enabling it

Per server, under `Servers[x]`:

```yaml
VoiceDisplay:
  Enabled: true
  CategoryName: ""              # Empty = NO category (channels at guild root). Set a name to create/adopt one.
  CategoryID: ""                # Optional: existing category ID. Takes precedence over CategoryName.
  MinUpdateInterval: 300        # Min seconds between renames per channel (see rate limit below).
  Channels:
    DividerTop:    { Enabled: true }
    Label:         { Enabled: true }
    Status:        { Enabled: true }
    PlayerCount:   { Enabled: true }
    IP:            { Enabled: true }
    Version:       { Enabled: false }
    Map:           { Enabled: false }
    GameMode:      { Enabled: false }
    DividerBottom: { Enabled: true }
```

**Available channel types** (order = display order):

| Type | Default text | What it shows |
|---|---|---|
| `DividerTop` | `━━━━━━━━━━━━━━━` | Static separator above the status block. |
| `Label` | `🎮 {server}` | Identifies the server — uses your `ServerName`. |
| `Status` | `🟢 Status: Online` / `🔴 Status: Offline` | Up/down indicator. |
| `PlayerCount` | `👥 Online: {online}/{max}` | Player count. |
| `IP` | `📡 IP: {ip}` | Connection address. |
| `Version` | `💻 Version: {version}` | Game/server version. |
| `Map` | `🗺️ Map: {map}` | Current map. |
| `GameMode` | `🎮 Mode: {gameMode}` | Game mode (Garry's Mod and similar). |
| `DividerBottom` | `━━━━━━━━━━━━━━━` | Static separator below the status block. |

You don't need a separate `GuildID` — the guild is derived from the `ChannelID` you already configured for the embed.

### What gets created

On first start:

1. **Category** (optional): if both `CategoryName` and `CategoryID` are empty (the default), no category is created — voice channels go directly to the guild root. Otherwise:
   - `CategoryID` set → use that exact category.
   - `CategoryName` set → adopt an existing category with that name, or create a new one.
2. One voice channel per `Channels.<Type>.Enabled: true`. Each channel has `Connect` and `Speak` denied for `@everyone` — they're a *display*, not a chat room.

You can drag the channels around in Discord freely — the addon only updates names, never positions or parent. If you delete a channel, it's recreated at the guild root (or under the configured category) on the next boot.

### Discord rate limit

Discord limits channel renames to **2 per 10 minutes per channel**. Don't lower `MinUpdateInterval` below `300` (the default) — if you do, renames get throttled and skipped. If you tighten `UpdateInterval` below `MinUpdateInterval`, names simply update less often than you poll. No error, just slower updates.

### Customising channel text

Each channel entry under `Channels:` accepts an override key alongside `Enabled`. There are two kinds of channels:

| Channel kind | Override key(s) | Channels |
|---|---|---|
| Static (text doesn't change with server status) | `Format` | `DividerTop`, `Label`, `IP`, `DividerBottom` |
| Status-dependent (different text online/offline) | `FormatOnline`, `FormatOffline` | `Status`, `PlayerCount`, `Version`, `Map`, `GameMode` |

The autogenerated `config.yml` already lists the **default text for each channel as a commented line** right under the channel — uncomment it and edit to override. Example:

```yaml
Channels:
  Label:
    Enabled: true
    Format: "🎮 Minecraft Server"          # overrides the default "🎮 {server}"

  PlayerCount:
    Enabled: true
    FormatOnline: "🎮 {online} playing"    # overrides default while online
    FormatOffline: "💤 Server down"         # overrides default while offline

  DividerTop:
    Enabled: true
    Format: "═════ {server} ═════"
```

If you don't override anything, the channel uses the default text from `lang/<code>.yml` (e.g. `🎮 {server}` for `Label`).

**Available placeholders** inside any template:

| Placeholder | What it expands to |
|---|---|
| `{server}` | The `ServerName` you set in this server's config |
| `{gameType}` | The `GameType` (`minecraft`, `garrysmod`, etc.) |
| `{ip}` | The `ServerIP` you set |
| `{online}` | Current player count (live) |
| `{max}` | Max player slots (live) |
| `{version}` | Server version reported by gamedig (live) |
| `{map}` | Current map (live) |
| `{gameMode}` | Current game mode (live, Source-engine games) |

### Existing setups — channel order on upgrade

If you already had voice display running on a previous version and you enable the new `DividerTop` / `Label` / `DividerBottom` channels, Discord will create them **at the bottom of the category** (newly-created channels always land at the end). To get the intended layout, either drag them into the right spot manually in Discord, or delete all of the addon's voice channels and let it recreate them in order on the next boot.

### Cleanup

The addon **does not delete** voice channels on its own — not on restart, not when you set `Enabled: false`, not when you remove a server from `Servers[]`. They stay where they are so they don't flicker. If you stop using voice display, delete the channels (and the category) by hand in Discord.

---

## 7. Changing the language

```yaml
Language: "en"   # or "es"
```

The addon ships with **English** (`en`) and **Spanish** (`es`). To add a new language:

1. Copy `lang/en.yml` to `lang/<code>.yml` (e.g. `lang/de.yml`).
2. Translate the values. **Keep the `{placeholders}` intact** — they get replaced at runtime.
3. Set `Language: "<code>"` in `config.yml`.
4. Restart the bot.

---

## 8. Troubleshooting

**"No valid servers configured" appears in the console on first boot.**
- The default `config.yml` ships with placeholder values (`REPLACE_WITH_CHANNEL_ID`, `play.example.com`, etc.) so you can see the schema. Edit them with your real Discord channel IDs and server IPs, then restart. The addon will not post anything until at least one real server is configured.

**The embed doesn't appear.**
- Confirm `Enabled: true` and that the bot has `Send Messages`, `Embed Links`, and `Read Message History` in the channel.
- Check the console: if you see `Could not fetch channel ...`, the `ChannelID` is wrong or the bot lacks access. Discord channel IDs are 18–20 digits long; if yours is shorter, you copied something else.

**The console says `The 'gamedig' package is not installed`.**
- You skipped step 1 of the installation. Add `"gamedig": "^5.3.2"` to the `"dependencies"` section of your bot's `package.json`, run `npm install` from the bot's root directory, and restart. See section 1 for the full instructions.
- Verify it's installed with `npm ls gamedig` from the bot's root — you should see a `gamedig@5.3.x` entry.

**The server shows as offline even though it's up.**
- Enable `Debug: true` and check the log for `Query offline (...)`.
- Most common cause: wrong query port (see "Query port vs game port" in section 3).
- Some hosting providers block gamedig-style queries. Test the query from outside the bot (the `gamedig` CLI works) to rule out a network issue.

**Buttons don't respond / say "no fresh data".**
- Right after a bot restart, the first response cycle hasn't run yet. Buttons start working after the first `UpdateInterval` tick.

**Voice channels aren't being created.**
- The bot needs `Manage Channels` in the guild. If missing, the addon logs `Missing ManageChannels in guild ...; voice display disabled for ...` and the embed keeps working.

**The bot sent duplicate messages.**
- It shouldn't. If it does, restart — the startup cleanup pass sweeps orphans automatically (up to `CleanupScanLimit`). For >50 stale messages, raise `CleanupScanLimit` to 100 (Discord's hard cap) or delete the rest by hand.

**I want to wipe everything and start fresh.**
- Stop the bot, delete `addons/GameServerStatus/data/state.json`, delete the channel messages manually, restart. The addon will publish a new message.

**Found a bug or want a feature?**
- Open an issue at https://github.com/naghell/gameservercheck-addon-drako-bot/issues. PRs welcome.
