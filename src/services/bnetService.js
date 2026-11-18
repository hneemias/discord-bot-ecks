import axios from 'axios';

const CLIENT_ID = process.env.BNET_CLIENT_ID;
const CLIENT_SECRET = process.env.BNET_CLIENT_SECRET;
const REDIRECT_URI = process.env.BNET_CALLBACK_URL;

let appTokenCache = null;
let appTokenExpiresAt = 0;

export const FOREVER_RULESETS = ['pvp', 'normal', 'roleplay', 'roleplay pvp'];

/**
 * Obtém token de aplicação (Client Credentials)
 */
export async function getAppToken() {
    if (appTokenCache && Date.now() < appTokenExpiresAt) {
        return appTokenCache;
    }
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const response = await axios.post('https://oauth.battle.net/token', new URLSearchParams({
        grant_type: 'client_credentials'
    }).toString(), {
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    appTokenCache = response.data.access_token;
    appTokenExpiresAt = Date.now() + ((response.data.expires_in - 300) * 1000);
    return appTokenCache;
}

/**
 * Troca o código OAuth2 de autorização pelo token de acesso do usuário
 */
export async function exchangeCodeForToken(code) {
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const response = await axios.post('https://oauth.battle.net/token', new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code: code
    }).toString(), {
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    return response.data.access_token;
}

/**
 * Obtém os dados de perfil da conta Battle.net (id e battletag)
 */
export async function getUserProfile(accessToken) {
    const response = await axios.get('https://us.battle.net/oauth/userinfo', {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    return response.data;
}

/**
 * Busca informações oficiais de uma Guilda na Blizzard (ID numérico, facção, membros)
 */
export async function fetchGuildInfo(guildName, realm = null, flavor = 'forever') {
    try {
        const token = await getAppToken();
        const guildSlug = encodeURIComponent(guildName.toLowerCase().replace(/ /g, '-').replace(/'/g, ''));

        if (flavor === 'forever') {
            const res = await axios.get(`https://us.api.blizzard.com/data/wow/guild/${guildSlug}`, {
                params: { namespace: 'profile-forever-us', locale: 'en_US' },
                headers: { Authorization: `Bearer ${token}` }
            });

            return {
                id: res.data.id,
                name: res.data.name,
                faction: res.data.faction?.name || res.data.faction?.type || 'Unknown',
                memberCount: res.data.member_count || 0,
                realm: res.data.ruleset?.name || 'PvP'
            };
        } else {
            const realmSlug = encodeURIComponent((realm || 'azralon').toLowerCase().replace(/ /g, '-').replace(/'/g, ''));
            const candidateNamespaces = ['profile-classic-us', 'profile-classicann-us', 'profile-classic1x-us', 'profile-us'];

            for (const ns of candidateNamespaces) {
                try {
                    const res = await axios.get(`https://us.api.blizzard.com/data/wow/guild/${realmSlug}/${guildSlug}`, {
                        params: { namespace: ns, locale: 'en_US' },
                        headers: { Authorization: `Bearer ${token}` }
                    });

                    return {
                        id: res.data.id,
                        name: res.data.name,
                        faction: res.data.faction?.name || res.data.faction?.type || 'Unknown',
                        memberCount: res.data.member_count || 0,
                        realm: realm
                    };
                } catch (e) { }
            }

            return null;
        }
    } catch (err) {
        return null;
    }
}

/**
 * Busca o elenco (roster) completo de membros da guilda na Blizzard
 */
export async function fetchGuildRoster(guildName, realm = null, flavor = 'forever') {
    try {
        const token = await getAppToken();
        const guildSlug = encodeURIComponent(guildName.toLowerCase().replace(/ /g, '-').replace(/'/g, ''));

        if (flavor === 'forever') {
            const res = await axios.get(`https://us.api.blizzard.com/data/wow/guild/${guildSlug}/roster`, {
                params: { namespace: 'profile-forever-us', locale: 'en_US' },
                headers: { Authorization: `Bearer ${token}` }
            });
            return Array.isArray(res.data.members) ? res.data.members : [];
        } else {
            const realmSlug = encodeURIComponent((realm || 'azralon').toLowerCase().replace(/ /g, '-').replace(/'/g, ''));
            const candidateNamespaces = flavor === 'classic'
                ? ['profile-classic-us', 'profile-classic1x-us', 'profile-classicann-us']
                : ['profile-us'];

            for (const ns of candidateNamespaces) {
                try {
                    const res = await axios.get(`https://us.api.blizzard.com/data/wow/guild/${realmSlug}/${guildSlug}/roster`, {
                        params: { namespace: ns, locale: 'en_US' },
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    if (Array.isArray(res.data.members)) {
                        return res.data.members;
                    }
                } catch (e) { }
            }
            return [];
        }
    } catch (err) {
        console.error('[fetchGuildRoster] Erro ao buscar roster:', err.message);
        return [];
    }
}

/**
 * Busca as conquistas (achievements) recentes da guilda na Blizzard
 */
export async function fetchGuildAchievements(guildName, realm = null, flavor = 'forever') {
    try {
        const token = await getAppToken();
        const guildSlug = encodeURIComponent(guildName.toLowerCase().replace(/ /g, '-').replace(/'/g, ''));

        if (flavor === 'forever') {
            const res = await axios.get(`https://us.api.blizzard.com/data/wow/guild/${guildSlug}/achievements`, {
                params: { namespace: 'profile-forever-us', locale: 'en_US' },
                headers: { Authorization: `Bearer ${token}` }
            });
            return Array.isArray(res.data.recent_events) ? res.data.recent_events : [];
        } else {
            const realmSlug = encodeURIComponent((realm || 'azralon').toLowerCase().replace(/ /g, '-').replace(/'/g, ''));
            const candidateNamespaces = flavor === 'classic'
                ? ['profile-classic-us', 'profile-classic1x-us', 'profile-classicann-us']
                : ['profile-us'];

            for (const ns of candidateNamespaces) {
                try {
                    const res = await axios.get(`https://us.api.blizzard.com/data/wow/guild/${realmSlug}/${guildSlug}/achievements`, {
                        params: { namespace: ns, locale: 'en_US' },
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    if (Array.isArray(res.data.recent_events)) {
                        return res.data.recent_events;
                    }
                } catch (e) { }
            }
            return [];
        }
    } catch (err) {
        console.error('[fetchGuildAchievements] Erro ao buscar conquistas:', err.message);
        return [];
    }
}

/**
 * Verifica se um personagem pertence à guilda e retorna seu rank no roster
 */
export async function checkGuildMembership(guildName, charName, surname = null, realm = null, flavor = 'forever') {
    try {
        const token = await getAppToken();
        const guildSlug = encodeURIComponent(guildName.toLowerCase().replace(/ /g, '-').replace(/'/g, ''));

        let url = '';
        let ns = 'profile-forever-us';

        if (flavor === 'forever') {
            url = `https://us.api.blizzard.com/data/wow/guild/${guildSlug}/roster`;
            ns = 'profile-forever-us';
        } else {
            const realmSlug = encodeURIComponent((realm || 'azralon').toLowerCase().replace(/ /g, '-').replace(/'/g, ''));
            url = `https://us.api.blizzard.com/data/wow/guild/${realmSlug}/${guildSlug}/roster`;
            ns = flavor === 'classic' ? 'profile-classic1x-us' : 'profile-us';
        }

        const res = await axios.get(url, {
            params: { namespace: ns, locale: 'en_US' },
            headers: { Authorization: `Bearer ${token}` }
        });

        if (Array.isArray(res.data.members)) {
            const memberMatch = res.data.members.find(m => {
                const c = m.character;
                if (!c) return false;
                if (flavor === 'forever' && surname) {
                    return c.name.toLowerCase() === charName.toLowerCase() &&
                           c.surname?.toLowerCase() === surname.toLowerCase();
                }
                return c.name.toLowerCase() === charName.toLowerCase();
            });

            if (memberMatch) {
                return {
                    isMember: true,
                    rank: memberMatch.rank, // 0 = GM, 1 = Officer, 2 = Member...
                    charId: memberMatch.character?.id
                };
            }
        }

        return { isMember: false };
    } catch (err) {
        return { isMember: false };
    }
}

/**
 * Busca detalhes completos de um personagem específico na Blizzard (Guilda, Facção, Item Level)
 */
export async function fetchCharacterDetails(name, surname, realm, flavor = 'forever') {
    try {
        const token = await getAppToken();

        if (flavor === 'forever' || surname) {
            const formatted = `${name.toLowerCase()}-${surname ? surname.toLowerCase() : ''}`;
            const res = await axios.get(`https://us.api.blizzard.com/profile/wow/character/${formatted}`, {
                params: { namespace: 'profile-forever-us', locale: 'en_US' },
                headers: { Authorization: `Bearer ${token}` }
            });

            return {
                guildId: res.data.guild?.id || null,
                guildName: res.data.guild?.name || null,
                guildRank: null,
                faction: res.data.faction?.name || null,
                level: res.data.level || null,
                itemLevel: res.data.equipped_item_level || res.data.average_item_level || null,
                avatarUrl: res.data.media?.avatar || null
            };
        } else {
            const formattedRealm = realm.toLowerCase().replace(/ /g, '-').replace(/'/g, '');
            const formattedChar = encodeURIComponent(name.toLowerCase());
            const candidateNamespaces = ['profile-classic-us', 'profile-classicann-us', 'profile-classic1x-us', 'profile-us'];

            for (const ns of candidateNamespaces) {
                try {
                    const res = await axios.get(`https://us.api.blizzard.com/profile/wow/character/${formattedRealm}/${formattedChar}`, {
                        params: { namespace: ns, locale: 'en_US' },
                        headers: { Authorization: `Bearer ${token}` }
                    });

                    return {
                        guildId: res.data.guild?.id || null,
                        guildName: res.data.guild?.name || null,
                        guildRank: null,
                        faction: res.data.faction?.name || null,
                        level: res.data.level || null,
                        itemLevel: res.data.equipped_item_level || res.data.average_item_level || null
                    };
                } catch (e) { }
            }

            return null;
        }
    } catch (err) {
        return null;
    }
}

function parseProfessionsResponse(data) {
    const list = [];
    if (Array.isArray(data.primaries)) {
        for (const p of data.primaries) {
            const pName = p.profession?.name;
            const tier = p.tiers?.[p.tiers.length - 1];
            if (pName) {
                list.push({
                    name: pName,
                    skillPoints: tier?.skill_points ?? null,
                    maxSkill: tier?.max_skill_points ?? null,
                    isPrimary: true
                });
            }
        }
    }

    if (Array.isArray(data.secondaries)) {
        for (const s of data.secondaries) {
            const sName = s.profession?.name;
            const tier = s.tiers?.[s.tiers.length - 1];
            if (sName) {
                list.push({
                    name: sName,
                    skillPoints: tier?.skill_points ?? null,
                    maxSkill: tier?.max_skill_points ?? null,
                    isPrimary: false
                });
            }
        }
    }

    return list;
}

/**
 * Busca as profissões de um personagem (Primárias e Secundárias)
 * Suporta WoW Forever, MoP / Classic e Retail
 */
export async function fetchCharacterProfessions(name, surname, realm, flavor = 'forever') {
    try {
        const token = await getAppToken();

        if (flavor === 'forever' || surname) {
            const formatted = `${name.toLowerCase()}-${surname ? surname.toLowerCase() : ''}`;
            const res = await axios.get(`https://us.api.blizzard.com/profile/wow/character/${formatted}/professions`, {
                params: { namespace: 'profile-forever-us', locale: 'en_US' },
                headers: { Authorization: `Bearer ${token}` }
            });
            return parseProfessionsResponse(res.data);
        } else {
            const formattedRealm = realm.toLowerCase().replace(/ /g, '-').replace(/'/g, '');
            const formattedChar = encodeURIComponent(name.toLowerCase());
            const candidateNamespaces = ['profile-classic-us', 'profile-classicann-us', 'profile-classic1x-us', 'profile-us'];

            for (const ns of candidateNamespaces) {
                try {
                    const res = await axios.get(`https://us.api.blizzard.com/profile/wow/character/${formattedRealm}/${formattedChar}/professions`, {
                        params: { namespace: ns, locale: 'en_US' },
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    const result = parseProfessionsResponse(res.data);
                    if (result.length > 0) return result;
                } catch (e) { }
            }
            return [];
        }
    } catch (err) {
        return [];
    }
}

/**
 * Obtém a lista de personagens do WoW vinculados à conta do jogador.
 * Suporta múltiplos namespaces para cobrir WoW Forever, Classic e Retail.
 */
export async function getWoWCharacters(accessToken, flavor = 'forever') {
    let allCharacters = [];

    // Namespaces para cobrir WoW Forever, MoP Classic / Classic Progression, Classic Era e Retail
    let namespaces = [
        'profile-forever-us',
        'profile-classic-us',
        'profile-classicann-us',
        'profile-classic1x-us',
        'profile-us'
    ];

    if (flavor === 'classic') {
        namespaces = ['profile-classic-us', 'profile-classic1x-us', 'profile-classicann-us', 'profile-forever-us', 'profile-us'];
    } else if (flavor === 'retail') {
        namespaces = ['profile-us', 'profile-forever-us', 'profile-classic-us', 'profile-classic1x-us'];
    }

    for (const ns of namespaces) {
        try {
            const response = await axios.get('https://us.api.blizzard.com/profile/user/wow', {
                params: {
                    namespace: ns,
                    locale: 'en_US'
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (response.data && response.data.wow_accounts) {
                for (const account of response.data.wow_accounts) {
                    if (account.characters && account.characters.length > 0) {
                        for (const char of account.characters) {
                            let name = char.name;
                            let surname = char.surname || null;

                            // Caso venha em formato "Nome Sobrenome" em nome único (particularidade WoW Forever)
                            if (!surname && name.includes(' ')) {
                                const parts = name.split(' ');
                                name = parts[0];
                                surname = parts.slice(1).join(' ');
                            }

                            const realmName = char.realm?.name?.en_US || char.realm?.name || 'PvP';

                            // Identifica o flavor do personagem: no WoW Forever, sobrenome (Surname) é mandatório
                            let charFlavor = 'retail';
                            if (surname && surname.trim() !== '') {
                                charFlavor = 'forever';
                            } else if (ns.includes('classic')) {
                                charFlavor = 'classic';
                            }

                            allCharacters.push({
                                name,
                                surname,
                                realm: realmName,
                                gameFlavor: charFlavor,
                                level: char.level || 1,
                                playableClass: char.playable_class?.name?.en_US || char.playable_class?.name || 'Unknown',
                                playableRace: char.playable_race?.name?.en_US || char.playable_race?.name || 'Unknown',
                                guildId: char.guild?.id || null,
                                guildName: char.guild?.name || null,
                                guildRank: char.guild_rank ?? null,
                                raw: char
                            });
                        }
                    }
                }
            }
        } catch (e) {
            // Namespace sem personagens, continua
        }
    }

    // Remove duplicatas caso o mesmo personagem apareça em mais de um namespace
    const seen = new Map();
    for (const char of allCharacters) {
        const key = `${char.name}-${char.realm}`;
        if (!seen.has(key)) {
            seen.set(key, char);
        } else {
            if (char.gameFlavor === 'forever') {
                seen.set(key, char);
            }
        }
    }

    return Array.from(seen.values());
}
