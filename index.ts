import express from "express";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { Telegraf, Markup } from "telegraf";
import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from "crypto";

// --- الإعدادات والمتغيرات ---
const ALI_APP_KEY = process.env.ALIEXPRESS_APP_KEY || "505894";
const ALI_APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || "SL3rj1SCYM0aXUsM6Pf7oV5HgdYymwPQ";
const ALI_TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || "MarinePromo";
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// تهيئة الذكاء الاصطناعي
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * توليد التوقيع الرقمي لـ AliExpress API
 */
function generateSignature(params: any, secret: string): string {
  const sortedKeys = Object.keys(params).sort();
  let basestring = secret;
  for (const key of sortedKeys) {
    basestring += key + params[key];
  }
  basestring += secret;
  return crypto.createHash('md5').update(basestring, 'utf8').digest('hex').toUpperCase();
}

/**
 * استخراج رقم المنتج (Product ID) بذكاء - 3 مستويات
 */
async function extractProductId(url: string): Promise<string | null> {
  const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
  
  try {
    // المحاولة 1: تتبع الرابط مباشرة للحصول على الرابط النهائي
    const res = await axios.get(url, {
      maxRedirects: 15,
      headers: { 'User-Agent': mobileUA },
      timeout: 10000
    });
    
    let finalUrl = res.request?.res?.responseUrl || url;
    
    // المحاولة 2: البحث عن أنماط معرف المنتج في الرابط النهائي
    const patterns = [
      /item\/(\d+)\.html/,
      /id=(\d+)/,
      /\/(\d{11,15})/
    ];
    
    for (const p of patterns) {
      const match = finalUrl.match(p);
      if (match) return match[1];
    }

    // المحاولة 3: البحث داخل محتوى الصفحة (HTML)
    const htmlContent = res.data.toString();
    const idInHtml = htmlContent.match(/productId["']?\s*:\s*["']?(\d+)["']?/) || 
                     htmlContent.match(/item\/(\d+)\.html/);
    if (idInHtml) return idInHtml[1];

    // حل أخير: البحث عن أرقام طويلة في الروابط
    const emergencyMatch = finalUrl.match(/(\d{11,15})/) || url.match(/(\d{11,15})/);
    return emergencyMatch ? emergencyMatch[1] : null;

  } catch (e) {
    const emergencyMatch = url.match(/(\d{11,15})/);
    return emergencyMatch ? emergencyMatch[1] : null;
  }
}

/**
 * جلب معلومات المنتج (العنوان والصورة والأسعار)
 */
async function fetchProductInfoScraping(url: string) {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 10000
    });
    const $ = cheerio.load(res.data);
    const title = $('meta[property="og:title"]').attr('content')?.split('|')[0].trim() || "منتج رائع";
    const image = $('meta[property="og:image"]').attr('content') || "";
    
    // محاولة استخراج الأسعار (تجريبي)
    const discountPrice = $(".uniform-banner-box-price").text() || $(".product-price-value").first().text();
    const superPrice = $(".super-deals-price").text();
    const choicePrice = $(".choice-price").text();

    return { title, image, discountPrice, superPrice, choicePrice };
  } catch (e) {
    return null;
  }
}

/**
 * توليد روابط الأفلييت الرسمية
 */
async function getAffLink(originalUrl: string, productId: string, type: 'normal' | 'super' | 'choice' = 'normal') {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;

  const params: any = {
    method: "aliexpress.affiliate.link.generate",
    app_key: ALI_APP_KEY,
    timestamp: timestamp,
    format: "json",
    v: "2.0",
    sign_method: "md5",
    promotion_link_type: "0",
    source_values: originalUrl, 
    tracking_id: ALI_TRACKING_ID
  };

  params.sign = generateSignature(params, ALI_APP_SECRET);

  try {
    const res = await axios.get("https://api.aliexpress.com/sync", { params });
    const apiLink = res.data.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link?.[0]?.promotion_link;
    if (apiLink) return apiLink;
  } catch (e) {
    console.error("AliExpress API Error:", e);
  }

  // رابط احتياطي عالي الموثوقية في حال فشل الـ API
  let targetUrl = `https://www.aliexpress.com/item/${productId}.html`;
  if (type === 'super') targetUrl += "?sourceType=620";
  if (type === 'choice') targetUrl += "?sourceType=562";
  
  const encodedTarget = encodeURIComponent(targetUrl);
  return `https://s.click.aliexpress.com/e/_DdWlXvF?target=${encodedTarget}&trackingId=${ALI_TRACKING_ID}`;
}

// --- إعداد وإطلاق البوت ---
if (botToken && botToken !== "YOUR_BOT_TOKEN_HERE" && botToken !== "") {
  const bot = new Telegraf(botToken);

  bot.start((ctx) => {
    ctx.reply("👋 أهلاً بك في بوت MarinePromo!\n\nأرسل لي أي رابط منتج من AliExpress وسأقوم بتحويله لرابط خصم مباشر فوراً.");
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.includes("aliexpress.com")) {
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      if (!urlMatch) return;
      const originalUrl = urlMatch[0];
      
      const waitMsg = await ctx.reply("🔎 جاري استخراج أفضل سعر وتحويل الرابط...");
      
      try {
        const productId = await extractProductId(originalUrl);
        if (!productId) {
          return ctx.reply("⚠️ لم أتمكن من استخراج رقم المنتج من هذا الرابط. يرجى إرسال رابط منتج مباشر.");
        }

        const productInfo = await fetchProductInfoScraping(originalUrl);
        
        // توليد جملة تسويقية باستخدام Gemini
        let aiAdvice = "💎 اجري تخفيض ممتاز";
        if (productInfo?.title) {
          try {
            const prompt = `بصفتك خبير تسويق، أعطني جملة تسويقية مغرية، قصيرة جداً، وباللغة العربية عن هذا المنتج: ${productInfo.title}. ابدأ برمز تعبيري (emoji). لا تزد عن 12 كلمة.`;
            const result = await model.generateContent(prompt);
            const responseText = result.response.text().trim();
            if (responseText && responseText.length > 5) {
              aiAdvice = responseText;
            }
          } catch (e) {}
        }

        // توليد الروابط الـ 3
        const [normalLink, superLink, choiceLink] = await Promise.all([
          getAffLink(originalUrl, productId, 'normal'),
          getAffLink(originalUrl, productId, 'super'),
          getAffLink(originalUrl, productId, 'choice')
        ]);

        let message = `<b>${aiAdvice}</b> \n\n`;
        if (productInfo) {
           message += `📦 <b>${productInfo.title}</b>\n\n`;
        }
        message += `✨ <b>استخدم الروابط أدناه للحصول على الخصم المباشر:</b>`;

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.url("🛒 شراء الآن (الخصم الرئيسي)", normalLink)],
          [Markup.button.url("🔥 عروض السوبر ديلز", superLink)],
          [Markup.button.url("✨ عروض تشويس Choice", choiceLink)]
        ]);

        if (productInfo?.image) {
          try {
            await ctx.replyWithPhoto(productInfo.image, { 
              caption: message, 
              parse_mode: "HTML", 
              ...keyboard 
            });
          } catch (e) {
            await ctx.reply(message, { parse_mode: "HTML", ...keyboard });
          }
        } else {
          await ctx.reply(message, { parse_mode: "HTML", ...keyboard });
        }
        
      } catch (error) {
        console.error("Bot Processor error:", error);
        await ctx.reply("⚠️ نعتذر! فشل تحويل هذا الرابط حالياً.");
      } finally {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
        } catch (e) {}
      }
    }
  });

  // حل مشكلة Conflict 409
  bot.telegram.deleteWebhook({ drop_pending_updates: true })
    .then(() => {
      console.log("Old webhook cleared. Starting bot...");
      return bot.launch();
    })
    .catch(err => console.error("Bot Launch Error:", err));
}

// --- إعداد الخادم ---
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
