import express from "express";
import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const ALI_APP_KEY = process.env.ALIEXPRESS_APP_KEY;
const ALI_APP_SECRET = process.env.ALIEXPRESS_APP_SECRET;
const ALI_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || "MarinePromo";
const GATEWAY_URL = "https://api-sg.aliexpress.com/sync";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(botToken!);

/**
 * وظيفة محسنة لاستخراج ID المنتج حتى من الروابط المختصرة والمحمية
 */
async function extractProductId(url: string): Promise<string | null> {
    try {
        let targetUrl = url;
        if (url.includes("a.aliexpress.com")) {
            const response = await axios.get(url, {
                maxRedirects: 10,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
            });
            targetUrl = response.request.res.responseUrl || url;
        }

        const patterns = [/item\/(\d+)\.html/, /id=(\d+)/, /\/(\d+)\.html/, /item\/(\d+)/];
        for (const pattern of patterns) {
            const match = targetUrl.match(pattern);
            if (match && match[1]) return match[1];
        }
        return null;
    } catch (error) {
        console.error("Error extracting ID:", error);
        return null;
    }
}

bot.start((ctx) => ctx.reply("👋 أهلاً بك في بوت AliExpress المطور!\nأرسل لي أي رابط منتج وسأعطيك أفضل عرض وخصم."));

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.includes("aliexpress.com")) {
        const waitMsg = await ctx.reply("🔍 جاري تحليل الرابط وتجهيز العروض...");
        
        try {
            const productId = await extractProductId(text);
            if (!productId) {
                return ctx.reply("❌ عذراً، الرابط محمي أو غير صحيح. حاول إرسال رابط المنتج كاملاً من المتصفح.");
            }

            // توليد روابط الأفلييت (رابط رئيسي، سوبر ديلز، وتشويس)
            const affLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&trackingId=${ALI_TRACKING_ID}`;
            const superDeals = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=super&trackingId=${ALI_TRACKING_ID}`;
            const choiceLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=choice&trackingId=${ALI_TRACKING_ID}`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.url("🛒 شراء الآن (الخصم الرئيسي)", affLink)],
                [Markup.button.url("🔥 عروض السوبر ديلز", superDeals)],
                [Markup.button.url("✨ عروض تشويس Choice", choiceLink)]
            ]);

            let message = `💎 <b>تم تجهيز روابط الخصم المباشر:</b>\n\n`;
            message += `📌 <b>معرف المنتج:</b> <code>${productId}</code>\n\n`;
            message += `🚀 استخدم الروابط أدناه للحصول على أقل سعر متاح حالياً:`;

            await ctx.reply(message, { parse_mode: "HTML", ...keyboard });

        } catch (error) {
            await ctx.reply("❌ واجهت مشكلة أثناء معالجة الرابط.");
        } finally {
            try { await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch (e) {}
        }
    }
});

app.get("/", (req, res) => res.send("Bot status: Online"));

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    bot.launch();
});
