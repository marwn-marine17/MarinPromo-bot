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

// AliExpress API & Bot Settings
const ALI_APP_KEY = process.env.ALIEXPRESS_APP_KEY || "505894";
const ALI_APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || "SL3rj1SCYMOaXUsM6Pf7oV6HgdYymwPQ";
const ALI_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || "MarinePromo";
const GATEWAY_URL = "https://api-sg.aliexpress.com/sync";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN missing!");

const bot = new Telegraf(botToken);
const genAI = new GoogleGenerativeAI(GEMINI_KEY || "");
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * وظيفة استخراج ID المنتج والتعامل مع التحويلات
 */
async function getProductId(url: string): Promise<string | null> {
    try {
        let finalUrl = url;
        if (url.includes("a.aliexpress.com") || url.includes("/e/")) {
            const res = await axios.get(url, {
                maxRedirects: 10,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            finalUrl = res.request.res.responseUrl || url;
        }
        const match = finalUrl.match(/item\/(\d+)\.html/) || finalUrl.match(/id=(\d+)/) || finalUrl.match(/(\d{10,20})/);
        return match ? match[1] : null;
    } catch (e) { return null; }
}

/**
 * الكشط العميق لاستخراج الأسعار، العنوان، والصورة
 */
async function fetchDeepProductInfo(url: string) {
    try {
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
                'Cookie': 'aep_usuc_f=site=glo&c_tp=USD&region=US&b_locale=ar_MA;',
            },
            timeout: 12000
        });

        const $ = cheerio.load(res.data);
        const title = ($('meta[property="og:title"]').attr('content') || "منتج AliExpress").replace("- AliExpress", "").trim();
        const image = $('meta[property="og:image"]').attr('content') || "";
        
        let discountPrice = "", superPrice = "", choicePrice = "";

        $("script").each((_, script) => {
            const content = $(script).html() || "";
            if (content.includes("price") || content.includes("Amount")) {
                const clean = (p: string) => p.replace(/[\\"]/g, '').replace('US $', '$').trim();
                const mDiscount = content.match(/["'](?:target_sale_price|sale_price|formatedPrice|formattedAmount|actMinPriceText|actMinPrice|salePriceText)["']\s*:\s*["']?([^"',}]+)["']?/);
                const mSuper = content.match(/["'](?:superDealPrice|super_deal_price|promotionPrice|minPriceText|superPriceText)["']\s*:\s*["']?([^"',}]+)["']?/);
                const mChoice = content.match(/["'](?:choicePrice|choice_formatted_price|targetCurrencyPrice|choicePriceText)["']\s*:\s*["']?([^"',}]+)["']?/);

                if (mDiscount && mDiscount[1] && !discountPrice) discountPrice = clean(mDiscount[1]);
                if (mSuper && mSuper[1] && !superPrice) superPrice = clean(mSuper[1]);
                if (mChoice && mChoice[1] && !choicePrice) choicePrice = clean(mChoice[1]);
            }
        });

        return { title, image, discountPrice, superPrice, choicePrice };
    } catch (e) { return null; }
}

bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.includes("aliexpress.com") || text.includes("s.click")) {
        const waitMsg = await ctx.reply("🔍 جاري جلب أقوى العروض وتحليلها...");

        const productId = await getProductId(text);
        if (!productId) return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, "❌ فشل استخراج معرف المنتج.");

        const info = await fetchDeepProductInfo(text);
        
        // توليد نصيحة AI باستخدام العنوان المستخرج
        let aiAdvice = "💎 اجري تخفيض ممتاز";
        if (GEMINI_KEY && info?.title) {
            try {
                const result = await aiModel.generateContent(`أعطني نصيحة تسوق مغرية وقصيرة جداً عن: ${info.title}`);
                aiAdvice = result.response.text().trim();
            } catch (e) {}
        }

        const mainLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&trackingId=${ALI_TRACKING_ID}`;
        const superLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=super&trackingId=${ALI_TRACKING_ID}`;
        const choiceLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}&promotion=choice&trackingId=${ALI_TRACKING_ID}`;

        let message = `<b>${aiAdvice}</b>\n\n`;
        message += `📦 <b>${info?.title || "منتج AliExpress"}</b>\n\n`;
        if (info?.discountPrice) message += `💵 <b>سعر التخفيض:</b> ${info.discountPrice}\n`;
        if (info?.superPrice) message += `💡 <b>سعر السوبر ديلز:</b> ${info.superPrice}\n`;
        if (info?.choicePrice) message += `🛍️ <b>سعر عرض تشويس:</b> ${info.choicePrice}\n`;
        message += `\n✨ <i>استخدم الروابط أدناه للخصم المباشر:</i>`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url("🛒 شراء الآن (الخصم الرئيسي)", mainLink)],
            [Markup.button.url("🔥 عروض السوبر ديلز", superLink)],
            [Markup.button.url("✨ عروض Choice المميزة", choiceLink)]
        ]);

        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
            if (info?.image) {
                await ctx.replyWithPhoto(info.image, { caption: message, parse_mode: "HTML", ...keyboard });
            } else {
                await ctx.reply(message, { parse_mode: "HTML", ...keyboard });
            }
        } catch (err) {
            await ctx.reply(message, { parse_mode: "HTML", ...keyboard });
        }
    }
});

app.get("/", (req, res) => res.send("Bot is Alive with Deep Scraping! 🚀"));
app.listen(PORT, () => { bot.launch(); });
