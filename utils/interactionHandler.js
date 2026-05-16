const { MessageFlags } = require('discord.js');
const log = require('./logger');
const { t } = require('./i18n');

function formatPlayersResponse(state) {
    const { data, serverConfig } = state;
    const players = data.players.list || [];
    const bots = data.players.bots || [];
    const max = data.players.max || 0;
    const humanCount = players.length;
    const botCount = bots.length;

    if (humanCount === 0 && botCount === 0) {
        return t('interactions.noPlayersOnline');
    }

    const formatList = (label, items) => {
        if (!items.length) return '';
        return `**${label}**\n${items.map(p => `• ${p}`).join('\n')}\n`;
    };

    let response = t('interactions.playersHeader', {
        name: serverConfig.ServerName,
        online: humanCount,
        max
    }) + '\n\n';
    response += formatList(t('interactions.playersListLabel'), players);
    response += formatList(t('interactions.botsListLabel'), bots);

    if (response.length > 1900) {
        response = response.substring(0, 1897) + '...';
    }
    return response.trim();
}

function formatConnectResponse(state) {
    const { data, gameType, serverAddress } = state;
    const target = data.connect || serverAddress;

    if (!data.online) {
        return t('interactions.serverOffline');
    }

    let hint = '';
    if (gameType === 'garrysmod') {
        hint = t('interactions.garrysmodHint', { address: serverAddress });
    } else if (gameType === 'minecraft') {
        hint = t('interactions.minecraftHint');
    }
    return t('interactions.serverOnline', { address: target, hint });
}

function formatCopyIpResponse(state) {
    const { data, serverAddress } = state;
    const ip = data.connect || serverAddress;
    return t('interactions.copyIpResponse', { ip });
}

async function handleButton(interaction, controller) {
    if (!controller) return;
    if (interaction.replied || interaction.deferred) return;

    const parts = interaction.customId.split('_');
    if (parts.length < 3) return;
    const [, type, ...idParts] = parts;
    const serverKey = idParts.join('_');

    const state = controller.getCachedState(serverKey);
    if (!state) {
        await interaction.reply({
            content: t('interactions.noFreshData'),
            flags: MessageFlags.Ephemeral
        }).catch(err => log.warn(t('interactions.replyFailed', { error: err.message })));
        return;
    }

    try {
        if (type === 'connect') {
            await interaction.reply({ content: formatConnectResponse(state), flags: MessageFlags.Ephemeral });
            return;
        }
        if (type === 'players') {
            await interaction.reply({ content: formatPlayersResponse(state), flags: MessageFlags.Ephemeral });
            return;
        }
        if (type === 'copyip') {
            await interaction.reply({ content: formatCopyIpResponse(state), flags: MessageFlags.Ephemeral });
            return;
        }
    } catch (err) {
        log.warn(t('interactions.buttonError', { type, error: err.message }));
    }
}

module.exports = { handleButton };
