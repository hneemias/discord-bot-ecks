import { Client, Collection, GatewayIntentBits } from 'discord.js';

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.commands = new Collection();

export async function loginBot() {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('[Discord] DISCORD_TOKEN não foi configurado no arquivo .env!');
        return;
    }

    try {
        await client.login(token);
        console.log(`[Discord] Bot conectado como: ${client.user.tag}`);
    } catch (err) {
        console.error('[Discord] Erro ao conectar o bot:', err.message);
    }
}
