const PREFIX = '[GameServerStatus]';

let debugEnabled = false;

function setDebug(enabled) {
    debugEnabled = Boolean(enabled);
}

function info(...args) {
    console.log(PREFIX, ...args);
}

function warn(...args) {
    console.warn(PREFIX, ...args);
}

function error(...args) {
    console.error(PREFIX, ...args);
}

function debug(...args) {
    if (debugEnabled) console.log(PREFIX, '[debug]', ...args);
}

module.exports = { setDebug, info, warn, error, debug };
