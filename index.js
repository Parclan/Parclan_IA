require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Actualizado a gemini-2.5-flash (modelo vigente en 2026)
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });



const USAGE_FILE = path.join(__dirname, 'usage.json');
const MAX_DAILY_MESSAGES = 50; // Límite de mensajes por día

// Memoria de chats en tiempo real
const chats = {};

// Función para obtener/inicializar uso diario
function getDailyUsage() {
    const today = new Date().toISOString().split('T')[0];
    if (!fs.existsSync(USAGE_FILE)) {
        return { date: today, users: {} };
    }
    const data = JSON.parse(fs.readFileSync(USAGE_FILE));
    if (data.date !== today) {
        return { date: today, users: {} };
    }
    return data;
}

function saveUsage(usage) {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userMessage = msg.text;

    if (!userMessage) return;

    // Control de límites
    let usage = getDailyUsage();
    const userCount = usage.users[chatId] || 0;

    if (userCount >= MAX_DAILY_MESSAGES) {
        bot.sendMessage(chatId, `⚠️ Has agotado tus ${MAX_DAILY_MESSAGES} mensajes gratuitos por hoy. Se reiniciarán mañana.`);
        return;
    }

    // Inicializar historial si no existe
    if (!chats[chatId]) {
        chats[chatId] = model.startChat({
            history: [],
        });
    }

    try {
        const result = await chats[chatId].sendMessage(userMessage);
        const response = result.response.text();

        // Incrementar y guardar uso
        usage.users[chatId] = userCount + 1;
        saveUsage(usage);

        // Función para enviar mensajes largos divididos
        await sendLongMessage(chatId, response);

    } catch (error) {
        console.error("DEBUG ERROR:", error);


        let errorMsg = "Error con la IA 😢";

        if (error.message.includes('API_KEY_INVALID')) {
            errorMsg = "❌ Error: La clave de API de Gemini no es válida.";
        } else if (error.message.includes('SAFETY')) {
            errorMsg = "🛡️ La IA bloqueó este mensaje por motivos de seguridad.";
        } else if (error.message) {
            errorMsg = `❌ Error técnico: ${error.message.substring(0, 100)}`;
        }

        bot.sendMessage(chatId, errorMsg);
    }
});

// Función auxiliar para enviar mensajes de más de 4096 caracteres (límite de Telegram)
async function sendLongMessage(chatId, text) {
    const MAX_LENGTH = 4000;
    for (let i = 0; i < text.length; i += MAX_LENGTH) {
        const chunk = text.substring(i, i + MAX_LENGTH);
        await bot.sendMessage(chatId, chunk);
    }
}

