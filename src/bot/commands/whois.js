import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../../services/db.js';
import { fetchCharacterDetails, fetchCharacterProfessions } from '../../services/bnetService.js';

const CLASSIC_REALMS = [
    'nightslayer', 'living flame', 'thalnos', 'herod', 'incendius', 'warsong',
    'shadowmoon', 'gurubashi', 'arthas', 'whitemane', 'mankrik', 'grobbulus',
    'faerlina', 'benediction', 'pagle', 'atiesh', 'crusader strike', 'lone wolf',
    'wild growth', 'chaos bolt', 'lava lash'
];

function categorizeCharacter(char) {
    if (char.surname && char.surname.trim() !== '') return 'forever';
    const realm = (char.realm || '').toLowerCase();
    if (CLASSIC_REALMS.includes(realm) || char.gameFlavor === 'classic') return 'classic';
    return 'retail';
}

export const data = new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Exibe a telemetria e os personagens de um membro verificado (Oficiais/Admins).')
    .addUserOption(option =>
        option
            .setName('membro')
            .setDescription('O usuário a ser consultado')
            .setRequired(true)
    )
    .addStringOption(option =>
        option
            .setName('escopo')
            .setDescription('Filtrar personagens por expansão/versão do jogo')
            .setRequired(false)
            .addChoices(
                { name: 'Apenas a versão deste servidor (Padrão)', value: 'servidor' },
                { name: 'Todas as expansões (Forever + Classic/MoP + Retail)', value: 'todas' }
            )
    );

export async function execute(interaction) {
    const targetUser = interaction.options.getUser('membro');
    const escopo = interaction.options.getString('escopo') || 'servidor';
    const guildMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    // Verificação de permissões: Administrador ou cargo de oficial configurado
    const guildConfig = await prisma.guildConfig.findUnique({
        where: { guildId: interaction.guildId }
    });

    const isAdmin = guildMember?.permissions.has(PermissionFlagsBits.Administrator);
    const isOfficer = guildConfig?.officerRoleId && guildMember?.roles.cache.has(guildConfig.officerRoleId);

    if (!isAdmin && !isOfficer) {
        return interaction.reply({
            content: '🚫 Você não possui permissão para utilizar o comando `/whois`. Apenas Oficiais e Administradores podem consultar a telemetria social.',
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    const dbUser = await prisma.user.findUnique({
        where: { discordId: targetUser.id },
        include: {
            characters: {
                include: { professions: true }
            }
        }
    });

    if (!dbUser || !dbUser.battleTag) {
        return interaction.editReply({
            content: `ℹ️ O membro **${targetUser.tag}** (${targetUser.id}) ainda não vinculou nenhuma conta Battle.net.`
        });
    }

    // 1. Identifica o Main Character
    let mainChar = dbUser.characters.find(c =>
        c.name.toLowerCase() === dbUser.mainCharName?.toLowerCase() &&
        (!dbUser.mainCharSurname || c.surname?.toLowerCase() === dbUser.mainCharSurname?.toLowerCase())
    ) || dbUser.characters[0];

    let avatarUrl = null;

    // 2. Se a guilda ou profissões do Main ainda não foram gravadas, consulta e atualiza
    if (mainChar) {
        if (!mainChar.guildName) {
            const details = await fetchCharacterDetails(mainChar.name, mainChar.surname, mainChar.realm, 'forever');
            if (details) {
                if (details.guildName) {
                    mainChar.guildName = details.guildName;
                    await prisma.character.update({
                        where: { id: mainChar.id },
                        data: { guildName: details.guildName }
                    }).catch(() => { });
                }
                if (details.avatarUrl) {
                    avatarUrl = details.avatarUrl;
                }
            }
        }

        if (!mainChar.professions || mainChar.professions.length === 0) {
            const pList = await fetchCharacterProfessions(mainChar.name, mainChar.surname, mainChar.realm, 'forever');
            if (pList && pList.length > 0) {
                mainChar.professions = [];
                for (const p of pList) {
                    const savedP = await prisma.profession.upsert({
                        where: { characterId_name: { characterId: mainChar.id, name: p.name } },
                        update: { skillPoints: p.skillPoints, maxSkill: p.maxSkill, isPrimary: p.isPrimary },
                        create: { characterId: mainChar.id, name: p.name, skillPoints: p.skillPoints, maxSkill: p.maxSkill, isPrimary: p.isPrimary }
                    }).catch(() => null);
                    if (savedP) mainChar.professions.push(savedP);
                }
            }
        }
    }

    const mainFullName = mainChar ? (mainChar.surname ? `${mainChar.name} ${mainChar.surname}` : mainChar.name) : (dbUser.mainCharName || 'Não Definido');

    // Formata profissões do Main
    let profsStr = 'Nenhuma registrada';
    if (mainChar?.professions && mainChar.professions.length > 0) {
        profsStr = mainChar.professions
            .map(p => `\`${p.name} (${p.skillPoints || 0}/${p.maxSkill || '?'})\``)
            .join(', ');
    }

    // 3. Agrupamento por Flavors e Ordenação por Level Decrescente
    const groups = {
        forever: [],
        classic: [],
        retail: []
    };

    for (const char of dbUser.characters) {
        // Ignora o próprio main para não duplicar na lista de alts
        if (mainChar && char.id === mainChar.id) continue;
        const cat = categorizeCharacter(char);
        groups[cat].push(char);
    }

    // Ordena cada grupo por nível decrescente
    groups.forever.sort((a, b) => (b.level || 0) - (a.level || 0));
    groups.classic.sort((a, b) => (b.level || 0) - (a.level || 0));
    groups.retail.sort((a, b) => (b.level || 0) - (a.level || 0));

    // Hidrata guildas de Forever alts se estiverem nulas
    for (const alt of groups.forever) {
        if (!alt.guildName) {
            const d = await fetchCharacterDetails(alt.name, alt.surname, alt.realm, 'forever');
            if (d?.guildName) {
                alt.guildName = d.guildName;
                await prisma.character.update({
                    where: { id: alt.id },
                    data: { guildName: d.guildName }
                }).catch(() => { });
            }
        }
    }

    const embed = new EmbedBuilder()
        .setColor(0x0070DE)
        .setTitle(`🛡️ Telemetria Social: ${targetUser.username}`)
        .setThumbnail(avatarUrl || targetUser.displayAvatarURL())
        .addFields(
            { name: '👤 BattleTag', value: `\`${dbUser.battleTag}\``, inline: true },
            { name: '🆔 Battle.net ID', value: `\`${dbUser.bnetId || 'N/A'}\``, inline: true },
            {
                name: '⭐ Main Character',
                value: `**${mainFullName}** (Lvl ${mainChar?.level || '?'})\n**Classe:** ${mainChar?.playableClass || 'Classe N/A'} • 🏰 **Guilda:** <${mainChar?.guildName || 'Sem Guilda'}>\n🗺️ **Ruleset / Reino:** ${mainChar?.realm || 'PvP'}\n⛏️ **Profissões:** ${profsStr}`,
                inline: false
            }
        );

    function formatCharList(list, isForever = false) {
        const topChars = list.slice(0, 10);
        const lines = topChars.map(c => {
            const nameStr = isForever ? `${c.name} ${c.surname}` : `${c.name} [${c.realm}]`;
            const gStr = c.guildName ? `<${c.guildName}>` : '<Sem Guilda>';
            return `• **${nameStr}** (Lvl ${c.level || '?'}) - ${gStr} - ${c.playableClass || 'Classe'}`;
        });
        if (list.length > 10) {
            lines.push(`*...e mais ${list.length - 10} alts de nível menor.*`);
        }
        return lines.join('\n');
    }

    if (escopo === 'servidor') {
        // Exibe apenas os personagens do flavor deste servidor (WoW Forever)
        if (groups.forever.length > 0) {
            embed.addFields({
                name: `👥 Alts no WoW Forever (${groups.forever.length})`,
                value: formatCharList(groups.forever, true)
            });
        } else {
            embed.addFields({
                name: '👥 Alts no WoW Forever',
                value: 'Nenhum outro personagem no WoW Forever registrado.'
            });
        }

        const otherCount = groups.classic.length + groups.retail.length;
        if (otherCount > 0) {
            embed.addFields({
                name: '🌐 Outras Versões (Classic / Retail)',
                value: `Este jogador possui **${otherCount}** alts em outras versões do WoW.\n*💡 Dica: Use \`/whois membro:@${targetUser.username} escopo:Todas\` para ver a ficha completa de todas as expansões.*`
            });
        }
    } else {
        // Escopo "Todas": agrupa por flavor, trazendo o do servidor primeiro
        if (groups.forever.length > 0) {
            embed.addFields({
                name: `⚔️ WoW Forever (${groups.forever.length} alts)`,
                value: formatCharList(groups.forever, true)
            });
        }

        if (groups.classic.length > 0) {
            embed.addFields({
                name: `🛡️ WoW Classic / MoP (${groups.classic.length} alts)`,
                value: formatCharList(groups.classic, false)
            });
        }

        if (groups.retail.length > 0) {
            embed.addFields({
                name: `🐉 WoW Retail (${groups.retail.length} alts)`,
                value: formatCharList(groups.retail, false)
            });
        }
    }

    embed.setFooter({ text: `Consultado por ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}
