import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { client } from './client.js';
import { prisma } from '../services/db.js';

/**
 * Envia notificação por DM ao usuário após autenticação bem-sucedida com a Battle.net.
 * Filtra os personagens para exibir somente os correspondentes ao flavor do servidor de origem (ex: WoW Forever).
 */
export async function sendAuthComplete(discordId, guildId = null) {
    try {
        const user = await client.users.fetch(discordId).catch(() => null);
        if (!user) {
            console.warn(`[Notify] Usuário ${discordId} não pôde ser encontrado pelo Discord Client.`);
            return;
        }

        // 1. Identifica a configuração do servidor de onde partiu o /vincular
        let targetFlavor = 'forever';
        let serverName = 'nosso servidor';

        if (guildId) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) serverName = guild.name;

            const guildConfig = await prisma.guildConfig.findUnique({
                where: { guildId }
            });
            if (guildConfig?.gameFlavor) {
                targetFlavor = guildConfig.gameFlavor;
            }
        }

        // 2. Busca todos os personagens do usuário
        const allCharacters = await prisma.character.findMany({
            where: { discordId }
        });

        if (allCharacters.length === 0) {
            await user.send('✅ Você autenticou com a Battle.net com sucesso! Porém, não foram encontrados personagens associados a esta conta no momento. Se você tiver personagens no WoW Forever ou Classic, verifique a região e tente novamente.').catch(() => { });
            return;
        }

        // 3. Aplica o filtro específico do flavor do servidor (WoW Forever)
        let filteredCharacters = [];
        let flavorLabel = 'WoW Forever';

        if (targetFlavor === 'forever') {
            flavorLabel = 'WoW Forever';
            // No WoW Forever, apenas personagens com Sobrenome (Surname) são aceitos
            filteredCharacters = allCharacters.filter(c => c.surname && c.surname.trim() !== '');
        } else if (targetFlavor === 'classic') {
            flavorLabel = 'WoW Classic';
            filteredCharacters = allCharacters.filter(c => !c.surname && c.gameFlavor === 'classic');
        } else if (targetFlavor === 'retail') {
            flavorLabel = 'WoW Retail';
            filteredCharacters = allCharacters.filter(c => !c.surname && c.gameFlavor === 'retail');
        } else {
            filteredCharacters = allCharacters;
        }

        if (filteredCharacters.length === 0) {
            await user.send(`🎉 **Autenticação com a Battle.net concluída!**\nPorém, não encontramos nenhum personagem do **${flavorLabel}** (que requerem Nome e Sobrenome) na sua conta.\nSe você joga no WoW Forever, crie seu personagem no jogo e use o comando \`/alterar_main\` no servidor.`);
            return;
        }

        const charsToShow = filteredCharacters.slice(0, 25);

        const select = new StringSelectMenuBuilder()
            .setCustomId('select_main_character')
            .setPlaceholder(`Escolha seu Main (${flavorLabel})`)
            .addOptions(
                charsToShow.map(char => {
                    const fullName = char.surname ? `${char.name} ${char.surname}` : char.name;
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`${fullName} (Lvl ${char.level || '?'})`)
                        .setDescription(`${char.playableClass || 'Classe'} • Ruleset: ${char.realm}`)
                        .setValue(String(char.id));
                })
            );

        const row = new ActionRowBuilder().addComponents(select);

        await user.send({
            content: `🎉 **Autenticação concluída com sucesso!**\nExibindo apenas os personagens do **${flavorLabel}** para o servidor **${serverName}**.\n\nEncontramos **${filteredCharacters.length}** personagem(ns). Selecione abaixo qual deles é o seu **Main Character** para receber seus cargos e ter o apelido configurado:`,
            components: [row]
        });

    } catch (error) {
        console.error(`[Notify] Falha ao enviar DM de seleção de Main para ${discordId}:`, error.message);
    }
}
