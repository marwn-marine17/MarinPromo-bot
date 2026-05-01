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

if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN missing!");

const bot = new Telegraf(botToken);
const genAI = new GoogleGenerativeAI(GEMINI_KEY || "");
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * محرك استخراج ID المنتج - مصمم ليكون مضاداً للحظر
 */
async function getProductId(url: string) {
    try {
        let currentUrl = url;
        // تتبع الروابط المختصرة
        if (url.includes("/e/") || url.includes("aliexpress.com") || url.includes("s.click")) {
            const res = await axios.get(url, {
                maxRedirects: 15,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' },
                timeout: 10000
            });
            currentUrl = res.request.res.responseUrl || url;
        }

        // البحث عن الرقم التسلسلي للمنتج في الرابط النهائي
        const match = currentUrl.match(/item\/(\d+)\.html/) || currentUrl.match(/id=(\d+)/) || currentUrl.match(/\/(\d+)\.html/);
        return match ? match[1] : null;
    } catch (e) {
        // في حال فشل التتبع، نحاول استخراج أي رقم طويل من الرابط الأصلي
        const fallbackMatch = url.match(/(\d{10,20})/);
        return fallbackMatch ? fallbackMatch[1] : null;
    }
}

/**
 * جلب بيانات المنتج (اختياري) - إذا فشل لا يوقف البوت
 */
async function getMetaInfo(url: string) {
    try {
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000
        });
        const $ = cheerio.load(res.data);
        const title = $('meta[property="og:title"]').attr('content')?.split('|')[0].trim();
        const image = $('meta[property="og:image"]').attr('content');
        return { title, image };
    } catch (e) {
        return { title: null, image: null };
    }
}

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.includes("aliexpress.com") || text.includes("s.click")) {
        const waitMsg = await ctx.reply("🔍 جاري تجهيز أفضل العروض...");

        const productId = await getProductId(text);

        if (!productId) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, "⚠️ عذراً، لم أتمكن من استخراج رقم المنتج. يرجى إرسال رابط المنتج الأصلي.");
        }

        // محاولة جلب معلومات إضافية (إذا فشلت سيستمر البوت)
        const meta = await getMetaInfo(text);
        const productTitle = meta.title || "منتج AliExpress المميز";
        
        // توليد نصيحة AI
        let aiAdvice = "💎 اجري تخفيض ممتاز";
        if (GEMINI_KEY && meta.title) {
            try {
                const result = await aiModel.generateContent(`أعطني جملة تسويقية قصيرة جداً ومغرية عن: ${meta.title}`);
                aiAdvice = result.response.text().trim();
            } catch (e) {}
        }

        const mainLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&trackingId=${ALI_TRACKING_ID}`;
        const superDeals = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=super&trackingId=${ALI_TRACKING_ID}`;
        const choiceLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=choice&trackingId=${ALI_TRACKING_ID}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url("🛒 شراء الآن (الخصم الرئيسي)", mainLink)],
            [Markup.button.url("🔥 عروض السوبر ديلز", superDeals)],
            [Markup.button.url("✨ عروض تشويس Choice", choiceLink)]
        ]);

        const caption = `<b>${aiAdvice}</b>\n\n📦 <b>${productTitle}</b>\n\n🆔 رقم المنتج: <code>${productId}</code>\n\n✨ <i>استخدم الروابط أعلاه للخصم المباشر:</i>`;

        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
            if (meta.image) {
                await ctx.replyWithPhoto(meta.image, { caption, parse_mode: "HTML", ...keyboard });
            } else {
                await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
            }
        } catch (err) {
            await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
        }
    }
});

app.get("/", (req, res) => res.send("Bot is Running 🚀"));
app.listen(PORT, () => { bot.launch(); });
