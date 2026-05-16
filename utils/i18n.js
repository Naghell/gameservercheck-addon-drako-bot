const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const FALLBACK_LANGUAGE = 'en';
const LANG_DIR = path.join(__dirname, '..', 'lang');
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

let activeLanguage = FALLBACK_LANGUAGE;
let activeStrings = {};
let fallbackStrings = {};
let warned = new Set();

function readLanguageFromConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return FALLBACK_LANGUAGE;
    try {
        const parsed = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const lang = parsed && typeof parsed.Language === 'string' ? parsed.Language.trim() : '';
        return lang || FALLBACK_LANGUAGE;
    } catch {
        return FALLBACK_LANGUAGE;
    }
}

function loadLangFile(code) {
    const filePath = path.join(LANG_DIR, `${code}.yml`);
    if (!fs.existsSync(filePath)) return null;
    try {
        const parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
        console.warn(`[GameServerStatus] Error loading lang/${code}.yml: ${err.message}`);
        return null;
    }
}

function lookup(strings, key) {
    if (!strings) return undefined;
    const parts = key.split('.');
    let cursor = strings;
    for (const part of parts) {
        if (cursor === null || typeof cursor !== 'object' || !(part in cursor)) {
            return undefined;
        }
        cursor = cursor[part];
    }
    return cursor;
}

function interpolate(template, vars) {
    if (typeof template !== 'string') return template;
    if (!vars) return template;
    return template.replace(PLACEHOLDER_PATTERN, (match, name) => {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
    });
}

function warnOnce(message) {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(`[GameServerStatus] ${message}`);
}

function load() {
    const requested = readLanguageFromConfig();
    fallbackStrings = loadLangFile(FALLBACK_LANGUAGE) || {};

    if (requested === FALLBACK_LANGUAGE) {
        activeLanguage = FALLBACK_LANGUAGE;
        activeStrings = fallbackStrings;
        return;
    }

    const requestedStrings = loadLangFile(requested);
    if (!requestedStrings) {
        const message = lookup(fallbackStrings, 'config.invalidLanguage');
        const rendered = message
            ? interpolate(message, { lang: requested, fallback: FALLBACK_LANGUAGE })
            : `Language '${requested}' not found in lang/. Falling back to '${FALLBACK_LANGUAGE}'.`;
        console.warn(`[GameServerStatus] ${rendered}`);
        activeLanguage = FALLBACK_LANGUAGE;
        activeStrings = fallbackStrings;
        return;
    }

    activeLanguage = requested;
    activeStrings = requestedStrings;
}

function t(key, vars) {
    let value = lookup(activeStrings, key);
    if (value === undefined && activeStrings !== fallbackStrings) {
        value = lookup(fallbackStrings, key);
        if (value !== undefined) {
            warnOnce(`Missing translation for key '${key}' in lang/${activeLanguage}.yml`);
        }
    }
    if (value === undefined) {
        warnOnce(`Missing translation key '${key}' in all language files`);
        return key;
    }
    return interpolate(value, vars);
}

function getCurrentLanguage() {
    return activeLanguage;
}

function reload() {
    warned = new Set();
    load();
}

load();

module.exports = { t, getCurrentLanguage, reload };
