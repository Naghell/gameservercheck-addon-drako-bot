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

    let state;
    try {
        state = await getGameDig().query({
            type: gameType,
            host,
            port
        });
    } catch (err) {
        return { data: offlinePayload(display), error: err };
    }

    const playerList = extractList(state.players);
    const botList = extractList(state.bots);

    let gameMode = '';
    if (gameType === 'garrysmod' && state.raw) {
        gameMode = state.raw.gamemode || state.raw.game || state.raw.game_dir || '';
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
        error: null
    };
}

module.exports = { queryServer, sanitizeServerKey, parseAddress };
