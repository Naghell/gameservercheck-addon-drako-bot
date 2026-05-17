#!/usr/bin/env node
// Cross-platform release builder. Produces dist/GameServerStatus-v<version>.zip
// containing only the files a buyer needs, with a freshly-generated config.yml.
// No external dependencies — pure Node stdlib.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(ROOT, 'dist');
const TOP_LEVEL = 'GameServerStatus';

function readText(rel) {
    return readFileSync(join(ROOT, rel), 'utf8');
}

function readBin(rel) {
    return readFileSync(join(ROOT, rel));
}

function extractVersion() {
    const src = readText('gameServerStatus.js');
    const m = src.match(/version:\s*['"]([^'"]+)['"]/);
    if (!m) throw new Error('Could not find version in gameServerStatus.js');
    return m[1];
}

function extractDefaultConfig() {
    const src = readText('utils/configLoader.js');
    const m = src.match(/DEFAULT_CONFIG_YAML\s*=\s*`([\s\S]*?)`;/);
    if (!m) throw new Error('Could not find DEFAULT_CONFIG_YAML in utils/configLoader.js');
    return m[1];
}

function syntaxCheckJs(files) {
    for (const rel of files) {
        try {
            execFileSync(process.execPath, ['--check', join(ROOT, rel)], { stdio: 'pipe' });
        } catch (err) {
            const stderr = err.stderr ? err.stderr.toString() : err.message;
            throw new Error(`Syntax check failed for ${rel}:\n${stderr}`);
        }
    }
}

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}

function buildZip(entries) {
    const { time, date } = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const raw = entry.data;
        const crc = crc32(raw);
        const deflated = deflateRawSync(raw, { level: 9 });

        let method, payload;
        if (deflated.length < raw.length) {
            method = 8;
            payload = deflated;
        } else {
            method = 0;
            payload = raw;
        }

        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0);
        lfh.writeUInt16LE(20, 4);
        lfh.writeUInt16LE(0x0800, 6);
        lfh.writeUInt16LE(method, 8);
        lfh.writeUInt16LE(time, 10);
        lfh.writeUInt16LE(date, 12);
        lfh.writeUInt32LE(crc, 14);
        lfh.writeUInt32LE(payload.length, 18);
        lfh.writeUInt32LE(raw.length, 22);
        lfh.writeUInt16LE(nameBuf.length, 26);
        lfh.writeUInt16LE(0, 28);
        localParts.push(lfh, nameBuf, payload);

        const cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(0x02014b50, 0);
        cdh.writeUInt16LE(20, 4);
        cdh.writeUInt16LE(20, 6);
        cdh.writeUInt16LE(0x0800, 8);
        cdh.writeUInt16LE(method, 10);
        cdh.writeUInt16LE(time, 12);
        cdh.writeUInt16LE(date, 14);
        cdh.writeUInt32LE(crc, 16);
        cdh.writeUInt32LE(payload.length, 20);
        cdh.writeUInt32LE(raw.length, 24);
        cdh.writeUInt16LE(nameBuf.length, 28);
        cdh.writeUInt16LE(0, 30);
        cdh.writeUInt16LE(0, 32);
        cdh.writeUInt16LE(0, 34);
        cdh.writeUInt16LE(0, 36);
        cdh.writeUInt32LE(0, 38);
        cdh.writeUInt32LE(offset, 42);
        centralParts.push(cdh, nameBuf);

        offset += lfh.length + nameBuf.length + payload.length;
    }

    const central = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, central, eocd]);
}

function collectEntries() {
    const rootFiles = ['gameServerStatus.js', 'README.md', 'DOCS.md', 'SETUP.md', 'LICENSE.txt'];
    const utilsFiles = readdirSync(join(ROOT, 'utils'))
        .filter(f => f.endsWith('.js'))
        .map(f => `utils/${f}`);
    const langFiles = readdirSync(join(ROOT, 'lang'))
        .filter(f => f.endsWith('.yml'))
        .map(f => `lang/${f}`);

    const entries = [];
    for (const rel of [...rootFiles, ...utilsFiles, ...langFiles]) {
        entries.push({ name: `${TOP_LEVEL}/${rel}`, data: readBin(rel) });
    }

    const freshConfig = extractDefaultConfig();
    entries.push({
        name: `${TOP_LEVEL}/config.yml`,
        data: Buffer.from(freshConfig, 'utf8')
    });

    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
}

function main() {
    const version = extractVersion();
    console.log(`Building GameServerStatus v${version}…`);

    const entries = collectEntries();

    const jsToCheck = entries
        .filter(e => e.name.endsWith('.js'))
        .map(e => e.name.slice(TOP_LEVEL.length + 1));
    syntaxCheckJs(jsToCheck);
    console.log(`  ✓ syntax-checked ${jsToCheck.length} JS files`);

    if (existsSync(DIST)) {
        rmSync(DIST, { recursive: true, force: true });
    }
    mkdirSync(DIST, { recursive: true });

    const zip = buildZip(entries);
    const outName = `GameServerStatus-v${version}.zip`;
    const outPath = join(DIST, outName);
    writeFileSync(outPath, zip);

    const totalRaw = entries.reduce((acc, e) => acc + e.data.length, 0);
    console.log(`  ✓ packed ${entries.length} files (${(totalRaw / 1024).toFixed(1)} KB raw → ${(zip.length / 1024).toFixed(1)} KB zipped)`);
    console.log(`Done: dist/${outName}`);
}

try {
    main();
} catch (err) {
    console.error(`Build failed: ${err.message}`);
    process.exit(1);
}
