import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

async function callTelegramAPI(
  method: string,
  data: Record<string, any>,
  token: string
) {
  const response = await axios.post(
    `https://api.telegram.org/bot${token}/${method}`,
    data
  );

  return response.data;
}

function calculateNextRunForSpecificTimes(times: string[]): Date {
  const now = new Date();

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const currentTimeStr = `${String(currentHour).padStart(2, "0")}:${String(
    currentMinute
  ).padStart(2, "0")}`;

  const sortedTimes = [...times].sort();

  let nextTime = sortedTimes.find((t) => t > currentTimeStr);

  const nextRunDate = new Date(now);

  if (nextTime) {
    const [hours, minutes] = nextTime.split(":");

    nextRunDate.setHours(
      Number(hours),
      Number(minutes),
      0,
      0
    );
  } else {
    nextTime = sortedTimes[0];

    const [hours, minutes] = nextTime.split(":");

    nextRunDate.setDate(nextRunDate.getDate() + 1);

    nextRunDate.setHours(
      Number(hours),
      Number(minutes),
      0,
      0
    );
  }

  return nextRunDate;
}

function calculateNextRun(campaign: {
  scheduleType: string;
  intervalHours: number | null;
  specificTimes: string[];
}) {
  const now = new Date();

  if (
    campaign.scheduleType === "INTERVAL" &&
    campaign.intervalHours
  ) {
    return new Date(
      now.getTime() +
        campaign.intervalHours * 60 * 60 * 1000
    );
  }

  if (
    campaign.scheduleType === "SPECIFIC_TIMES" &&
    campaign.specificTimes.length > 0
  ) {
    return calculateNextRunForSpecificTimes(
      campaign.specificTimes
    );
  }

  return null;
}

cron.schedule("* * * * *", async () => {
  const now = new Date();

  console.log("========================================");
  console.log(`[CRON] Local Time: ${now.toString()}`);
  console.log(`[CRON] UTC Time:   ${now.toISOString()}`);
  console.log("[CRON] Checking campaigns...");

  try {
    const dueCampaigns = await prisma.campaign.findMany({
      where: {
        isActive: true,
        nextRun: {
          lte: now,
        },
      },
      include: {
        bot: true,
        post: true,
      },
    });

    if (!dueCampaigns.length) {
      console.log("[INFO] No campaigns due.");
      return;
    }

    console.log(
      `[INFO] Found ${dueCampaigns.length} campaign(s) to process.`
    );

    for (const campaign of dueCampaigns) {
      console.log(
        `[PROCESSING] Campaign ${campaign.id}`
      );

      try {
        let telegramResult: any;

        // Preferred flow: copy original Telegram message
        if (
          campaign.post.sourceChatId &&
          campaign.post.sourceMessageId
        ) {
          telegramResult = await callTelegramAPI(
            "copyMessage",
            {
              chat_id: campaign.chatId,
              from_chat_id:
                campaign.post.sourceChatId,
              message_id:
                campaign.post.sourceMessageId,
            },
            campaign.bot.token
          );

          console.log(
            `[SUCCESS] Message copied for campaign ${campaign.id}`
          );
        } else {
          // Backward compatibility for older posts
          telegramResult = await callTelegramAPI(
            "sendMessage",
            {
              chat_id: campaign.chatId,
              text:
                campaign.post.content ||
                "No content",
            },
            campaign.bot.token
          );

          console.log(
            `[SUCCESS] Text message sent for campaign ${campaign.id}`
          );
        }

        const nextRun = calculateNextRun(campaign);

        if (!nextRun) {
          console.warn(
            `[WARN] Invalid schedule configuration for campaign ${campaign.id}. Disabling campaign.`
          );

          await prisma.campaign.update({
            where: {
              id: campaign.id,
            },
            data: {
              isActive: false,
            },
          });

          continue;
        }

        await prisma.campaign.update({
          where: {
            id: campaign.id,
          },
          data: {
            nextRun,
          },
        });

        await prisma.postHistory.create({
          data: {
            campaignId: campaign.id,
            status: "SUCCESS",
            sentAt: new Date(),
            errorLog: null,
          },
        });

        console.log(
          `[UPDATED] Campaign ${campaign.id} nextRun => ${nextRun.toISOString()}`
        );

        console.log(
          `[DONE] Campaign ${campaign.id} completed.`
        );
      } catch (error: any) {
        const errorMessage =
          error?.response?.data
            ? JSON.stringify(error.response.data)
            : error?.message ||
              "Unknown error";

        console.error(
          `[FAILED] Campaign ${campaign.id}`
        );
        console.error(errorMessage);

        try {
          await prisma.postHistory.create({
            data: {
              campaignId: campaign.id,
              status: "FAILED",
              errorLog: errorMessage,
              sentAt: new Date(),
            },
          });
        } catch (historyError) {
          console.error(
            "[ERROR] Failed to save post history:",
            historyError
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "[CRITICAL] Worker execution failed:",
      error
    );
  }
});

console.log(
  "🤖 Telegram campaign worker started successfully."
);