const fs = require('fs');
const yaml = require('js-yaml');
const log = require('./logger');
const { t } = require('./i18n');

// Pre-release: addon is iterating on 1.0.0 with no published versions yet, so
// the migration chain is empty. Once we ship the first stable version and the
// schema starts evolving, bump LATEST_VERSION and append migration steps here.
const LATEST_VERSION = '1.0.0';

const MIGRATIONS = [];

function parseVersion(v) {
    if (typeof v !== 'string') return [0, 0, 0];
    return v.split('.').map(n => Number.parseInt(n, 10) || 0);
}

function compareVersion(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) < (pb[i] || 0)) return -1;
        if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    }
    return 0;
}

function migrate(config) {
    const currentVersion = (typeof config.Version === 'string' && config.Version.trim()) || '1.0.0';

    if (compareVersion(currentVersion, LATEST_VERSION) > 0) {
        log.warn(t('migration.aheadOfCode', { config: currentVersion, code: LATEST_VERSION }));
        return { migrated: config, changed: false, fromVersion: currentVersion, toVersion: currentVersion };
    }

    if (currentVersion === LATEST_VERSION) {
        return { migrated: config, changed: false, fromVersion: currentVersion, toVersion: currentVersion };
    }

    let working = currentVersion;
    for (const step of MIGRATIONS) {
        if (compareVersion(working, step.from) === 0) {
            step.apply(config);
            working = step.to;
            log.info(t('migration.applied', { from: step.from, to: step.to }));
        }
    }

    config.Version = working;
    return {
        migrated: config,
        changed: working !== currentVersion,
        fromVersion: currentVersion,
        toVersion: working
    };
}

function backupAndPersist(configPath, configObject, fromVersion) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.bak.v${fromVersion}.${timestamp}`;

    fs.copyFileSync(configPath, backupPath);

    const dumped = yaml.dump(configObject, { lineWidth: 200, noRefs: true });
    const tmpPath = `${configPath}.tmp`;
    fs.writeFileSync(tmpPath, dumped, 'utf8');
    fs.renameSync(tmpPath, configPath);

    log.info(t('migration.backupSaved', { backup: backupPath }));
}

module.exports = { migrate, backupAndPersist, LATEST_VERSION };
