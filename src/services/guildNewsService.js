import { EmbedBuilder } from 'discord.js';
import { client } from '../bot/client.js';
import { prisma } from './db.js';
import { fetchGuildRoster, fetchGuildAchievements } from './bnetService.js';
import { CLASS_MAP, RACE_MAP } from './guildRosterService.js';

export const DEFAULT_FLAVOR_CAPS = {
    forever: 60,
    classic: 90, // MoP Classic
    retail: 80   // The War Within
};

export function getGuildLevelCap(guildConfig) {
    if (guildConfig.levelCap && guildConfig.levelCap > 0) {
        return guildConfig.levelCap;
    }
    return DEFAULT_FLAVOR_CAPS[guildConfig.gameFlavor] || 60;
}

let schedulerInterval = null;

/**
 * Executa a varredura de novidades da guilda (Guild News) para um servidor específico.
 * Identifica Level-Ups de membros e Conquistas desbloqueadas pela guilda.
 */
export async function scanGuildNews(guildId) {
    try {
        const guildConfig = await prisma.guildConfig.findUnique({
            where: { guildId }
        });

        // Se o canal estiver desativado ou a guilda não estiver configurada, economiza requisições da Blizzard
        if (!guildConfig || !guildConfig.newsChannelId || !guildConfig.targetGuildName) {
            return { scanned: false, reason: 'Canal de news ou guilda não configurados.' };
        }

        const channel = await client.channels.fetch(guildConfig.newsChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            return { scanned: false, reason: 'Canal de texto do Discord não encontrado ou sem permissão.' };
        }

        // Descobre o reino da guilda com base nos personagens conhecidos ou padrão
        const sampleChar = await prisma.character.findFirst({
            where: { guildName: guildConfig.targetGuildName }
        });
        const realm = sampleChar?.realm || 'azralon';

        console.log(`[GuildNews] Iniciando varredura para ${guildConfig.targetGuildName} (${guildConfig.gameFlavor})...`);

        // 1. VARREDURA DE ROSTER (LEVEL-UPS)
        const members = await fetchGuildRoster(guildConfig.targetGuildName, realm, guildConfig.gameFlavor);
        const existingSnapshots = await prisma.guildMemberSnapshot.findMany({
            where: { guildId }
        });

        const snapshotMap = new Map();
        existingSnapshots.forEach(s => snapshotMap.set(s.charId, s));

        if (existingSnapshots.length === 0 && members.length > 0) {
            // Primeira execução: cria a baseline inicial para não disparar spam de notificações antigas
            console.log(`[GuildNews] Criando baseline inicial com ${members.length} membros.`);
            for (const m of members) {
                const c = m.character;
                if (!c || !c.id) continue;
                await prisma.guildMemberSnapshot.create({
                    data: {
                        guildId,
                        charId: c.id,
                        name: c.name,
                        surname: c.surname || null,
                        level: c.level || 1
                    }
                }).catch(() => { });
            }
        } else {
            for (const m of members) {
                const c = m.character;
                if (!c || !c.id) continue;

                const snap = snapshotMap.get(c.id);
                if (snap) {
                    if (c.level > snap.level) {
                        const charName = c.surname ? `${c.name} ${c.surname}` : c.name;
                        console.log(`[GuildNews] Level up detectado: ${charName} (${snap.level} -> ${c.level})`);

                        // Verifica se o personagem pertence a um membro registrado no bot
                        const registeredChar = await prisma.character.findFirst({
                            where: {
                                name: c.name,
                                ...(c.surname ? { surname: c.surname } : {})
                            }
                        });

                        // Valida se o usuário registrado realmente está presente NESTE servidor do Discord
                        let isMemberInCurrentServer = false;
                        if (registeredChar?.discordId) {
                            const memberInGuild = await channel.guild.members.fetch(registeredChar.discordId).catch(() => null);
                            isMemberInCurrentServer = Boolean(memberInGuild);
                        }

                        const congratulations = isMemberInCurrentServer ? ` Parabens <@${registeredChar.discordId}>!` : '';
                        const levelCap = getGuildLevelCap(guildConfig);
                        const isLevelCap = c.level >= levelCap && snap.level < levelCap;

                        let messageText = '';
                        if (isLevelCap) {
                            // Mensagem especial de Level Cap oficial in-game ("atingiu o nível máximo!")
                            messageText = `🏆 **NÍVEL MÁXIMO ALCANÇADO!**\n**${charName}** atingiu o nível máximo (**${c.level}**)!${congratulations} 👑⚔️`;
                        } else {
                            messageText = `🎉 **Level UP!**\n**${charName}** avançou do nível **${snap.level}** para o nível **${c.level}**!${congratulations} 🚀`;
                        }

                        await channel.send({ content: messageText }).catch(err => {
                            console.error('[GuildNews] Erro ao enviar mensagem no Discord:', err.message);
                        });

                        // Pequena pausa (500ms) entre mensagens para respeitar o rate-limit do Discord
                        await new Promise(res => setTimeout(res, 500));

                        // Atualiza o snapshot e a tabela de personagens para manter o banco sincronizado
                        await prisma.guildMemberSnapshot.update({
                            where: { id: snap.id },
                            data: { level: c.level, name: c.name, surname: c.surname || null }
                        });

                        if (registeredChar) {
                            await prisma.character.update({
                                where: { id: registeredChar.id },
                                data: { level: c.level }
                            }).catch(() => { });
                        }
                    } else if (c.level !== snap.level) {
                        await prisma.guildMemberSnapshot.update({
                            where: { id: snap.id },
                            data: { level: c.level }
                        });
                    }
                } else {
                    // Novo membro ingressou no roster
                    await prisma.guildMemberSnapshot.create({
                        data: {
                            guildId,
                            charId: c.id,
                            name: c.name,
                            surname: c.surname || null,
                            level: c.level || 1
                        }
                    }).catch(() => { });

                    // Mantém a tabela principal Character sincronizada para o Dashboard
                    const playableClass = CLASS_MAP[c.playable_class?.id] || c.playableClass || 'Unknown';
                    const playableRace = RACE_MAP[c.playable_race?.id] || c.playableRace || 'Unknown';
                    const realmName = c.realm?.name || realm || (guildConfig.gameFlavor === 'forever' ? 'PvP' : 'Nazgrim');

                    await prisma.character.upsert({
                        where: {
                            name_realm_surname: {
                                name: c.name,
                                realm: realmName,
                                surname: c.surname || null
                            }
                        },
                        update: {
                            blizzardCharId: c.id,
                            level: c.level || 1,
                            guildName: guildConfig.targetGuildName,
                            guildId: guildConfig.targetGuildId,
                            guildRank: m.rank ?? null
                        },
                        create: {
                            blizzardCharId: c.id,
                            discordId: null,
                            name: c.name,
                            surname: c.surname || null,
                            realm: realmName,
                            gameFlavor: guildConfig.gameFlavor || 'forever',
                            level: c.level || 1,
                            playableClass,
                            playableRace,
                            guildId: guildConfig.targetGuildId,
                            guildName: guildConfig.targetGuildName,
                            guildRank: m.rank ?? null
                        }
                    }).catch(() => { });
                }
            }
        }

        // 2. VARREDURA DE CONQUISTAS (ACHIEVEMENTS)
        const recentAchievements = await fetchGuildAchievements(guildConfig.targetGuildName, realm, guildConfig.gameFlavor);
        const loggedAchievements = await prisma.guildAchievementLog.findMany({
            where: { guildId }
        });
        const loggedSet = new Set(loggedAchievements.map(a => a.achievementId));

        if (loggedAchievements.length === 0 && recentAchievements.length > 0) {
            // Primeira execução: cadastra as conquistas existentes como baseline
            for (const ev of recentAchievements) {
                const achId = ev.achievement?.id || ev.id;
                const achName = ev.achievement?.name || ev.name;
                if (achId) {
                    await prisma.guildAchievementLog.create({
                        data: {
                            guildId,
                            achievementId: achId,
                            name: achName || 'Conquista',
                            completedAt: ev.timestamp ? new Date(ev.timestamp) : new Date()
                        }
                    }).catch(() => { });
                }
            }
        } else {
            for (const ev of recentAchievements) {
                const achId = ev.achievement?.id || ev.id;
                const achName = ev.achievement?.name || ev.name;
                if (!achId || loggedSet.has(achId)) continue;

                console.log(`[GuildNews] Nova conquista detectada: ${achName}`);

                const embed = new EmbedBuilder()
                    .setColor('#8B5CF6')
                    .setTitle('🏆 Nova Conquista Desbloqueada!')
                    .setDescription(`A guilda **<${guildConfig.targetGuildName}>** concluiu a conquista **${achName}**! ⚔️`)
                    .setFooter({ text: `<${guildConfig.targetGuildName}> • Guild News` })
                    .setTimestamp(ev.timestamp ? new Date(ev.timestamp) : new Date());

                await channel.send({ embeds: [embed] }).catch(err => {
                    console.error('[GuildNews] Erro ao enviar conquista:', err.message);
                });

                await prisma.guildAchievementLog.create({
                    data: {
                        guildId,
                        achievementId: achId,
                        name: achName || 'Conquista',
                        completedAt: ev.timestamp ? new Date(ev.timestamp) : new Date()
                    }
                }).catch(() => { });
            }
        }

        // Atualiza a timestamp da última verificação
        await prisma.guildConfig.update({
            where: { guildId },
            data: { lastNewsScan: new Date() }
        });

        return { scanned: true, success: true };
    } catch (err) {
        console.error('[GuildNews] Erro durante a varredura:', err);
        return { scanned: false, error: err.message };
    }
}

/**
 * Inicia o agendador periódico que roda em background.
 * Checa a cada 60s quais guildas estão ativas e venceram o intervalo configurado.
 */
export function startGuildNewsScheduler() {
    if (schedulerInterval) return;

    console.log('[GuildNews] Agendador periódico de Guild News ativado.');

    const checkActiveGuilds = async () => {
        try {
            // Busca apenas servidores com Guild News ATIVADO e guilda definida
            const activeConfigs = await prisma.guildConfig.findMany({
                where: {
                    newsChannelId: { not: null },
                    targetGuildName: { not: null }
                }
            });

            const now = Date.now();

            for (const cfg of activeConfigs) {
                const intervalMs = (cfg.newsIntervalMinutes || 15) * 60 * 1000;
                const lastScanMs = cfg.lastNewsScan ? new Date(cfg.lastNewsScan).getTime() : 0;

                if (now - lastScanMs >= intervalMs) {
                    await scanGuildNews(cfg.guildId);
                }
            }
        } catch (err) {
            console.error('[GuildNews Scheduler] Erro no loop de verificação:', err);
        }
    };

    // Executa uma checagem inicial 5 segundos após ligar o bot (caso já tenha vencido o intervalo enquanto desligado)
    setTimeout(checkActiveGuilds, 5000);

    schedulerInterval = setInterval(checkActiveGuilds, 60 * 1000); // Checa a cada 1 minuto
}
