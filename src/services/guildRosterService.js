import { prisma } from './db.js';
import { fetchGuildRoster, fetchCharacterProfessions } from './bnetService.js';

export const CLASS_MAP = {
    1: 'Warrior',
    2: 'Paladin',
    3: 'Hunter',
    4: 'Rogue',
    5: 'Priest',
    6: 'Death Knight',
    7: 'Shaman',
    8: 'Mage',
    9: 'Warlock',
    10: 'Monk',
    11: 'Druid',
    12: 'Demon Hunter',
    13: 'Evoker'
};

export const RACE_MAP = {
    1: 'Human',
    2: 'Orc',
    3: 'Dwarf',
    4: 'Night Elf',
    5: 'Undead',
    6: 'Tauren',
    7: 'Gnome',
    8: 'Troll',
    9: 'Goblin',
    10: 'Blood Elf',
    11: 'Draenei',
    22: 'Worgen',
    24: 'Pandaren',
    25: 'Pandaren',
    26: 'Pandaren'
};

/**
 * Pré-hidrata o elenco completo da guilda no banco de dados.
 * Registra todos os personagens (com discordId = null se ainda não vinculados),
 * suas classes, níveis, guildRank e profissões (no WoW Forever/Retail).
 */
export async function hydrateGuildRoster(guildId, targetGuildName, realm = null, flavor = 'forever', targetGuildId = null) {
    if (!targetGuildName) return { success: false, reason: 'Nome da guilda não informado' };

    console.log(`[GuildRoster] Pré-hidratando roster para guilda "${targetGuildName}" (${flavor}, reino: ${realm || 'padrão'})...`);

    try {
        const members = await fetchGuildRoster(targetGuildName, realm, flavor);
        if (!members || members.length === 0) {
            console.warn(`[GuildRoster] Nenhum membro retornado pela Blizzard para "${targetGuildName}".`);
            return { success: false, reason: 'Roster vazio ou guilda não encontrada' };
        }

        console.log(`[GuildRoster] ${members.length} membros encontrados. Processando registros no banco...`);

        let createdCount = 0;
        let updatedCount = 0;

        for (const m of members) {
            const c = m.character;
            if (!c || !c.id) continue;

            const blizzardCharId = c.id;
            const name = c.name;
            const surname = c.surname || null;
            const realmName = c.realm?.name || realm || (flavor === 'forever' ? 'PvP' : 'Nazgrim');
            const level = c.level || 1;
            const rank = m.rank ?? null;
            const playableClass = CLASS_MAP[c.playable_class?.id] || c.playableClass || 'Unknown';
            const playableRace = RACE_MAP[c.playable_race?.id] || c.playableRace || 'Unknown';

            // Verifica se o personagem já existe pelo ID numérico da Blizzard ou pelo nome/reino
            const existing = await prisma.character.findFirst({
                where: {
                    OR: [
                        { blizzardCharId },
                        {
                            name,
                            realm: realmName,
                            surname
                        }
                    ]
                }
            });

            let charRecordId = null;

            if (existing) {
                // Atualiza mantendo o discordId se o jogador já se vinculou antes
                const updated = await prisma.character.update({
                    where: { id: existing.id },
                    data: {
                        blizzardCharId,
                        level,
                        playableClass,
                        playableRace,
                        guildId: targetGuildId || existing.guildId,
                        guildName: targetGuildName,
                        guildRank: rank
                    }
                });
                charRecordId = updated.id;
                updatedCount++;
            } else {
                // Cadastra personagem pré-hidratado sem discordId (aguardando login social)
                const created = await prisma.character.create({
                    data: {
                        blizzardCharId,
                        discordId: null,
                        name,
                        surname,
                        realm: realmName,
                        gameFlavor: flavor,
                        level,
                        playableClass,
                        playableRace,
                        guildId: targetGuildId || null,
                        guildName: targetGuildName,
                        guildRank: rank
                    }
                });
                charRecordId = created.id;
                createdCount++;
            }

            // Sincroniza o baseline do GuildMemberSnapshot para o agendador de Guild News
            await prisma.guildMemberSnapshot.upsert({
                where: {
                    guildId_charId: {
                        guildId,
                        charId: blizzardCharId
                    }
                },
                update: {
                    level,
                    name,
                    surname
                },
                create: {
                    guildId,
                    charId: blizzardCharId,
                    name,
                    surname,
                    level
                }
            }).catch(() => { });

            // Busca e hidrata profissões caso suportado (WoW Forever e Retail)
            if (flavor === 'forever' || flavor === 'retail') {
                try {
                    const profs = await fetchCharacterProfessions(name, surname, realmName, flavor);
                    for (const p of profs) {
                        await prisma.profession.upsert({
                            where: {
                                characterId_name: {
                                    characterId: charRecordId,
                                    name: p.name
                                }
                            },
                            update: {
                                skillPoints: p.skillPoints,
                                maxSkill: p.maxSkill,
                                isPrimary: p.isPrimary
                            },
                            create: {
                                characterId: charRecordId,
                                name: p.name,
                                skillPoints: p.skillPoints,
                                maxSkill: p.maxSkill,
                                isPrimary: p.isPrimary
                            }
                        }).catch(() => { });
                    }
                } catch (e) { }
            }
        }

        console.log(`[GuildRoster] Pré-hidratação concluída! Novos: ${createdCount}, Atualizados: ${updatedCount}.`);
        return { success: true, total: members.length, created: createdCount, updated: updatedCount };
    } catch (err) {
        console.error('[GuildRoster] Erro ao pré-hidratar roster:', err);
        return { success: false, error: err.message };
    }
}
