import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// تابع کمکی برای محاسبه زمان بعدی برای ساعات خاص (SPECIFIC_TIMES)
function calculateNextRunForSpecificTimes(times: string[]): Date {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

    const sortedTimes = [...times].sort();
    let nextTime = sortedTimes.find(t => t > currentTimeStr);
    const nextRunDate = new Date(now);

    if (nextTime) {
        const [h, m] = nextTime.split(":");
        nextRunDate.setHours(parseInt(h), parseInt(m), 0, 0);
    } else {
        nextTime = sortedTimes[0];
        const [h, m] = nextTime.split(":");
        nextRunDate.setDate(nextRunDate.getDate() + 1);
        nextRunDate.setHours(parseInt(h), parseInt(m), 0, 0);
    }
    return nextRunDate;
}

// اجرا در هر ۱ دقیقه
cron.schedule('* * * * *', async () => {
    const now = new Date();
    // لاگر برای بررسی منطقه زمانی سرور و مقایسه آن با دیتابیس
    console.log('----------------------------------------');
    console.log(`[DEBUG] زمان اجرای کرون (Local): ${now.toString()}`);
    console.log(`[DEBUG] زمان ارسال به دیتابیس (UTC): ${now.toISOString()}`);
    console.log('در حال بررسی کمپین‌های سررسید شده...');

    try {
        const dueCampaigns = await prisma.campaign.findMany({
            where: {
                isActive: true,
                nextRun: { lte: now }
            },
            include: {
                post: true,
                bot: true, 
            }
        });

        if (dueCampaigns.length === 0) {
            console.log('[INFO] هیچ کمپینی برای ارسال در این لحظه یافت نشد.');
            return;
        }

        console.log(`[SUCCESS] تعداد ${dueCampaigns.length} کمپین برای ارسال پیدا شد.`);

        for (const campaign of dueCampaigns) {
            console.log(`[DEBUG] در حال پردازش کمپین ID: ${campaign.id} | زمان تعیین شده در دیتابیس: ${campaign.nextRun.toISOString()}`);
            try {
                // ارسال پیام
                const telegramApiUrl = `https://api.telegram.org/bot${campaign.bot.token}/sendMessage`;
                await axios.post(telegramApiUrl, {
                    chat_id: campaign.chatId,
                    text: campaign.post.content || "بدون متن",
                });

                // محاسبه زمان اجرای بعدی (nextRun)
                let nextRunDate = new Date();
                if (campaign.scheduleType === 'INTERVAL' && campaign.intervalHours) {
                    nextRunDate = new Date(now.getTime() + (campaign.intervalHours * 60 * 60 * 1000));
                } else if (campaign.scheduleType === 'SPECIFIC_TIMES' && campaign.specificTimes?.length > 0) {
                    nextRunDate = calculateNextRunForSpecificTimes(campaign.specificTimes);
                } else {
                    console.log(`[WARN] دیتای زمان‌بندی نامعتبر برای کمپین ${campaign.id}، غیرفعال شد.`);
                    await prisma.campaign.update({
                        where: { id: campaign.id },
                        data: { isActive: false }
                    });
                    continue;
                }
                
                console.log(`[DEBUG] زمان اجرای بعدی برای کمپین ${campaign.id} تنظیم شد روی: ${nextRunDate.toISOString()}`);

                await prisma.campaign.update({
                    where: { id: campaign.id },
                    data: { nextRun: nextRunDate }
                });

                // ثبت تاریخچه
                await prisma.postHistory.create({
                    data: {
                        campaignId: campaign.id,
                        status: 'SUCCESS',
                        sentAt: new Date()
                    }
                });

                console.log(`✅ پیام برای کمپین ${campaign.id} با موفقیت ارسال شد.`);
            } catch (error: any) {
                console.error(`❌ خطا در ارسال کمپین ${campaign.id}:`, error.response?.data || error.message);
                
                // ثبت خطا در تاریخچه
                await prisma.postHistory.create({
                    data: {
                        campaignId: campaign.id,
                        status: 'FAILED',
                        errorLog: error.response?.data ? JSON.stringify(error.response.data) : error.message,
                        sentAt: new Date()
                    }
                });
            }
        }
    } catch (error) {
        console.error('❌ خطای کلی در سیستم کرون‌جاب دیتابیس:', error);
    }
});

console.log('🤖 سرویس کرون‌جاب با موفقیت استارت شد...');
