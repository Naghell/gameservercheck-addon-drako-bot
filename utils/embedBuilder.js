const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { t } = require('./i18n');

const ZWSP = '​';
const ZWNJ = '‌';
const ZWJ = '‍';
const WORD_JOINER = '⁠';

// Truly invisible signature appended to footer to identify our messages on cleanup.
// Uses zero-width chars only so users see nothing.
const GSS_SIGNATURE = ZWSP + ZWNJ + ZWJ + WORD_JOINER + ZWNJ + ZWSP + ZWJ + ZWNJ;

// Legacy visible marker we used in the first prototype. Kept here so cleanup can still
// recognise messages from that build and sweep them up.
const LEGACY_VISIBLE_MARKER = '[GSS:';

function buildFooterText(baseText) {
    const base = (baseText || '').trim();
    return base ? `${base}${GSS_SIGNATURE}` : GSS_SIGNATURE;
}

function resolveFooterText(gameType) {
    const key = `embed.footer.${gameType}`;
    const specific = t(key);
    if (specific !== key) return specific;
    return t('embed.footer.default', { game: gameType });
}

function isOurMessage(message) {
    const footer = message.embeds?.[0]?.footer?.text || '';
    return footer.includes(GSS_SIGNATURE) || footer.includes(LEGACY_VISIBLE_MARKER);
}

function isLegacyServerCheckMessage(message) {
    const rows = message.components || [];
    for (const row of rows) {
        const comps = row.components || [];
        for (const comp of comps) {
            const id = comp.customId;
            if (typeof id === 'string' && id.startsWith('servercheck_')) return true;
        }
    }
    return false;
}

function getServerKeyFromMessage(message) {
    const rows = message.components || [];
    for (const row of rows) {
        const comps = row.components || [];
        for (const comp of comps) {
            const id = comp.customId;
            if (typeof id === 'string' && id.startsWith('gss_')) {
                const parts = id.split('_');
                return parts.slice(2).join('_');
            }
        }
    }
    const footer = message.embeds?.[0]?.footer?.text || '';
    const legacyMatch = footer.match(/\[GSS:([^\]]+)\]/);
    if (legacyMatch) return legacyMatch[1];
    return null;
}

function buildButtonId(type, serverKey) {
    return `gss_${type}_${serverKey}`;
}

function fieldTitle(settings, key, fallbackI18nKey) {
    const override = settings.FieldTitles?.[key];
    if (typeof override === 'string' && override.trim()) return override;
    return t(fallbackI18nKey);
}

function stripPort(address) {
    if (!address) return address;
    // IPv6 with brackets: [::1]:25565 → [::1]
    if (address.startsWith('[')) {
        const end = address.indexOf(']');
        return end === -1 ? address : address.slice(0, end + 1);
    }
    const idx = address.lastIndexOf(':');
    return idx === -1 ? address : address.slice(0, idx);
}

function buildEmbed(server, data, serverKey) {
    const settings = server.EmbedSettings || {};
    const connectBtn = settings.ConnectButton || {};
    const playersBtn = settings.PlayersButton || {};
    const copyIpBtn = settings.CopyIPButton || {};
    const maxPlayersInList = settings.MaxPlayersInList || 10;
    const isOnline = data.online;
    const gameType = server.GameType || 'minecraft';
    const fullAddress = data.connect || server.ServerIP;
    const displayAddress = settings.HidePort ? stripPort(fullAddress) : fullAddress;

    const embed = new EmbedBuilder()
        .setColor(isOnline ? (settings.OnlineColor || '#0bee00') : (settings.OfflineColor || '#ee0000'))
        .setFooter({ text: buildFooterText(resolveFooterText(gameType)) });

    if (data.name && data.name.trim()) {
        embed.setTitle(data.name);
    }

    const headerFields = [
        { name: fieldTitle(settings, 'Address', 'embed.fields.address'), value: `\`${displayAddress}\``, inline: true }
    ];
    if (data.version && data.version.trim()) {
        headerFields.push({ name: fieldTitle(settings, 'Version', 'embed.fields.version'), value: data.version, inline: true });
    }
    embed.addFields(...headerFields);

    if (isOnline) {
        embed.addFields({ name: ZWSP, value: ZWSP, inline: false });

        const mapGameFields = [];
        if (data.map && data.map.trim()) {
            mapGameFields.push({ name: fieldTitle(settings, 'Map', 'embed.fields.map'), value: data.map, inline: true });
        }
        if (data.gameMode && data.gameMode.trim()) {
            mapGameFields.push({ name: fieldTitle(settings, 'GameMode', 'embed.fields.gameMode'), value: data.gameMode, inline: true });
        }
        if (mapGameFields.length > 0) {
            embed.addFields(...mapGameFields);
            embed.addFields({ name: ZWSP, value: ZWSP, inline: false });
        }

        const playerCount = data.players.online || 0;
        const maxPlayers = data.players.max || 0;
        const playersTitle = `${fieldTitle(settings, 'Players', 'embed.fields.players')} (${playerCount}/${maxPlayers})`;
        const visible = data.players.list.slice(0, maxPlayersInList);

        if (visible.length > 0) {
            const block = '```\n' + visible.map(p => `- ${p}`).join('\n') + '\n```';
            embed.addFields({ name: playersTitle, value: block, inline: false });
        } else {
            embed.addFields({ name: playersTitle, value: ZWSP, inline: false });
        }
    }

    const thumbnailUrl = settings.ThumbnailImage
        || (gameType === 'minecraft' ? `https://api.mcstatus.io/v2/icon/${server.ServerIP}` : '');
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

    if (settings.EnableTimestamp) embed.setTimestamp();

    const components = [];
    const row = new ActionRowBuilder();

    if (connectBtn.Enabled !== false) {
        const btn = new ButtonBuilder()
            .setCustomId(buildButtonId('connect', serverKey))
            .setLabel(t('embed.buttons.connect'))
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!isOnline);
        if (connectBtn.Emoji) btn.setEmoji(connectBtn.Emoji);
        row.addComponents(btn);
    }

    if (copyIpBtn.Enabled !== false) {
        const btn = new ButtonBuilder()
            .setCustomId(buildButtonId('copyip', serverKey))
            .setLabel(t('embed.buttons.copyIp'))
            .setStyle(ButtonStyle.Secondary);
        if (copyIpBtn.Emoji) btn.setEmoji(copyIpBtn.Emoji);
        row.addComponents(btn);
    }

    if (playersBtn.Enabled !== false && isOnline && data.players.list.length > maxPlayersInList) {
        const btn = new ButtonBuilder()
            .setCustomId(buildButtonId('players', serverKey))
            .setLabel(t('embed.buttons.viewAllPlayers'))
            .setStyle(ButtonStyle.Secondary);
        if (playersBtn.Emoji) btn.setEmoji(playersBtn.Emoji);
        row.addComponents(btn);
    }

    if (row.components.length > 0) components.push(row);

    return { embed, components };
}

module.exports = {
    buildEmbed,
    isOurMessage,
    isLegacyServerCheckMessage,
    getServerKeyFromMessage,
    GSS_SIGNATURE
};
