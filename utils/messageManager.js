const { queryServer, sanitizeServerKey, parseAddress } = require('./serverQuery');
const {
    buildEmbed,
    isOurMessage,
    isLegacyServerCheckMessage,
    getServerKeyFromMessage
} = require('./embedBuilder');
const stateStore = require('./stateStore');
const voiceDisplay = require('./voiceDisplay');
const log = require('./logger');
const { t } = require('./i18n');

const UNKNOWN_MESSAGE_CODE = 10008;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

class StatusController {
    constructor(client, config) {
        this.client = client;
        this.config = config;
        this.interval = null;
        this.stopping = false;
        this.inFlight = new Map();
        this.cache = new Map();
    }

    getCachedState(serverKey) {
        return this.cache.get(serverKey) || null;
    }

    async start() {
        log.info(t('lifecycle.started', { interval: this.config.UpdateInterval, count: this.config.Servers.length }));

        if (this.config.CleanupOnStartup) {
            for (const server of this.config.Servers) {
                await this.cleanupOrphans(server).catch(err => {
                    log.warn(t('lifecycle.cleanupFailed', { server: server.ServerName, error: err.message }));
                });
            }
        }

        for (const server of this.config.Servers) {
            if (!server.VoiceDisplay?.Enabled) continue;
            try {
                const serverKey = sanitizeServerKey(server.ServerIP);
                const prev = await stateStore.get(serverKey);
                const voiceState = await voiceDisplay.ensureSetup(
                    this.client, server, server.VoiceDisplay, prev?.voice || null
                );
                if (voiceState) {
                    await stateStore.merge(serverKey, { voice: voiceState });
                }
            } catch (err) {
                log.warn(t('voice.logs.setupFailed', { server: server.ServerName, error: err.message }));
            }
        }

        await this.tick();
        this.interval = setInterval(() => {
            this.tick().catch(err => log.error(t('lifecycle.tickFailed', { error: err.message })));
        }, this.config.UpdateInterval * 1000);
    }

    async stop() {
        this.stopping = true;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        await Promise.allSettled(Array.from(this.inFlight.values()));
        log.info(t('lifecycle.stopped'));
    }

    async tick() {
        for (const server of this.config.Servers) {
            if (this.stopping) return;
            const serverKey = sanitizeServerKey(server.ServerIP);
            const prev = this.inFlight.get(serverKey) || Promise.resolve();
            const next = prev.then(() => this.processServer(server, serverKey)).catch(err => {
                log.error(t('lifecycle.processServerError', { server: server.ServerName, error: err.message }));
            });
            this.inFlight.set(serverKey, next);
            await next;
        }
    }

    async processServer(server, serverKey) {
        const channel = await this.fetchChannel(server);
        if (!channel) return;

        const { data, error } = await queryServer(server);
        if (error && this.config.Debug) {
            log.debug(t('lifecycle.queryOffline', { server: server.ServerName, error: error.message }));
        }

        const { display } = parseAddress(server.ServerIP, server.GameType);
        this.cache.set(serverKey, {
            data,
            serverConfig: server,
            serverAddress: display,
            gameType: server.GameType || 'minecraft'
        });

        const { embed, components } = buildEmbed(server, data, serverKey);
        await this.upsertMessage(serverKey, channel, embed, components);

        if (server.VoiceDisplay?.Enabled) {
            try {
                const prev = await stateStore.get(serverKey);
                const patch = await voiceDisplay.updateNames(
                    this.client, server, server.VoiceDisplay, prev?.voice || null, data
                );
                if (patch) {
                    await stateStore.merge(serverKey, { voice: patch });
                }
            } catch (err) {
                log.debug(t('voice.logs.updateFailed', { type: 'tick', server: server.ServerName, error: err.message }));
            }
        }
    }

    async fetchChannel(server) {
        try {
            return await this.client.channels.fetch(server.ChannelID);
        } catch (err) {
            log.warn(t('messages.channelFetchFailed', {
                channelId: server.ChannelID,
                server: server.ServerName,
                error: err.message
            }));
            return null;
        }
    }

    async upsertMessage(serverKey, channel, embed, components) {
        const entry = await stateStore.get(serverKey);
        const payload = { embeds: [embed], components };

        if (entry?.messageId && entry.channelId === channel.id) {
            try {
                const msg = await channel.messages.fetch(entry.messageId);
                await msg.edit(payload);
                return;
            } catch (err) {
                if (err.code === UNKNOWN_MESSAGE_CODE) {
                    log.info(t('messages.oldMessageDeleted', { key: serverKey }));
                } else {
                    log.warn(t('messages.editFailed', {
                        key: serverKey,
                        code: err.code || t('messages.editFailedNoCode'),
                        error: err.message
                    }));
                    return;
                }
            }
        }

        try {
            const sent = await channel.send(payload);
            await stateStore.set(serverKey, { messageId: sent.id, channelId: channel.id });
        } catch (err) {
            log.error(t('messages.sendFailed', { key: serverKey, error: err.message }));
        }
    }

    async cleanupOrphans(server) {
        const serverKey = sanitizeServerKey(server.ServerIP);
        const channel = await this.fetchChannel(server);
        if (!channel) return;

        const limit = Math.min(Math.max(this.config.CleanupScanLimit || 50, 1), 100);
        let fetched;
        try {
            fetched = await channel.messages.fetch({ limit });
        } catch (err) {
            log.warn(t('messages.scanFailed', { channel: channel.name || channel.id, error: err.message }));
            return;
        }

        const botId = this.client.user?.id;
        const targets = [];
        const legacy = [];

        for (const m of fetched.values()) {
            if (m.author?.id !== botId) continue;

            if (isLegacyServerCheckMessage(m)) {
                legacy.push(m);
                continue;
            }

            if (!isOurMessage(m)) continue;

            const msgKey = getServerKeyFromMessage(m);
            if (msgKey === null || msgKey === serverKey) {
                targets.push(m);
            }
        }

        targets.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
        const newest = targets[0] || null;
        const staleGss = targets.slice(1);
        const toDelete = [...staleGss, ...legacy];

        if (newest && toDelete.length === 0) {
            const existing = await stateStore.get(serverKey);
            if (!existing || existing.messageId !== newest.id || existing.channelId !== channel.id) {
                await stateStore.set(serverKey, { messageId: newest.id, channelId: channel.id });
                log.info(t('messages.adopted', {
                    messageId: newest.id,
                    channel: channel.name,
                    server: server.ServerName
                }));
            }
            return;
        }

        if (toDelete.length === 0) return;

        const now = Date.now();
        const bulkable = toDelete.filter(m => now - m.createdTimestamp < FOURTEEN_DAYS_MS);
        const individual = toDelete.filter(m => now - m.createdTimestamp >= FOURTEEN_DAYS_MS);

        try {
            if (bulkable.length >= 2) {
                await channel.bulkDelete(bulkable, true);
            } else if (bulkable.length === 1) {
                await bulkable[0].delete();
            }
        } catch (err) {
            log.warn(t('messages.bulkDeleteFailed', { channel: channel.name, error: err.message }));
            for (const m of bulkable) {
                await m.delete().catch(e => log.warn(t('messages.deleteFailed', { messageId: m.id, error: e.message })));
            }
        }
        for (const m of individual) {
            await m.delete().catch(e => log.warn(t('messages.deleteFailed', { messageId: m.id, error: e.message })));
        }

        if (newest) {
            await stateStore.set(serverKey, { messageId: newest.id, channelId: channel.id });
        }

        const summaryParts = [];
        if (staleGss.length) summaryParts.push(t('messages.duplicatesLabel', { count: staleGss.length }));
        if (legacy.length) summaryParts.push(t('messages.legacyLabel', { count: legacy.length }));
        const adoptedSuffix = newest ? t('messages.adoptedSuffix', { messageId: newest.id }) : '';
        log.info(t('messages.cleanupSummary', {
            channel: channel.name,
            server: server.ServerName,
            summary: summaryParts.join(' + '),
            adopted: adoptedSuffix
        }));
    }
}

module.exports = { StatusController };
