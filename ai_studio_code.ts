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

function generateSignature(params: any, secret: string) {
  const sortedKeys = Object.keys(params).sort();
  let basestring = secret;
  for (const key of sortedKeys) {
    if (params[key] !== undefined && params[key] !== null) {
      basestring += key + params[key];
    }
  }
  basestring += secret;
  return crypto.createHash("md5").update(basestring, "utf8").digest("hex").toUpperCase();
}

async function extractProductId(url: string): Promise<string | null> {
  const urlMatch = url.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return null;
  let currentUrl = urlMatch[0];
  try {
    if (currentUrl.includes("a.aliexpress.com")) {
      const res = await axios.get(currentUrl, { maxRedirects: 10, headers: { 'User-Agent': 'Mozilla/5.0' } });
      currentUrl = res.request?.res?.responseUrl || currentUrl;
    }
  } catch (e) {}
  const patterns = [/item\/(\d+)\.html/, /(\d+)\.html/, /item\/(\d+)/, /id=(\d+)/];
  for (const p of patterns) {
    const m = currentUrl.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

bot.start((ctx) => ctx.reply("👋 أهلاً بك في بوت AliExpress! أرسل لي رابط أي منتج."));

bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  if (text.includes("aliexpress.com")) {
    const waitMsg = await ctx.reply("🔍 جاري التحليل...");
    const productId = await extractProductId(text);
    if (!productId) return ctx.reply("❌ لم أتمكن من استخراج معرف المنتج.");

    const affLink = `https://s.click.aliexpress.com/e/_DdG7pXp?productId=${productId}`;
    const message = `💎 <b>عرض جديد من AliExpress</b>\n\n✨ استخدم الرابط أدناه للحصول على الخصم:`;
    const keyboard = Markup.inlineKeyboard([[Markup.button.url("🛒 شراء الآن", affLink)]]);

    await ctx.reply(message, { parse_mode: "HTML", ...keyboard });
  }
});

app.get("/", (req, res) => res.send("Bot is Running!"));
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  bot.launch();
});
