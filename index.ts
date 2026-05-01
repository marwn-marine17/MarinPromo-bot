import express from "express";
import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// الإعدادات الأساسية
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const ALI_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || "MarinePromo";

const bot = new Telegraf(botToken!);
const genAI = new GoogleGenerativeAI(GEMINI_KEY || "");
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * دالة بسيطة لاستخراج معرف المنتج
 */
async function extractId(url: string): Promise<string | null> {
    try {
        let finalUrl = url;
        // محاولة تتبع الرابط إذا كان مختصراً بشكل بسيط
        if (url.includes("/e/") || url.includes("a.aliexpress.com")) {
            const res = await axios.get(url, { maxRedirects: 10, timeout: 8000 });
            finalUrl = res.request.res.responseUrl || url;
        }
        
        // البحث عن الرقم في الرابط النهائي
        const match = finalUrl.match(/item\/(\d+)\.html/) || finalUrl.match(/id=(\d+)/) || finalUrl.match(/(\d{11,15})/);
        return match ? match[1] : null;
    } catch (e) {
        // في حال الخطأ، نبحث عن أي رقم طويل في الرابط الأصلي
        const emergency = url.match(/(\d{11,15})/);
        return emergency ? emergency[1] : null;
    }
}

bot.start((ctx) => ctx.reply("👋 أهلاً بك! أرسل رابط AliExpress للحصول على عروض الخصم."));

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.includes("aliexpress.com") || text.includes("s.click")) {
        const waitMsg = await ctx.reply("🔍 جاري المعالجة...");
        
        const productId = await extractId(text);

        if (!productId) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, "⚠️ عذراً، لم أتمكن من العثور على رقم المنتج في هذا الرابط.");
        }

        // إنشاء الروابط
        const mainLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&trackingId=${ALI_TRACKING_ID}`;
        const superLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=super&trackingId=${ALI_TRACKING_ID}`;
        const choiceLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=choice&trackingId=${ALI_TRACKING_ID}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url("🛒 شراء الآن (الخصم الرئيسي)", mainLink)],
            [Markup.button.url("🔥 عروض السوبر ديلز", superLink)],
            [Markup.button.url("✨ عروض Choice", choiceLink)]
        ]);

        let aiMessage = "💎 اجري تخفيض ممتاز";
        // إضافة لمسة AI بسيطة إذا كان المفتاح متاحاً
        if (GEMINI_KEY) {
            try {
                const result = await aiModel.generateContent("أعطني جملة تشجيعية قصيرة جداً للتسوق من علي إكسبريس مع إيموجي.");
                aiMessage = result.response.text().trim();
            } catch (e) {}
        }

        const responseText = `${aiMessage}\n\n📦 <b>ID المنتج:</b> <code>${productId}</code>\n\n✨ استخدم الروابط أدناه للحصول على الخصم المباشر:`;

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, responseText, {
            parse_mode: "HTML",
            ...keyboard
        });
    }
});

// السيرفر لضمان عمل Render
app.get("/", (req, res) => res.send("Bot is Online"));
app.listen(PORT, () => {
    bot.launch();
});
