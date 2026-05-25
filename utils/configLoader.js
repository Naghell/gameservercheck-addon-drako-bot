const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const log = require('./logger');
const { t } = require('./i18n');
const { migrate, backupAndPersist, LATEST_VERSION } = require('./configMigrator');

const MIN_INTERVAL_SECONDS = 15;
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');

const PLACEHOLDER_CHANNEL_ID = 'REPLACE_WITH_CHANNEL_ID';
const PLACEHOLDER_IP_DOMAIN = 'example.com';
const CHANNEL_ID_PATTERN = /^\d{17,20}$/;

const DEFAULT_CONFIG_YAML = `# ===========================================================================
# GameServerStatus — Configuration
# ===========================================================================
# Live status for game servers (Minecraft, Garry's Mod, etc.).
# One embed per channel, edited in place.
#
# If this file does not exist, it is auto-generated with the values below on
# first start. Once generated, edit it by hand and restart the bot.
#
# All user-facing strings (logs, embeds, button labels, field titles) live in
# the lang/ folder. Pick the active one with the "Language" key below.
#
# The "Version" key tracks the config schema. When the addon ships with a
# newer version, missing fields are added automatically and the previous
# file is saved as config.yml.bak.v<old>.<timestamp> next to it.

Version: "1.0.0"

# Active language. Accepted values match files in lang/ (e.g. "en", "es").
# Drop a new lang/<code>.yml to add more languages.
Language: "en"

Enabled: true

# Seconds between updates. Minimum allowed: 15.
UpdateInterval: 60

# On startup, delete orphan addon messages in the configured channels.
CleanupOnStartup: true

# How many recent messages cleanup scans. Hard cap: 100 (Discord limit).
CleanupScanLimit: 50

# Verbose logs (turn on when diagnosing failed queries).
Debug: false

# ---------------------------------------------------------------------------
# IMPORTANT: The two servers below are PLACEHOLDERS so you can see the schema.
# Replace ChannelID and ServerIP with your real values before restarting.
# Until you do, those servers are skipped and you'll see a reminder in the
# console explaining what to edit.
# ---------------------------------------------------------------------------

Servers:
  - ServerName: "Example Minecraft Server"
    ChannelID: "REPLACE_WITH_CHANNEL_ID"
    ServerIP: "play.example.com:25565"
    GameType: "minecraft"
    # Optional (Minecraft only). If ServerIP above points to a BungeeCord/Velocity
    # proxy that does not expose the player NAME list, set this to the backend
    # server (lobby/hub) the names should be queried from. Only the list of
    # names is taken from here — online/max count, version, MOTD, the displayed
    # IP and the connect button all keep using ServerIP above.
    # PlayerListIP: "lobby.internal:25566"
    EmbedSettings:
      # Custom thumbnail URL. Empty = auto icon (Minecraft Java only, via mcstatus.io).
      ThumbnailImage: ""
      OnlineColor: "#0bee00"
      OfflineColor: "#ee0000"
      EnableTimestamp: true
      # Hide the port from the displayed IP (the connect button still uses the full address).
      HidePort: true
      ConnectButton:
        Enabled: true
        Emoji: "🔌"
      PlayersButton:
        Enabled: true
        Emoji: "📋"
      CopyIPButton:
        Enabled: true
        Emoji: "📥"
      # Maximum players listed inline in the embed. If more, the "View all" button appears.
      MaxPlayersInList: 10
      # Optional: override embed field titles. Remove or comment out to use the
      # defaults from the active language file.
      # FieldTitles:
      #   Address: "📡 IP"
      #   Version: "💻 Version"
      #   Map: "🗺️ Map"
      #   GameMode: "🎮 Game Mode"
      #   Players: "👥 Players"

    # ─────────────────────────────────────────────────────────────────────────
    # Optional voice-channel display.
    # When Enabled, the addon creates read-only voice channels whose NAMES
    # reflect the server status — same data as the embed, just rendered into
    # channel names.
    #
    # Each Channel below has:
    #   - Enabled:        true/false
    #   - Format:         single template (for static channels — IP, Label,
    #                     DividerTop, DividerBottom)
    #   - FormatOnline:   template used while the server is online
    #   - FormatOffline:  template used while the server is offline
    #
    # Format keys are commented out by default — uncomment and edit to override.
    # Available placeholders: {server}, {gameType}, {ip}, {online}, {max},
    # {version}, {map}, {gameMode}.
    # ─────────────────────────────────────────────────────────────────────────
    VoiceDisplay:
      Enabled: false
      CategoryName: ""              # Empty = NO category (channels created at the guild root). Set a name to create/adopt a category.
      CategoryID: ""                # Optional: existing category ID. Takes precedence over CategoryName.
      MinUpdateInterval: 300        # Min seconds between renames per channel (Discord rate-limits at 2/10min).
      Channels:
        DividerTop:
          Enabled: true
          # Format: "━━━━━━━━━━━━━━━"

        Label:
          Enabled: true
          # Format: "🎮 {server}"

        Status:
          Enabled: true
          # FormatOnline: "🟢 Status: Online"
          # FormatOffline: "🔴 Status: Offline"

        PlayerCount:
          Enabled: true
          # FormatOnline: "👥 Online: {online}/{max}"
          # FormatOffline: "👥 Online: 0/0"

        IP:
          Enabled: true
          # Format: "📡 IP: {ip}"

        Version:
          Enabled: false
          # FormatOnline: "💻 Version: {version}"
          # FormatOffline: "💻 Version: -"

        Map:
          Enabled: false
          # FormatOnline: "🗺️ Map: {map}"
          # FormatOffline: "🗺️ Map: -"

        GameMode:
          Enabled: false
          # FormatOnline: "🎮 Mode: {gameMode}"
          # FormatOffline: "🎮 Mode: -"

        DividerBottom:
          Enabled: true
          # Format: "━━━━━━━━━━━━━━━"

  - ServerName: "Example Garry's Mod Server"
    ChannelID: "REPLACE_WITH_CHANNEL_ID"
    ServerIP: "gmod.example.com:27015"
    GameType: "garrysmod"
    EmbedSettings:
      ThumbnailImage: ""
      OnlineColor: "#0bee00"
      OfflineColor: "#ee0000"
      EnableTimestamp: true
      HidePort: false
      ConnectButton:
        Enabled: true
        Emoji: "🔌"
      PlayersButton:
        Enabled: true
        Emoji: "📋"
      CopyIPButton:
        Enabled: true
        Emoji: "📥"
      MaxPlayersInList: 10
`;

function isPlaceholderChannel(id) {
    if (typeof id !== 'string') return true;
    if (id === PLACEHOLDER_CHANNEL_ID) return true;
    if (!CHANNEL_ID_PATTERN.test(id)) return true;
    return false;
}

function isPlaceholderIp(ip) {
    if (typeof ip !== 'string' || !ip.trim()) return true;
    return ip.toLowerCase().includes(PLACEHOLDER_IP_DOMAIN);
}

function validate(config) {
    if (!Array.isArray(config.Servers) || config.Servers.length === 0) {
        throw new Error(t('config.serversArrayInvalid'));
    }

    if (typeof config.UpdateInterval !== 'number' || config.UpdateInterval < MIN_INTERVAL_SECONDS) {
        log.warn(t('config.intervalTooLow', { value: config.UpdateInterval, min: MIN_INTERVAL_SECONDS }));
        config.UpdateInterval = MIN_INTERVAL_SECONDS;
    }

    const valid = [];

    config.Servers.forEach((server, idx) => {
        const label = server.ServerName || `Servers[${idx}]`;

        if (!server.ChannelID) {
            log.warn(t('config.missingChannelId', { idx }));
            return;
        }
        if (!server.ServerIP) {
            log.warn(t('config.missingServerIp', { idx }));
            return;
        }
        if (isPlaceholderChannel(server.ChannelID)) {
            log.warn(t('config.channelIdPlaceholder', { idx, server: label }));
            return;
        }
        if (isPlaceholderIp(server.ServerIP)) {
            log.warn(t('config.serverIpPlaceholder', { idx, server: label }));
            return;
        }

        if (!server.ServerName) server.ServerName = server.ServerIP;
        if (!server.GameType) server.GameType = 'minecraft';

        if (typeof server.PlayerListIP === 'string') {
            const trimmed = server.PlayerListIP.trim();
            if (!trimmed) {
                delete server.PlayerListIP;
            } else if (server.GameType !== 'minecraft') {
                log.warn(t('config.playerListIpIgnored', {
                    server: label,
                    gameType: server.GameType
                }));
                delete server.PlayerListIP;
            } else {
                server.PlayerListIP = trimmed;
            }
        } else if (server.PlayerListIP != null) {
            delete server.PlayerListIP;
        }

        server.EmbedSettings = server.EmbedSettings || {};
        server.EmbedSettings.ConnectButton = server.EmbedSettings.ConnectButton || {};
        server.EmbedSettings.PlayersButton = server.EmbedSettings.PlayersButton || {};
        server.EmbedSettings.CopyIPButton = server.EmbedSettings.CopyIPButton || {};

        server.VoiceDisplay = server.VoiceDisplay || { Enabled: false };
        if (server.VoiceDisplay.Enabled) {
            server.VoiceDisplay.MinUpdateInterval = Math.max(60, server.VoiceDisplay.MinUpdateInterval || 300);
            server.VoiceDisplay.Channels = server.VoiceDisplay.Channels || {};
            for (const type of ['DividerTop', 'Label', 'Status', 'PlayerCount', 'IP', 'Version', 'Map', 'GameMode', 'DividerBottom']) {
                server.VoiceDisplay.Channels[type] = server.VoiceDisplay.Channels[type] || { Enabled: false };
            }
        }

        valid.push(server);
    });

    if (valid.length === 0) {
        log.warn(t('config.allServersPlaceholders'));
    }

    config.Servers = valid;
    return config;
}

function loadConfig() {
    let rawYaml;

    if (!fs.existsSync(CONFIG_PATH)) {
        log.info(t('config.configNotFound'));
        fs.writeFileSync(CONFIG_PATH, DEFAULT_CONFIG_YAML, 'utf8');
        rawYaml = DEFAULT_CONFIG_YAML;
    } else {
        rawYaml = fs.readFileSync(CONFIG_PATH, 'utf8');
    }

    let parsed;
    try {
        parsed = yaml.load(rawYaml);
    } catch (err) {
        throw new Error(t('config.invalidYaml', { error: err.message }));
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error(t('config.notAnObject'));
    }

    const { migrated, changed, fromVersion } = migrate(parsed);
    if (changed) {
        try {
            backupAndPersist(CONFIG_PATH, migrated, fromVersion);
        } catch (err) {
            log.warn(t('migration.persistFailed', { error: err.message }));
        }
    }

    return validate(migrated);
}

module.exports = { loadConfig, MIN_INTERVAL_SECONDS, LATEST_VERSION };
