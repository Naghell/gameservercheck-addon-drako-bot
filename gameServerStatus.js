const { loadConfig } = require('./utils/configLoader');
const { StatusController } = require('./utils/messageManager');
const { handleButton } = require('./utils/interactionHandler');
const log = require('./utils/logger');
const { t } = require('./utils/i18n');

let controller = null;
let boundClient = null;
let interactionListener = null;

function verifyGamedig() {
    try {
        require.resolve('gamedig');
        return true;
    } catch {
        log.error(t('lifecycle.gamedigMissing'));
        return false;
    }
}

async function dispatchButton(interaction) {
    if (!interaction.isButton?.()) return;
    if (!interaction.customId?.startsWith('gss_')) return;
    if (interaction.replied || interaction.deferred) return;
    await handleButton(interaction, controller);
}

module.exports = {
    name: 'GameServerStatus',
    version: '1.0.0',
    get description() {
        return t('addon.description');
    },
    author: 'Naghell & contributors',

    run: async (client, _eventManager) => {
        if (!verifyGamedig()) return;

        const config = loadConfig();
        log.setDebug(config.Debug);

        if (!config.Enabled) {
            log.info(t('lifecycle.disabled'));
            return;
        }

        controller = new StatusController(client, config);
        await controller.start();

        if (!client.__gssInteractionBound) {
            interactionListener = (interaction) => {
                dispatchButton(interaction).catch(err => log.warn('dispatchButton error:', err.message));
            };
            client.on('interactionCreate', interactionListener);
            client.__gssInteractionBound = true;
            boundClient = client;
        }
    },

    unload: async () => {
        try {
            if (controller) {
                await controller.stop();
            }
        } catch (err) {
            log.warn('controller.stop error:', err.message);
        } finally {
            controller = null;
            if (boundClient && interactionListener) {
                boundClient.off('interactionCreate', interactionListener);
                boundClient.__gssInteractionBound = false;
                boundClient = null;
                interactionListener = null;
            }
        }
    }
};
