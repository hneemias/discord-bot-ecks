import 'dotenv/config';
import { REST, Routes } from 'discord.js';

import * as vincularCommand from './commands/vincular.js';
import * as alterarMainCommand from './commands/alterar_main.js';
import * as whoisCommand from './commands/whois.js';

const commands = [
    vincularCommand.data.toJSON(),
    alterarMainCommand.data.toJSON(),
    whoisCommand.data.toJSON()
];

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
    console.error('[Deploy] DISCORD_TOKEN ou DISCORD_CLIENT_ID ausente no .env');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

export async function deployCommands(guildId = null) {
    try {
        console.log(`[Deploy] Registrando ${commands.length} comandos de barra (Slash Commands)...`);

        if (guildId) {
            // Registro instantâneo por servidor
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands }
            );
            console.log(`[Deploy] Comandos registrados com sucesso para o servidor: ${guildId}`);
        } else {
            // Registro global
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands }
            );
            console.log(`[Deploy] Comandos registrados globalmente com sucesso!`);
        }
    } catch (error) {
        console.error('[Deploy] Erro ao registrar comandos:', error);
    }
}

// Execução direta via CLI se chamado via script
if (process.argv[1]?.includes('deploy-commands.js')) {
    const targetGuild = process.argv[2] || null;
    deployCommands(targetGuild);
}
