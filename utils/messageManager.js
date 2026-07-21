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
// Sticky-online: while we have a recent successful query with players,
// tolerate this many consecutive failed queries before flipping to offline.
const MAX_GRACE_FAILURES = 2;

// Fingerprint the payload (minus the auto-timestamp) so we can skip Discord
// edits when nothing meaningful changed since the last tick.
function payloadFingerprint(embed, components) {
    const e = embed.toJSON();
    delete e.timestamp;
    const c = components.map(comp => comp.toJSON());
    return JSON.stringify({ e, c });
}

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
        const promises = [];
        for (const server of this.config.Servers) {
            if (this.stopping) return;
            const serverKey = sanitizeServerKey(server.ServerIP);
            const prev = this.inFlight.get(serverKey) || Promise.resolve();
            const next = prev.then(() => {
                if (this.stopping) return;
                return this.processServer(server, serverKey);
            }).catch(err => {
                log.error(t('lifecycle.processServerError', { server: server.ServerName, error: err.message }));
            });
            this.inFlight.set(serverKey, next);
            promises.push(next);
        }
        await Promise.all(promises);
    }

    async processServer(server, serverKey) {
        const channel = await this.fetchChannel(server);
        if (!channel) return;

        const { data: freshData, error, meta } = await queryServer(server);
        const gameType = meta?.gameType || server.GameType || 'minecraft';
        const address = meta?.address || server.ServerIP;
        if (error && this.config.Debug) {
            log.debug(t('lifecycle.queryOffline', {
                server: server.ServerName,
                gameType,
                address,
                error: error.message
            }));
        } else if (!error && this.config.Debug) {
            log.debug(t('lifecycle.queryOk', {
                server: server.ServerName,
                gameType,
                address,
                online: freshData.players?.online ?? 0,
                max: freshData.players?.max ?? 0,
                ping: freshData.ping ?? 0
            }));
        }

        const cached = this.cache.get(serverKey);
        let lastGood = cached?.lastGood || null;
        let consecutiveFailures;
        let effectiveData = freshData;

        if (freshData.online) {
            consecutiveFailures = 0;
            lastGood = freshData;
        } else {
            consecutiveFailures = (cached?.consecutiveFailures || 0) + 1;

            const canHold = lastGood?.online && consecutiveFailures <= MAX_GRACE_FAILURES;
            if (canHold) {
                effectiveData = lastGood;
                if (this.config.Debug) {
                    log.debug(t('lifecycle.graceHold', {
                        server: server.ServerName,
                        failures: consecutiveFailures,
                        max: MAX_GRACE_FAILURES
                    }));
                }
            } else if (lastGood?.online && this.config.Debug) {
                log.debug(t('lifecycle.graceExpired', {
                    server: server.ServerName,
                    failures: consecutiveFailures
                }));
            }
        }

        const { embed, components } = buildEmbed(server, effectiveData, serverKey);
        const fingerprint = payloadFingerprint(embed, components);
        const unchanged = cached?.lastFingerprint === fingerprint;

        const { display } = parseAddress(server.ServerIP, server.GameType);
        this.cache.set(serverKey, {
            data: effectiveData,
            lastGood,
            consecutiveFailures,
            lastFingerprint: fingerprint,
            serverConfig: server,
            serverAddress: display,
            gameType: server.GameType || 'minecraft'
        });

        await this.upsertMessage(serverKey, channel, embed, components, unchanged);

        if (server.VoiceDisplay?.Enabled) {
            try {
                const prev = await stateStore.get(serverKey);
                const patch = await voiceDisplay.updateNames(
                    this.client, server, server.VoiceDisplay, prev?.voice || null, effectiveData
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

    async upsertMessage(serverKey, channel, embed, components, skipIfUnchanged = false) {
        const entry = await stateStore.get(serverKey);
        if (skipIfUnchanged && entry?.messageId && entry.channelId === channel.id) {
            return;
        }
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
