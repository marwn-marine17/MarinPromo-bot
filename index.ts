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
 * محرك استخراج ID المنتج الخارق - 3 مستويات من المحاولات
 */
async function getProductIdSmart(url: string): Promise<string | null> {
    try {
        const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
        
        // المحاولة 1: تتبع الرابط مباشرة
        const res = await axios.get(url, {
            maxRedirects: 15,
            headers: { 'User-Agent': mobileUA },
            timeout: 10000
        });
        
        let finalUrl = res.request.res.responseUrl || url;
        let match = finalUrl.match(/item\/(\d+)\.html/) || finalUrl.match(/id=(\d+)/);
        if (match) return match[1];

        // المحاولة 2: البحث داخل محتوى الصفحة (HTML) إذا فشل تتبع الرابط
        const $ = cheerio.load(res.data);
        const htmlContent = res.data.toString();
        const idInHtml = htmlContent.match(/productId["']?\s*:\s*["']?(\d+)["']?/) || 
                         htmlContent.match(/item\/(\d+)\.html/);
        if (idInHtml) return idInHtml[1];

        // المحاولة 3: البحث عن أي رقم طويل (11-15 رقم) في الرابط النهائي كحل أخير
        const longNumberMatch = finalUrl.match(/(\d{11,15})/);
        if (longNumberMatch) return longNumberMatch[1];

        return null;
    } catch (e) {
        // إذا فشل كل شيء، نبحث عن رقم طويل في الرابط الأصلي نفسه
        const emergencyMatch = url.match(/(\d{11,15})/);
        return emergencyMatch ? emergencyMatch[1] : null;
    }
}

async function getProductInfo(id: string) {
    try {
        const url = `https://www.aliexpress.com/item/${id}.html`;
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 8000
        });
        const $ = cheerio.load(res.data);
        const title = $('meta[property="og:title"]').attr('content')?.split('|')[0].trim() || "منتج رائع من AliExpress";
        const image = $('meta[property="og:image"]').attr('content') || "";
        return { title, image };
    } catch (e) { return null; }
}

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.includes("aliexpress.com") || text.includes("s.click")) {
        const waitMsg = await ctx.reply("🔍 جاري فك تشفير الرابط واستخراج العرض...");
        
        const productId = await getProductIdSmart(text);

        if (!productId || productId === "404") {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, "⚠️ عذراً، هذا الرابط محمي جداً. جرب إرسال الرابط الأصلي للمنتج من المتصفح.");
        }

        const info = await getProductInfo(productId);
        
        // نصيحة AI
        let aiAdvice = "💎 اجري تخفيض ممتاز";
        if (GEMINI_KEY && info?.title) {
            try {
                const result = await aiModel.generateContent(`أعطني جملة تسويقية مغرية وقصيرة جداً عن: ${info.title}`);
                aiAdvice = result.response.text().trim();
            } catch (e) {}
        }

        const mainLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&trackingId=${ALI_TRACKING_ID}`;
        const superLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=super&trackingId=${ALI_TRACKING_ID}`;
        const choiceLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=choice&trackingId=${ALI_TRACKING_ID}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url("🛒 شراء الآن (الخصم الرئيسي)", mainLink)],
            [Markup.button.url("🔥 عروض السوبر ديلز", superLink)],
            [Markup.button.url("✨ عروض Choice المميزة", choiceLink)]
        ]);

        const caption = `<b>${aiAdvice}</b>\n\n📦 <b>${info?.title || "منتج AliExpress"}</b>\n\n🆔 رقم المنتج: <code>${productId}</code>\n\n✨ <i>استخدم الروابط أعلاه للخصم المباشر:</i>`;

        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        
        if (info?.image) {
            await ctx.replyWithPhoto(info.image, { caption, parse_mode: "HTML", ...keyboard });
        } else {
            await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
        }
    }
});

app.get("/", (req, res) => res.send("Bot is Alive 🚀"));
app.listen(PORT, () => { bot.launch(); });
