import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// اجرا در هر ۱ دقیقه
cron.schedule('* * * * *', async () => {
    console.log('در حال بررسی کمپین‌های سررسید شده...');
    const now = new Date();

    try {
        // ۱. پیدا کردن کمپین‌هایی که فعالند و زمان ارسالشان رسیده است
        const dueCampaigns = await prisma.campaign.findMany({
            where: {
                isActive: true,
                nextRun: {
                    lte: now, // nextRun <= now
                }
            },
            include: {
                post: true,
                bot: true, // برای گرفتن توکن ربات
                connectedChat: true, // برای گرفتن آیدی گروه/کانال مقصد
            }
        });

        if (dueCampaigns.length === 0) return;

        console.log(`تعداد ${dueCampaigns.length} کمپین برای ارسال پیدا شد.`);

        // ۲. ارسال پیام‌ها
        for (const campaign of dueCampaigns) {
            try {
                // آدرس API تلگرام
                const telegramApiUrl = `https://api.telegram.org/bot${campaign.bot.token}/sendMessage`;

                // ارسال پیام (بسته به نوع پست می‌توانید sendPhoto و... هم اضافه کنید)
                await axios.post(telegramApiUrl, {
                    chat_id: campaign.connectedChat.chatId,
                    text: campaign.post.content, // محتوای متنی پست
                });

                // ۳. آپدیت زمان بعدی ارسال (nextRun)
                const nextRunDate = new Date(now.getTime() + campaign.intervalHours * 60 * 60 * 1000);
                
                await prisma.campaign.update({
                    where: { id: campaign.id },
                    data: { nextRun: nextRunDate }
                });

                // ۴. ثبت در تاریخچه
                await prisma.postHistory.create({
                    data: {
                        campaignId: campaign.id,
                        status: 'SUCCESS',
                        sentAt: new Date()
                    }
                });

                console.log(`✅ پیام برای کمپین ${campaign.id} با موفقیت ارسال شد.`);
            } catch (error) {
                console.error(`❌ خطا در ارسال کمپین ${campaign.id}:`, error.message);
                
                // ثبت خطای ارسال در تاریخچه
                await prisma.postHistory.create({
                    data: {
                        campaignId: campaign.id,
                        status: 'FAILED',
                        errorMessage: error.message,
                        sentAt: new Date()
                    }
                });
            }
        }
    } catch (error) {
        console.error('خطای کلی در سیستم کرون‌جاب:', error);
    }
});

console.log('🤖 سرویس کرون‌جاب با موفقیت استارت شد...');
