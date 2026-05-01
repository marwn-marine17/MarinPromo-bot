import express from "express";
import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const ALI_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || "MarinePromo";

const bot = new Telegraf(botToken!);
const genAI = new GoogleGenerativeAI(GEMINI_KEY || "");
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * وظيفة خارقة لتجاوز حماية علي إكسبريس واستخراج ID المنتج
 */
async function getProductIdSmart(url: string): Promise<string | null> {
    try {
        // محاكاة متصفح آيفون حقيقي لتجاوز الحظر
        const headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
        };

        let currentUrl = url;

        if (url.includes("a.aliexpress.com") || url.includes("/e/")) {
            const response = await axios.get(url, {
                maxRedirects: 15,
                headers: headers,
                timeout: 10000
            });
            currentUrl = response.request.res.responseUrl || url;
        }

        // استخراج الرقم باستخدام أنماط متعددة
        const patterns = [
            /item\/(\d+)\.html/,
            /id=(\d+)/,
            /(\d{11,15})/, // البحث عن أي رقم طويل (11-15 رقم)
            /item\/(\d+)/
        ];

        for (const pattern of patterns) {
            const match = currentUrl.match(pattern);
            if (match && match[1]) return match[1];
        }

        return null;
    } catch (error) {
        // إذا فشل التتبع، نبحث عن أرقام في نص الرابط نفسه
        const emergencyMatch = url.match(/(\d{11,15})/);
        return emergencyMatch ? emergencyMatch[1] : null;
    }
}

async function getProductInfo(id: string) {
    try {
        const url = `https://www.aliexpress.com/item/${id}.html`;
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 7000
        });
        const $ = cheerio.load(res.data);
        const title = $('meta[property="og:title"]').attr('content')?.split('|')[0].trim() || "منتج AliExpress";
        const image = $('meta[property="og:image"]').attr('content') || "";
        return { title, image };
    } catch (e) { return null; }
}

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.includes("aliexpress.com") || text.includes("s.click")) {
        const waitMsg = await ctx.reply("🔍 جاري تجاوز الحماية واستخراج العروض...");
        
        const productId = await getProductIdSmart(text);

        if (!productId) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, "⚠️ فشل البوت في فك تشفير هذا الرابط بسبب حماية علي إكسبريس.\n💡 حاول نسخ الرابط من المتصفح (الرابط الطويل) وسيعمل فوراً.");
        }

        const info = await getProductInfo(productId);
        
        let aiAdvice = "💎 تخفيض ممتاز وحصري";
        if (GEMINI_KEY && info?.title) {
            try {
                const result = await aiModel.generateContent(`أعطني جملة تسويقية مغرية وقصيرة جداً بالعربية عن: ${info.title}`);
                aiAdvice = result.response.text().trim();
            } catch (e) {}
        }

        const mainLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&trackingId=${ALI_TRACKING_ID}`;
        const superLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=super&trackingId=${ALI_TRACKING_ID}`;
        const choiceLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=choice&trackingId=${ALI_TRACKING_ID}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url("🛒 شراء الآن (أقل سعر)", mainLink)],
            [Markup.button.url("🔥 عروض السوبر ديلز", superLink)],
            [Markup.button.url("✨ عروض Choice المميزة", choiceLink)]
        ]);

        const caption = `<b>${aiAdvice}</b>\n\n📦 <b>${info?.title || "منتج AliExpress"}</b>\n\n🆔 رقم المنتج: <code>${productId}</code>\n\n✨ <i>استخدم الروابط أدناه للخصم المباشر:</i>`;

        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        
        if (info?.image) {
            await ctx.replyWithPhoto(info.image, { caption, parse_mode: "HTML", ...keyboard });
        } else {
            await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
        }
    }
});

app.get("/", (req, res) => res.send("Bot Online 🚀"));
app.listen(PORT, () => { bot.launch(); });
