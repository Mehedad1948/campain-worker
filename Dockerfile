# استفاده از نسخه سبک نود
FROM node:18-alpine

# تنظیم پوشه کاری
WORKDIR /app

# کپی کردن فایل‌های وابستگی
COPY package*.json ./
COPY prisma ./prisma/

# نصب وابستگی‌ها و تولید کلاینت پریزما
RUN npm install
RUN npx prisma generate

# کپی کردن کل سورس کد
COPY . .

# اجرای فایل اصلی ورکر از طریق اسکریپت start در package.json
CMD ["npm", "start"]
