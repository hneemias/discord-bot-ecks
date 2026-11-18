import { Router } from 'express';
import { ChannelType } from 'discord.js';
import { client } from '../bot/client.js';
import { prisma } from '../services/db.js';
import { fetchGuildInfo } from '../services/bnetService.js';
import { scanGuildNews } from '../services/guildNewsService.js';
import { hydrateGuildRoster } from '../services/guildRosterService.js';

const router = Router();

// Lista todas as classes padrão do WoW
export const WOW_CLASSES = [
    { key: 'Warrior', name: 'Warrior / Guerreiro', color: '#C69B6D' },
    { key: 'Paladin', name: 'Paladin / Paladino', color: '#F48CBA' },
    { key: 'Hunter', name: 'Hunter / Caçador', color: '#A9D271' },
    { key: 'Rogue', name: 'Rogue / Ladino', color: '#FFF468' },
    { key: 'Priest', name: 'Priest / Sacerdote', color: '#FFFFFF' },
    { key: 'Shaman', name: 'Shaman / Xamã', color: '#0070DE' },
    { key: 'Mage', name: 'Mage / Mago', color: '#3FC7EB' },
    { key: 'Warlock', name: 'Warlock / Bruxo', color: '#8788EE' },
    { key: 'Druid', name: 'Druid / Druida', color: '#FF7D0A' },
    { key: 'Death Knight', name: 'Death Knight / Cavaleiro da Morte', color: '#C41E3A' },
    { key: 'Monk', name: 'Monk / Monge', color: '#00FF98' },
    { key: 'Demon Hunter', name: 'Demon Hunter / Caçador de Demônios', color: '#A330C9' },
    { key: 'Evoker', name: 'Evoker / Conjurador', color: '#33937F' }
];

// Lista de profissões suportadas no WoW
export const WOW_PROFESSIONS = [
    { key: 'Alchemy', name: 'Alchemy / Alquimia', icon: '🧪' },
    { key: 'Blacksmithing', name: 'Blacksmithing / Ferraria', icon: '🔨' },
    { key: 'Enchanting', name: 'Enchanting / Encantamento', icon: '✨' },
    { key: 'Engineering', name: 'Engineering / Engenharia', icon: '⚙️' },
    { key: 'Herbalism', name: 'Herbalism / Herborismo', icon: '🌿' },
    { key: 'Inscription', name: 'Inscription / Escrivania', icon: '📜' },
    { key: 'Jewelcrafting', name: 'Jewelcrafting / Joalheria', icon: '💎' },
    { key: 'Leatherworking', name: 'Leatherworking / Couraria', icon: '🥋' },
    { key: 'Mining', name: 'Mining / Mineração', icon: '⛏️' },
    { key: 'Skinning', name: 'Skinning / Esfolamento', icon: '🔪' },
    { key: 'Tailoring', name: 'Tailoring / Alfaiataria', icon: '🧵' },
    { key: 'Cooking', name: 'Cooking / Culinária', icon: '🍳' },
    { key: 'First Aid', name: 'First Aid / Primeiros Socorros', icon: '🩹' },
    { key: 'Fishing', name: 'Fishing / Pesca', icon: '🎣' }
];

// 1. Lista servidores em que o bot está presente
router.get('/guilds', async (req, res) => {
    try {
        const guilds = client.guilds.cache.map(g => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL() || null,
            memberCount: g.memberCount
        }));
        res.json(guilds);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Busca e valida guilda oficial na Blizzard API
router.get('/guild-search', async (req, res) => {
    const { name, realm, flavor } = req.query;
    if (!name) {
        return res.status(400).json({ error: 'Nome da guilda é obrigatório.' });
    }

    try {
        const guildData = await fetchGuildInfo(name, realm || null, flavor || 'forever');
        if (!guildData) {
            return res.status(404).json({ error: 'Guilda não encontrada na Blizzard para esta versão.' });
        }
        res.json({ success: true, guild: guildData });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Retorna configurações, cargos do Discord e guildas detectadas de um servidor específico
router.get('/guilds/:guildId/config', async (req, res) => {
    const { guildId } = req.params;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return res.status(404).json({ error: 'Servidor não encontrado no cache do Bot.' });
    }

    try {
        // Carrega ou inicializa a configuração da guilda com classes e profissões
        let config = await prisma.guildConfig.findUnique({
            where: { guildId },
            include: {
                classRoleMappings: true,
                professionRoleMappings: true
            }
        });

        if (!config) {
            config = await prisma.guildConfig.create({
                data: { guildId },
                include: {
                    classRoleMappings: true,
                    professionRoleMappings: true
                }
            });
        }

        // Guildas detectadas nas contas dos membros deste bot
        const detectedGuilds = await prisma.character.findMany({
            where: { guildName: { not: null } },
            select: {
                guildId: true,
                guildName: true,
                realm: true,
                gameFlavor: true,
                surname: true
            },
            distinct: ['guildName']
        });

        // Filtra cargos gerenciáveis (exclui @everyone)
        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.hexColor,
                position: r.position
            }))
            .sort((a, b) => b.position - a.position);

        // Categorias e Canais de Voz para Panelinhas (Salas Dinâmicas)
        const categories = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildCategory)
            .map(c => ({
                id: c.id,
                name: c.name,
                position: c.position
            }))
            .sort((a, b) => a.position - b.position);

        const voiceChannels = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildVoice)
            .map(c => ({
                id: c.id,
                name: c.name,
                parentId: c.parentId || null,
                position: c.position
            }))
            .sort((a, b) => a.position - b.position);

        // Canais de Texto para Guild News
        const textChannels = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
            .map(c => ({
                id: c.id,
                name: c.name,
                position: c.position
            }))
            .sort((a, b) => a.position - b.position);

        res.json({
            config,
            roles,
            categories,
            voiceChannels,
            textChannels,
            detectedGuilds,
            availableClasses: WOW_CLASSES,
            availableProfessions: WOW_PROFESSIONS
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Salva as configurações gerais, guilda oficial, classes e profissões do servidor
router.post('/guilds/:guildId/config', async (req, res) => {
    const { guildId } = req.params;
    const {
        gameFlavor,
        targetGuildId,
        targetGuildName,
        targetGuildFaction,
        targetGuildRoleId,
        guildLeaderRoleId,
        guildOfficerRoleId,
        unverifiedRoleId,
        verifiedRoleId,
        officerRoleId,
        panelinhaCategoryId,
        panelinhaGeneratorChannelId,
        newsChannelId,
        newsIntervalMinutes,
        levelCap,
        classRoleMappings,
        professionRoleMappings
    } = req.body;

    try {
        const operations = [];

        // 1. Atualiza a GuildConfig principal
        operations.push(prisma.guildConfig.upsert({
            where: { guildId },
            update: {
                gameFlavor: gameFlavor || 'forever',
                targetGuildId: targetGuildId ? parseInt(targetGuildId, 10) : null,
                targetGuildName: targetGuildName || null,
                targetGuildFaction: targetGuildFaction || null,
                targetGuildRoleId: targetGuildRoleId || null,
                guildLeaderRoleId: guildLeaderRoleId || null,
                guildOfficerRoleId: guildOfficerRoleId || null,
                unverifiedRoleId: unverifiedRoleId || null,
                verifiedRoleId: verifiedRoleId || null,
                officerRoleId: officerRoleId || null,
                panelinhaCategoryId: panelinhaCategoryId || null,
                panelinhaGeneratorChannelId: panelinhaGeneratorChannelId || null,
                newsChannelId: newsChannelId || null,
                newsIntervalMinutes: newsIntervalMinutes ? parseInt(newsIntervalMinutes, 10) : 15,
                levelCap: levelCap ? parseInt(levelCap, 10) : null
            },
            create: {
                guildId,
                gameFlavor: gameFlavor || 'forever',
                targetGuildId: targetGuildId ? parseInt(targetGuildId, 10) : null,
                targetGuildName: targetGuildName || null,
                targetGuildFaction: targetGuildFaction || null,
                targetGuildRoleId: targetGuildRoleId || null,
                guildLeaderRoleId: guildLeaderRoleId || null,
                guildOfficerRoleId: guildOfficerRoleId || null,
                unverifiedRoleId: unverifiedRoleId || null,
                verifiedRoleId: verifiedRoleId || null,
                officerRoleId: officerRoleId || null,
                panelinhaCategoryId: panelinhaCategoryId || null,
                panelinhaGeneratorChannelId: panelinhaGeneratorChannelId || null,
                newsChannelId: newsChannelId || null,
                newsIntervalMinutes: newsIntervalMinutes ? parseInt(newsIntervalMinutes, 10) : 15,
                levelCap: levelCap ? parseInt(levelCap, 10) : null
            }
        }));

        // 2. Atualiza os mapeamentos de classe em lote
        if (Array.isArray(classRoleMappings)) {
            for (const map of classRoleMappings) {
                if (!map.className) continue;
                operations.push(prisma.classRoleMapping.upsert({
                    where: {
                        guildId_className: {
                            guildId,
                            className: map.className
                        }
                    },
                    update: {
                        mainRoleId: map.mainRoleId || null,
                        altRoleId: map.altRoleId || null
                    },
                    create: {
                        guildId,
                        className: map.className,
                        mainRoleId: map.mainRoleId || null,
                        altRoleId: map.altRoleId || null
                    }
                }));
            }
        }

        // 3. Atualiza os mapeamentos de profissões em lote
        if (Array.isArray(professionRoleMappings)) {
            for (const pMap of professionRoleMappings) {
                if (!pMap.professionName) continue;
                operations.push(prisma.professionRoleMapping.upsert({
                    where: {
                        guildId_professionName: {
                            guildId,
                            professionName: pMap.professionName
                        }
                    },
                    update: {
                        roleId: pMap.roleId || null
                    },
                    create: {
                        guildId,
                        professionName: pMap.professionName,
                        roleId: pMap.roleId || null
                    }
                }));
            }
        }

        // Executa todas as atualizações em uma única transação SQLite atômica e ultrarrápida
        const results = await prisma.$transaction(operations);

        res.json({ success: true, config: results[0] });
    } catch (err) {
        console.error('[API Config] Erro ao salvar:', err);
        res.status(500).json({ error: err.message });
    }
});

// 5. Executa uma varredura manual de Guild News sob demanda
router.post('/guilds/:guildId/scan-news', async (req, res) => {
    const { guildId } = req.params;
    try {
        const result = await scanGuildNews(guildId);
        res.json(result);
    } catch (err) {
        console.error('[API Scan News] Erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 6. Pré-hidrata o elenco (roster) completo da guilda sob demanda
router.post('/guilds/:guildId/hydrate-roster', async (req, res) => {
    const { guildId } = req.params;
    try {
        const config = await prisma.guildConfig.findUnique({ where: { guildId } });
        if (!config?.targetGuildName) {
            return res.status(400).json({ error: 'Nenhuma guilda oficial configurada neste servidor.' });
        }
        const sampleChar = await prisma.character.findFirst({
            where: { guildName: config.targetGuildName }
        });
        const realm = sampleChar?.realm || (config.gameFlavor === 'forever' ? 'PvP' : 'Nazgrim');
        const result = await hydrateGuildRoster(
            guildId,
            config.targetGuildName,
            realm,
            config.gameFlavor || 'forever',
            config.targetGuildId
        );
        res.json(result);
    } catch (err) {
        console.error('[API Hydrate Roster] Erro:', err);
        res.status(500).json({ error: err.message });
    }
});

// 7. Retorna o elenco (roster) completo da guilda para visualização no dashboard
router.get('/guilds/:guildId/roster', async (req, res) => {
    const { guildId } = req.params;
    try {
        const config = await prisma.guildConfig.findUnique({ where: { guildId } });
        if (!config || !config.targetGuildName) {
            return res.json({
                guildName: null,
                gameFlavor: config?.gameFlavor || 'forever',
                stats: { total: 0, linked: 0, unlinked: 0 },
                characters: []
            });
        }

        const characters = await prisma.character.findMany({
            where: {
                OR: [
                    { guildName: config.targetGuildName },
                    ...(config.targetGuildId ? [{ guildId: config.targetGuildId }] : [])
                ]
            },
            include: {
                user: {
                    select: {
                        discordId: true,
                        battleTag: true,
                        mainCharName: true
                    }
                },
                professions: true
            },
            orderBy: [
                { level: 'desc' },
                { name: 'asc' }
            ]
        });

        // Hidrata detalhes visuais do membro no Discord (avatar, username, displayName)
        const discordGuild = client.guilds.cache.get(guildId);
        const enriched = await Promise.all(characters.map(async (char) => {
            let discordMember = null;
            if (char.discordId && discordGuild) {
                try {
                    const m = await discordGuild.members.fetch(char.discordId).catch(() => null);
                    if (m) {
                        discordMember = {
                            id: m.id,
                            displayName: m.displayName,
                            username: m.user.username,
                            avatarUrl: m.user.displayAvatarURL({ size: 64 })
                        };
                    }
                } catch { }
            }

            return {
                id: char.id,
                blizzardCharId: char.blizzardCharId,
                name: char.name,
                surname: char.surname,
                level: char.level,
                realm: char.realm,
                gameFlavor: char.gameFlavor,
                playableClass: char.playableClass,
                playableRace: char.playableRace,
                guildRank: char.guildRank,
                isMain: char.isMain,
                discordId: char.discordId,
                battleTag: char.user?.battleTag || null,
                discordMember,
                professions: char.professions
            };
        }));

        const total = enriched.length;
        const linked = enriched.filter(c => c.discordId).length;
        const unlinked = total - linked;

        res.json({
            guildName: config.targetGuildName,
            gameFlavor: config.gameFlavor,
            stats: { total, linked, unlinked },
            characters: enriched
        });
    } catch (err) {
        console.error('[API Roster] Erro ao buscar roster:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
