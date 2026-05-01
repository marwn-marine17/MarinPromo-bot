import express from "express";
import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const ALI_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || "MarinePromo";

if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is required!");
const bot = new Telegraf(botToken);

/**
 * محرك استخراج ID المنتج المطور - يدعم كافة أنواع الروابط
 */
async function getAliExpressId(url: string): Promise<string | null> {
    try {
        let finalUrl = url;

        // إذا كان الرابط مختصراً، نحاول تتبعه للحصول على الرابط الطويل
        if (url.includes("/e/") || url.includes("a.aliexpress.com")) {
            try {
                const response = await axios.get(url, {
                    maxRedirects: 5,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    },
                    timeout: 8000
                });
                finalUrl = response.request.res.responseUrl || url;
            } catch (e) {
                // إذا فشل الطلب المباشر، نحاول استخراج الـ ID من الرابط نفسه كحل أخير
                console.log("Redirect failed, checking URL directly...");
            }
        }

        // قائمة الأنماط للبحث عن الرقم (ID)
        const patterns = [
            /item\/(\d+)\.html/,
            /(\d+)\.html/,
            /id=(\d+)/,
            /item\/(\d+)/,
            /\/(\d+)\?/
        ];

        for (const pattern of patterns) {
            const match = finalUrl.match(pattern);
            if (match && match[1]) return match[1];
        }

        return null;
    } catch (error) {
        return null;
    }
}

bot.start((ctx) => ctx.reply("✨ أهلاً بك! أرسل لي رابط المنتج وسأجهز لك روابط الخصم فوراً."));

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    
    if (text.includes("aliexpress.com")) {
        const statusMsg = await ctx.reply("🔍 جاري فحص الرابط وفك التشفير...");

        const productId = await getAliExpressId(text);

        if (!productId) {
            return ctx.telegram.editMessageText(
                ctx.chat.id, 
                statusMsg.message_id, 
                undefined, 
                "❌ عذراً، لم أتمكن من استخراج بيانات المنتج. \n💡 نصيحة: جرب نسخ الرابط من المتصفح مباشرة بدلاً من زر المشاركة."
            );
        }

        // إنشاء الروابط الذكية
        const mainLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&trackingId=${ALI_TRACKING_ID}`;
        const superDeals = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=super&trackingId=${ALI_TRACKING_ID}`;
        const choiceLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=choice&trackingId=${ALI_TRACKING_ID}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url("🛒 شراء الآن (خصم مباشر)", mainLink)],
            [Markup.button.url("🔥 عروض السوبر ديلز", superDeals)],
            [Markup.button.url("✨ عروض Choice المميزة", choiceLink)]
        ]);

        const message = `✅ <b>تم استخراج العروض بنجاح!</b>\n\n📦 <b>ID المنتج:</b> <code>${productId}</code>\n\n💰 استعمل الروابط أدناه للحصول على أفضل سعر متاح حالياً:`;

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, message, {
            parse_mode: "HTML",
            ...keyboard
        });
    }
});

// لضمان بقاء البوت حياً على Render
app.get("/", (req, res) => res.send("Bot is Live 🚀"));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.launch();
});
