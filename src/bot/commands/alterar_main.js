import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { prisma } from '../../services/db.js';

export const data = new SlashCommandBuilder()
    .setName('alterar_main')
    .setDescription('Altere seu personagem principal selecionando um dos personagens vinculados à sua conta.');

export async function execute(interaction) {
    const discordId = interaction.user.id;
    const guildId = interaction.guildId;

    const dbUser = await prisma.user.findUnique({
        where: { discordId },
        include: { characters: true }
    });

    if (!dbUser || !dbUser.characters || dbUser.characters.length === 0) {
        return interaction.reply({
            content: '❌ Você ainda não possui personagens vinculados! Use o comando `/vincular` primeiro.',
            ephemeral: true
        });
    }

    // 1. Identifica o flavor configurado para o servidor
    let targetFlavor = 'forever';
    let flavorLabel = 'WoW Forever';

    if (guildId) {
        const guildConfig = await prisma.guildConfig.findUnique({
            where: { guildId }
        });
        if (guildConfig?.gameFlavor) {
            targetFlavor = guildConfig.gameFlavor;
        }
    }

    let filteredCharacters = [];
    if (targetFlavor === 'forever') {
        flavorLabel = 'WoW Forever';
        // No WoW Forever os personagens possuem obrigatoriamente Nome e Sobrenome
        filteredCharacters = dbUser.characters.filter(c =>
            c.surname && c.surname.trim() !== ''
        );
    } else if (targetFlavor === 'classic') {
        flavorLabel = 'WoW Classic';
        filteredCharacters = dbUser.characters.filter(c => !c.surname && c.gameFlavor === 'classic');
    } else if (targetFlavor === 'retail') {
        flavorLabel = 'WoW Retail';
        filteredCharacters = dbUser.characters.filter(c => !c.surname && c.gameFlavor === 'retail');
    } else {
        filteredCharacters = dbUser.characters;
    }

    if (filteredCharacters.length === 0) {
        return interaction.reply({
            content: `⚠️ Não foram encontrados personagens do **${flavorLabel}** na sua conta vinculada da Battle.net.\nVerifique se você possui personagens criados nesta versão do jogo.`,
            ephemeral: true
        });
    }

    const charsToShow = filteredCharacters.slice(0, 25);

    const select = new StringSelectMenuBuilder()
        .setCustomId('select_main_character')
        .setPlaceholder(`Escolha seu Main (${flavorLabel})`)
        .addOptions(
            charsToShow.map(char => {
                const fullName = char.surname ? `${char.name} ${char.surname}` : char.name;
                const isCurrentMain = char.name.toLowerCase() === dbUser.mainCharName?.toLowerCase() &&
                    char.surname?.toLowerCase() === dbUser.mainCharSurname?.toLowerCase();

                return new StringSelectMenuOptionBuilder()
                    .setLabel(`${fullName} (Lvl ${char.level || '?'})${isCurrentMain ? ' ★ [Atual]' : ''}`)
                    .setDescription(`${char.playableClass || 'Classe'} • Ruleset: ${char.realm}`)
                    .setValue(String(char.id));
            })
        );

    const row = new ActionRowBuilder().addComponents(select);

    await interaction.reply({
        content: `Exibindo apenas os personagens do **${flavorLabel}** (${filteredCharacters.length} encontrados).\nSelecione abaixo qual deles será o seu **Main Character**:`,
        components: [row],
        ephemeral: true
    });
}
