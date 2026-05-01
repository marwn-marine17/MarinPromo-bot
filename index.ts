import express from "express";
import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات المفاتيح
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const ALI_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || "MarinePromo";

if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN missing!");

const bot = new Telegraf(botToken);
const genAI = new GoogleGenerativeAI(GEMINI_KEY || "");
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * وظيفة لجلب بيانات المنتج (العنوان والصورة والرقم) عبر الكشط الذكي
 */
async function fetchProductDetails(url: string) {
    try {
        let finalUrl = url;
        // تتبع الروابط المختصرة
        if (url.includes("/e/") || url.includes("a.aliexpress.com") || url.includes("s.click")) {
            const res = await axios.get(url, {
                maxRedirects: 15,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 10000
            });
            finalUrl = res.request.res.responseUrl || url;
        }

        const response = await axios.get(finalUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const $ = cheerio.load(response.data);
        const title = $('meta[property="og:title"]').attr('content')?.split('|')[0].trim() || "منتج AliExpress المميز";
        const image = $('meta[property="og:image"]').attr('content') || "";
        
        const idMatch = finalUrl.match(/(\d{10,20})/);
        const productId = idMatch ? idMatch[1] : null;

        return { title, image, productId };
    } catch (e) {
        return null;
    }
}

/**
 * وظيفة توليد نصيحة تسوق ذكية باستخدام Gemini
 */
async function generateSmartAdvice(productTitle: string) {
    if (!GEMINI_KEY) return "💎 اجري تخفيض ممتاز";
    try {
        const prompt = `أعطني جملة تسويقية قصيرة جداً ومغرية باللغة العربية عن هذا المنتج: "${productTitle}". ابدأ بإيموجي جوهرة أو شرارة.`;
        const result = await aiModel.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        return "💎 اجري تخفيض ممتاز";
    }
}

bot.start((ctx) => ctx.reply("✨ مرحباً بك! أرسل لي رابط AliExpress وسأقوم بتجهيز العروض لك بالصور والذكاء الاصطناعي."));

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.includes("aliexpress.com") || text.includes("s.click")) {
        const waitMsg = await ctx.reply("🔍 جاري جلب تفاصيل المنتج وتحليله بالذكاء الاصطناعي...");

        const product = await fetchProductDetails(text);

        if (!product || !product.productId) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, "⚠️ عذراً، لم أتمكن من الوصول لبيانات المنتج.");
        }

        const aiAdvice = await generateSmartAdvice(product.title);

        // إنشاء روابط الأفلييت
        const mainLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${product.productId}&trackingId=${ALI_TRACKING_ID}`;
        const superDeals = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${product.productId}&promotion=super&trackingId=${ALI_TRACKING_ID}`;
        const choiceLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${product.productId}&promotion=choice&trackingId=${ALI_TRACKING_ID}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url("🛒 شراء الآن (الخصم الرئيسي)", mainLink)],
            [Markup.button.url("🔥 عروض السوبر ديلز", superDeals)],
            [Markup.button.url("✨ عروض تشويس Choice", choiceLink)]
        ]);

        const caption = `${aiAdvice}\n\n📦 <b>${product.title}</b>\n\n✨ <i>استخدم الروابط أدناه للحصول على الخصم المباشر:</i>`;

        try {
            // حذف رسالة الانتظار وإرسال الصورة مع البيانات
            await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
            if (product.image) {
                await ctx.replyWithPhoto(product.image, { caption, parse_mode: "HTML", ...keyboard });
            } else {
                await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
            }
        } catch (err) {
            await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
        }
    }
});

app.get("/", (req, res) => res.send("Bot is Active with AI 🚀"));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.launch();
});
