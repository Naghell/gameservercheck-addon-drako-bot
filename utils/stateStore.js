const fs = require('fs').promises;
const path = require('path');
const log = require('./logger');
const { t } = require('./i18n');

const STATE_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const TMP_FILE = path.join(STATE_DIR, 'state.json.tmp');

let cache = null;
let writeChain = Promise.resolve();

async function ensureDir() {
    try {
        await fs.mkdir(STATE_DIR, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
}

async function load() {
    if (cache) return cache;
    try {
        const raw = await fs.readFile(STATE_FILE, 'utf8');
        cache = JSON.parse(raw);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            log.warn(t('state.corrupted', { error: err.message }));
        }
        cache = {};
    }
    return cache;
}

async function persist() {
    await ensureDir();
    const payload = JSON.stringify(cache, null, 2);
    await fs.writeFile(TMP_FILE, payload, 'utf8');
    await fs.rename(TMP_FILE, STATE_FILE);
}

async function get(key) {
    const state = await load();
    return state[key] || null;
}

async function set(key, value) {
    const state = await load();
    state[key] = { ...value, updatedAt: Date.now() };
    writeChain = writeChain.then(persist).catch(err => {
        log.error(t('state.saveFailed', { error: err.message }));
    });
    await writeChain;
}

async function merge(key, value) {
    const state = await load();
    state[key] = { ...(state[key] || {}), ...value, updatedAt: Date.now() };
    writeChain = writeChain.then(persist).catch(err => {
        log.error(t('state.saveFailed', { error: err.message }));
    });
    await writeChain;
}

async function remove(key) {
    const state = await load();
    if (!state[key]) return;
    delete state[key];
    writeChain = writeChain.then(persist).catch(err => {
        log.error(t('state.saveFailed', { error: err.message }));
    });
    await writeChain;
}

module.exports = { load, get, set, merge, remove };
