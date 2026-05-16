const { ChannelType, PermissionFlagsBits } = require('discord.js');
const log = require('./logger');
const { t } = require('./i18n');

const DISCORD_CHANNEL_NAME_MAX = 100;
// Order matters: this is the order channels are created in the category.
// Discord shows them in creation order (oldest first), so DividerTop must
// be created first and DividerBottom last.
const CHANNEL_TYPES = ['DividerTop', 'Label', 'Status', 'PlayerCount', 'IP', 'Version', 'Map', 'GameMode', 'DividerBottom'];

const TYPE_TO_LANG_KEY = {
    DividerTop: 'dividerTop',
    Label: 'label',
    Status: 'status',
    PlayerCount: 'playerCount',
    IP: 'ip',
    Version: 'version',
    Map: 'map',
    GameMode: 'gameMode',
    DividerBottom: 'dividerBottom'
};

// Types whose name does not depend on online/offline state — single Format template.
const STATIC_FORMAT_TYPES = new Set(['IP', 'Label', 'DividerTop', 'DividerBottom']);

const runtimeDisabled = new Set();

function truncate(name) {
    if (typeof name !== 'string') return '';
    return name.length > DISCORD_CHANNEL_NAME_MAX
        ? name.slice(0, DISCORD_CHANNEL_NAME_MAX)
        : name;
}

function buildVars(server, data) {
    return {
        online: data?.players?.online ?? 0,
        max: data?.players?.max ?? 0,
        ip: server.ServerIP || '',
        version: data?.version || '-',
        map: data?.map || '-',
        gameMode: data?.gameMode || '-',
        server: server.ServerName || server.ServerIP || '',
        gameType: server.GameType || ''
    };
}

function templateFor(type, isOnline, voiceConfig) {
    const langKey = TYPE_TO_LANG_KEY[type];
    const override = voiceConfig.Channels?.[type] || {};

    if (STATIC_FORMAT_TYPES.has(type)) {
        return override.Format || t(`voice.${langKey}.format`);
    }
    if (isOnline) {
        return override.FormatOnline || t(`voice.${langKey}.online`);
    }
    return override.FormatOffline || t(`voice.${langKey}.offline`);
}

function interpolate(template, vars) {
    if (typeof template !== 'string') return '';
    return template.replace(/\{(\w+)\}/g, (m, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m
    );
}

function renderChannelName(type, server, voiceConfig, data) {
    const isOnline = Boolean(data?.online);
    const template = templateFor(type, isOnline, voiceConfig);
    return truncate(interpolate(template, buildVars(server, data)));
}

function enabledTypes(voiceConfig) {
    return CHANNEL_TYPES.filter(type => voiceConfig.Channels?.[type]?.Enabled);
}

async function resolveGuild(client, server) {
    if (!server.ChannelID) return null;
    const channel = await client.channels.fetch(server.ChannelID);
    return channel?.guild || null;
}

function hasRequiredPerms(guild) {
    const me = guild.members?.me;
    if (!me) return false;
    return me.permissions.has(PermissionFlagsBits.ManageChannels)
        && me.permissions.has(PermissionFlagsBits.ViewChannel);
}

async function resolveCategory(guild, voiceConfig) {
    if (voiceConfig.CategoryID) {
        try {
            const cat = await guild.channels.fetch(voiceConfig.CategoryID);
            if (cat && cat.type === ChannelType.GuildCategory) {
                return { category: cat, created: false };
            }
        } catch {
            // fall through to name resolution
        }
    }

    const desiredName = voiceConfig.CategoryName && voiceConfig.CategoryName.trim();
    if (!desiredName) {
        // Default: no category. Voice channels are created at the guild root.
        return { category: null, created: false };
    }

    const existing = guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory && c.name === desiredName
    );
    if (existing) {
        log.info(t('voice.logs.categoryAdopted', { name: existing.name, id: existing.id }));
        return { category: existing, created: false };
    }

    const created = await guild.channels.create({
        name: desiredName,
        type: ChannelType.GuildCategory
    });
    log.info(t('voice.logs.categoryCreated', { name: created.name, guild: guild.name || guild.id }));
    return { category: created, created: true };
}

function permissionOverwritesForDisplay(guild) {
    return [
        {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
        }
    ];
}

async function ensureVoiceChannel(guild, category, type, server, voiceConfig, persistedEntry) {
    if (persistedEntry?.id) {
        try {
            const existing = await guild.channels.fetch(persistedEntry.id);
            if (existing && existing.type === ChannelType.GuildVoice) {
                return { id: existing.id, lastName: existing.name, lastUpdate: persistedEntry.lastUpdate || 0, recreated: false };
            }
        } catch (err) {
            if (err.code !== 10003) {
                throw err;
            }
            log.info(t('voice.logs.channelRecreated', { id: persistedEntry.id, newId: '(pending)' }));
        }
    }

    const initialName = truncate(renderChannelName(type, server, voiceConfig, { online: false }));
    const createOpts = {
        name: initialName,
        type: ChannelType.GuildVoice,
        permissionOverwrites: permissionOverwritesForDisplay(guild)
    };
    if (category) createOpts.parent = category.id;

    const created = await guild.channels.create(createOpts);
    log.info(t('voice.logs.channelCreated', {
        name: created.name,
        category: category ? category.name : t('voice.logs.noCategoryLabel')
    }));
    return { id: created.id, lastName: created.name, lastUpdate: 0, recreated: false };
}

async function ensureSetup(client, server, voiceConfig, persistedVoiceState) {
    const guild = await resolveGuild(client, server);
    if (!guild) {
        log.warn(t('voice.logs.setupFailed', {
            server: server.ServerName,
            error: `cannot resolve guild from ChannelID ${server.ChannelID}`
        }));
        return null;
    }

    if (!hasRequiredPerms(guild)) {
        log.warn(t('voice.logs.permissionMissing', {
            guild: guild.name || guild.id,
            server: server.ServerName
        }));
        runtimeDisabled.add(server.ServerIP);
        return null;
    }

    const { category } = await resolveCategory(guild, voiceConfig);

    const channels = {};
    const previousChannels = persistedVoiceState?.channels || {};

    for (const type of enabledTypes(voiceConfig)) {
        try {
            channels[type] = await ensureVoiceChannel(
                guild, category, type, server, voiceConfig, previousChannels[type]
            );
        } catch (err) {
            log.warn(t('voice.logs.updateFailed', {
                type,
                server: server.ServerName,
                error: err.message
            }));
        }
    }

    return { categoryId: category ? category.id : null, channels };
}

async function updateNames(client, server, voiceConfig, persistedVoiceState, data) {
    if (runtimeDisabled.has(server.ServerIP)) return null;
    if (!persistedVoiceState || !persistedVoiceState.channels) return null;

    const patch = { categoryId: persistedVoiceState.categoryId, channels: {} };
    let mutated = false;

    for (const type of enabledTypes(voiceConfig)) {
        const entry = persistedVoiceState.channels[type];
        if (!entry?.id) continue;

        const desiredName = renderChannelName(type, server, voiceConfig, data);

        if (desiredName === entry.lastName) {
            patch.channels[type] = entry;
            continue;
        }

        const minIntervalMs = (voiceConfig.MinUpdateInterval || 300) * 1000;
        const elapsed = Date.now() - (entry.lastUpdate || 0);
        if (elapsed < minIntervalMs) {
            log.debug(t('voice.logs.rateLimited', {
                type,
                server: server.ServerName,
                seconds: Math.floor(elapsed / 1000)
            }));
            patch.channels[type] = entry;
            continue;
        }

        try {
            const channel = await client.channels.fetch(entry.id);
            await channel.setName(desiredName);
            patch.channels[type] = {
                id: entry.id,
                lastName: desiredName,
                lastUpdate: Date.now()
            };
            mutated = true;
        } catch (err) {
            if (err.code === 10003) {
                log.info(t('voice.logs.channelRecreated', { id: entry.id, newId: '(next start)' }));
                mutated = true;
                continue;
            }
            if (err.code === 50013 || err.code === 50001) {
                log.warn(t('voice.logs.permissionMissing', {
                    guild: '(unknown)',
                    server: server.ServerName
                }));
                runtimeDisabled.add(server.ServerIP);
                return null;
            }
            log.warn(t('voice.logs.updateFailed', {
                type,
                server: server.ServerName,
                error: err.message
            }));
            patch.channels[type] = entry;
        }
    }

    return mutated ? patch : null;
}

module.exports = { ensureSetup, updateNames };
