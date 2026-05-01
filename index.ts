import express from "express";
import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// استخراج مفاتيح البيئة
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const ALI_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || "MarinePromo";

if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN missing!");

const bot = new Telegraf(botToken);
const genAI = new GoogleGenerativeAI(GEMINI_KEY || "");
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * وظيفة متطورة لجلب بيانات المنتج (العنوان، الصورة، ورقم المنتج)
 */
async function fetchProductDetails(url: string) {
    try {
        let finalUrl = url;
        // تتبع الروابط المختصرة وروابط الأفلييت للوصول للرابط الأصلي
        if (url.includes("/e/") || url.includes("aliexpress.com") || url.includes("s.click")) {
            const res = await axios.get(url, {
                maxRedirects: 20,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                timeout: 15000
            });
            finalUrl = res.request.res.responseUrl || url;
        }

        // جلب صفحة المنتج لاستخراج الميتا داتا
        const response = await axios.get(finalUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const $ = cheerio.load(response.data);
        // استخراج العنوان والصورة
        const title = $('meta[property="og:title"]').attr('content')?.split('|')[0].trim() || "منتج AliExpress المميز";
        const image = $('meta[property="og:image"]').attr('content') || "";
        
        // استخراج رقم المنتج (ID) المكون من 11 رقم أو أكثر
        const idMatch = finalUrl.match(/(\d{10,20})/);
        const productId = idMatch ? idMatch[1] : null;

        return { title, image, productId };
    } catch (e) {
        console.error("Scraping Error:", e);
        return null;
    }
}

/**
 * وظيفة توليد نصيحة تسويقية باستخدام ذكاء Gemini الاصطناعي
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

bot.start((ctx) => ctx.reply("✨ مرحباً بك في MarinePromo! أرسل لي رابط منتج AliExpress وسأجهز لك العروض بالصور والذكاء الاصطناعي."));

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.includes("aliexpress.com") || text.includes("s.click")) {
        const waitMsg = await ctx.reply("🔍 جاري تحليل المنتج وتجهيز أفضل الروابط...");

        const product = await fetchProductDetails(text);

        if (!product || !product.productId) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, "⚠️ عذراً، لم أتمكن من استخراج بيانات المنتج بشكل صحيح. تأكد من أن الرابط لمنتج متاح.");
        }

        const aiAdvice = await generateSmartAdvice(product.title);

        // روابط الأفلييت الذكية
        const mainLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${product.productId}&trackingId=${ALI_TRACKING_ID}`;
        const superDeals = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${product.productId}&promotion=super&trackingId=${ALI_TRACKING_ID}`;
        const choiceLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${product.productId}&promotion=choice&trackingId=${ALI_TRACKING_ID}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url("🛒 شراء الآن (الخصم الرئيسي)", mainLink)],
            [Markup.button.url("🔥 عروض السوبر ديلز", superDeals)],
            [Markup.button.url("✨ عروض تشويس Choice", choiceLink)]
        ]);

        const caption = `<b>${aiAdvice}</b>\n\n📦 <b>${product.title}</b>\n\n✨ <i>استخدم الروابط أدناه للحصول على الخصم المباشر:</i>`;

        try {
            // حذف رسالة الانتظار
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

// إعداد خادم ويب لـ Render
app.get("/", (req, res) => res.send("Bot is Running with Image & AI Support! 🚀"));
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    bot.launch();
});
