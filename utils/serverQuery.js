const log = require('./logger');

let _GameDig = null;
function getGameDig() {
    if (_GameDig) return _GameDig;
    _GameDig = require('gamedig').GameDig;
    return _GameDig;
}

const DEFAULT_PORTS = {
    minecraft: 25565,
    garrysmod: 27015
};

const DEFAULT_QUERY_PROFILE = {
    socketTimeout: 1500,
    attemptTimeout: 2500,
    maxAttempts: 1
};

const SLOW_QUERY_PROFILES = {
    killingfloor: { socketTimeout: 1500, attemptTimeout: 7000, maxAttempts: 2 },
    ut2004: { socketTimeout: 1500, attemptTimeout: 7000, maxAttempts: 2 }
};

function getQueryProfile(gameType) {
    return SLOW_QUERY_PROFILES[gameType] || DEFAULT_QUERY_PROFILE;
}

const QUERY_DEBUG = process.env.GSS_QUERY_DEBUG === '1'
    || process.env.GSS_QUERY_DEBUG === 'true';

function dumpQueryError(gameType, host, port, err) {
    if (!QUERY_DEBUG) return;
    /* eslint-disable no-console */
    console.error(`[GSS] query FAILED type=${gameType} ${host}:${port}`);
    console.error(err && err.stack ? err.stack : err);
    // gamedig may attach the per-attempt errors that its top-level message hides.
    if (err && err.cause) console.error('  cause:', err.cause);
    if (err && Array.isArray(err.errors)) {
        err.errors.forEach((e, i) => console.error(`  attempt[${i}]:`, e && e.message ? e.message : e));
    }
    /* eslint-enable no-console */
}

function sanitizeServerKey(serverIP) {
    return serverIP.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

function parseAddress(serverIP, gameType) {
    const [host, rawPort] = serverIP.split(':');
    const defaultPort = DEFAULT_PORTS[gameType] || 25565;
    const port = rawPort ? parseInt(rawPort, 10) : defaultPort;
    const display = rawPort ? serverIP : `${serverIP}:${port}`;
    return { host, port, display };
}

function parseMinecraftMOTD(component) {
    if (!component) return '';
    if (typeof component === 'string') {
        return component.replace(/§[0-9a-fk-or]/gi, '').trim();
    }
    if (Array.isArray(component)) {
        return component.map(parseMinecraftMOTD).filter(Boolean).join('');
    }
    let result = '';
    if (typeof component.text === 'string') {
        result += component.text.replace(/§[0-9a-fk-or]/gi, '').trim();
    }
    if (Array.isArray(component.extra)) {
        result += component.extra.map(parseMinecraftMOTD).filter(Boolean).join('');
    }
    return result;
}

function normalizeName(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry.trim();
    if (typeof entry.name === 'string') return entry.name.trim();
    return String(entry).trim();
}

function extractList(rawList) {
    return (rawList || []).map(normalizeName).filter(name => name.length > 0);
}

function offlinePayload(connect) {
    return {
        online: false,
        name: '',
        map: '',
        gameMode: '',
        password: false,
        players: { online: 0, max: 0, list: [], bots: [] },
        version: '',
        connect,
        ping: 0
    };
}

async function queryServer(server) {
    const gameType = server.GameType || 'minecraft';
    const { host, port, display } = parseAddress(server.ServerIP, gameType);
    const profile = getQueryProfile(gameType);
    const meta = { gameType, address: display };

    let state;
    try {
        state = await getGameDig().query({
            type: gameType,
            host,
            port,
            socketTimeout: profile.socketTimeout,
            attemptTimeout: profile.attemptTimeout,
            maxAttempts: profile.maxAttempts,
            debug: QUERY_DEBUG
        });
    } catch (err) {
        dumpQueryError(gameType, host, port, err);
        return { data: offlinePayload(display), error: err, meta };
    }

    let playerList = extractList(state.players);
    let botList = extractList(state.bots);

    let gameMode = '';
    if (gameType === 'garrysmod' && state.raw) {
        gameMode = state.raw.gamemode || state.raw.game || state.raw.game_dir || '';
    }

    // Optional Minecraft-only secondary query for the player NAME list when the
    // primary endpoint is a proxy (BungeeCord/Velocity) that exposes the count
    // but not the names. We replace only players.list/bots here — every other
    // field still comes from the primary query.
    if (gameType === 'minecraft'
        && typeof server.PlayerListIP === 'string'
        && server.PlayerListIP.trim()) {
        try {
            const alt = parseAddress(server.PlayerListIP, 'minecraft');
            const altState = await getGameDig().query({
                type: 'minecraft',
                host: alt.host,
                port: alt.port,
                socketTimeout: DEFAULT_QUERY_PROFILE.socketTimeout,
                attemptTimeout: DEFAULT_QUERY_PROFILE.attemptTimeout,
                maxAttempts: DEFAULT_QUERY_PROFILE.maxAttempts
            });
            const altList = extractList(altState.players);
            const altBots = extractList(altState.bots);
            if (altList.length > 0) playerList = altList;
            if (altBots.length > 0) botList = altBots;
        } catch (err) {
            log.debug(`PlayerListIP query failed for ${server.ServerName || server.ServerIP}: ${err.message}`);
        }
    }

    return {
        data: {
            online: true,
            name: state.name || '',
            map: state.map || '',
            gameMode,
            password: Boolean(state.password),
            players: {
                online: state.numplayers ?? playerList.length,
                max: state.maxplayers || 0,
                list: playerList,
                bots: botList
            },
            version: state.version || '',
            connect: state.connect || display,
            ping: state.ping || 0,
            motd: gameType === 'minecraft' ? parseMinecraftMOTD(state.description) : ''
        },
        error: null,
        meta
    };
}

module.exports = { queryServer, sanitizeServerKey, parseAddress };
