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
    console.log('در حال بررسی کمپین‌های سررسید شده...');
    const now = new Date();

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

        if (dueCampaigns.length === 0) return;

        console.log(`تعداد ${dueCampaigns.length} کمپین برای ارسال پیدا شد.`);

        for (const campaign of dueCampaigns) {
            try {
                // ارسال پیام
                const telegramApiUrl = `https://api.telegram.org/bot${campaign.bot.token}/sendMessage`;
                await axios.post(telegramApiUrl, {
                    chat_id: campaign.chatId, // اصلاح شد
                    text: campaign.post.content || "بدون متن",
                });

                // محاسبه زمان اجرای بعدی (nextRun)
                let nextRunDate = new Date();
                if (campaign.scheduleType === 'INTERVAL' && campaign.intervalHours) {
                    nextRunDate = new Date(now.getTime() + (campaign.intervalHours * 60 * 60 * 1000));
                } else if (campaign.scheduleType === 'SPECIFIC_TIMES' && campaign.specificTimes?.length > 0) {
                    nextRunDate = calculateNextRunForSpecificTimes(campaign.specificTimes);
                } else {
                    // در صورت دیتای نامعتبر، کمپین متوقف شود تا از لوپ بی‌نهایت جلوگیری شود
                    await prisma.campaign.update({
                        where: { id: campaign.id },
                        data: { isActive: false }
                    });
                    continue;
                }
                
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
                console.error(`❌ خطا در ارسال کمپین ${campaign.id}:`, error.message);
                
                // ثبت خطا در تاریخچه (اصلاح شد به errorLog)
                await prisma.postHistory.create({
                    data: {
                        campaignId: campaign.id,
                        status: 'FAILED',
                        errorLog: error.message,
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
