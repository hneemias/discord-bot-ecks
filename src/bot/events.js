import { Events } from 'discord.js';
import { client } from './client.js';
import { prisma } from '../services/db.js';
import { syncMemberRolesAndNick, handleMemberJoin } from './roleManager.js';
import { handleVoiceStateUpdate } from './voiceManager.js';

import * as vincularCommand from './commands/vincular.js';
import * as alterarMainCommand from './commands/alterar_main.js';
import * as whoisCommand from './commands/whois.js';

// Registrar comandos na coleção
client.commands.set(vincularCommand.data.name, vincularCommand);
client.commands.set(alterarMainCommand.data.name, alterarMainCommand);
client.commands.set(whoisCommand.data.name, whoisCommand);

// Evento: Novo membro entra no servidor (Quarentena ou Auto-Restore)
client.on(Events.GuildMemberAdd, async member => {
    try {
        await handleMemberJoin(member);
    } catch (err) {
        console.error(`[Events] Erro no GuildMemberAdd para ${member.id}:`, err);
    }
});

// Evento: Atualização de Estado de Voz (Panelinhas / Salas Dinâmicas)
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
        await handleVoiceStateUpdate(oldState, newState);
    } catch (err) {
        console.error(`[Events] Erro no VoiceStateUpdate:`, err);
    }
});

// Evento: Interações (Slash Commands e Menus)
client.on(Events.InteractionCreate, async interaction => {
    // 1. Processamento de Slash Commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`[Events] Erro ao executar /${interaction.commandName}:`, error);
            const errorMsg = { content: '❌ Ocorreu um erro ao processar este comando.', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMsg).catch(() => { });
            } else {
                await interaction.reply(errorMsg).catch(() => { });
            }
        }
        return;
    }

    // 2. Processamento do Dropdown de Escolha do Main Character
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_main_character') {
        await interaction.deferUpdate();

        const charId = parseInt(interaction.values[0], 10);
        const selectedChar = await prisma.character.findUnique({
            where: { id: charId }
        });

        if (!selectedChar) {
            return interaction.followUp({
                content: '❌ Personagem não encontrado no banco de dados.',
                ephemeral: true
            });
        }

        // Atualiza a flag isMain em todos os personagens do usuário
        await prisma.character.updateMany({
            where: { discordId: interaction.user.id },
            data: { isMain: false }
        });

        await prisma.character.update({
            where: { id: charId },
            data: { isMain: true }
        });

        // Atualiza o registro do User
        const updatedUser = await prisma.user.update({
            where: { discordId: interaction.user.id },
            data: {
                mainCharName: selectedChar.name,
                mainCharSurname: selectedChar.surname,
                mainCharRealm: selectedChar.realm
            }
        });

        const fullName = selectedChar.surname ? `${selectedChar.name} ${selectedChar.surname}` : selectedChar.name;
        const reports = [];

        // Sincroniza apelido e cargos em cada servidor que o bot e o usuário compartilham
        for (const [guildId, guild] of client.guilds.cache) {
            try {
                const member = await guild.members.fetch(interaction.user.id).catch(() => null);
                if (!member) continue;

                const guildConfig = await prisma.guildConfig.findUnique({
                    where: { guildId: guild.id }
                });

                const syncReport = await syncMemberRolesAndNick(member, updatedUser, guildConfig);
                if (syncReport && syncReport.length > 0) {
                    reports.push(`**[${guild.name}]**\n` + syncReport.map(r => `• ${r}`).join('\n'));
                }
            } catch (err) {
                console.error(`[Events] Erro ao sincronizar cargos no servidor ${guild.name}:`, err.message);
            }
        }

        const reportSummary = reports.length > 0 ? `\n\n${reports.join('\n\n')}` : '';

        await interaction.editReply({
            content: `✅ Seu **Main Character** foi definido como **${fullName}** (${selectedChar.playableClass} - Lvl ${selectedChar.level || '?'})!${reportSummary}`,
            components: []
        });
    }
});
