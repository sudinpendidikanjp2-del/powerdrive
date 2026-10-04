import { database, describeDatabaseUrl } from "../server/config/env.ts";
import { execSync } from "child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

async function initDatabase() {
  console.log("--------------------------------------------------");
  console.log("🚀 Starting Database Initialization Script...");
  console.log("--------------------------------------------------");
  console.log(`🗄️  Database: ${describeDatabaseUrl(database.url)}${database.isFallback ? " (local default)" : ""}\n`);

  try {
    // 1. Run Prisma Generate to ensure client types are built
    console.log("📦 Generating Prisma Client...");
    execSync("npx prisma generate", { stdio: "inherit" });
    console.log("✅ Prisma Client generated successfully.\n");

    // 2. Run Prisma DB Push to push the schema to PostgreSQL
    console.log("⚙️ Pushing schema migrations/tables to database...");
    execSync("npx prisma db push --accept-data-loss", { stdio: "inherit" });
    console.log("✅ Database tables created/synchronized successfully.\n");

    // 3. Initialize Prisma Client to seed the database
    const prisma = new PrismaClient();

    const adminEmail = (process.env.ADMIN_EMAIL || "admin@clouddrive.local").trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || "AdminPassword2026!";

    console.log(`👤 Seeding default Administrator Account: ${adminEmail}`);

    // Check if user already exists
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!existingAdmin) {
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(adminPassword, salt);

      await prisma.user.create({
        data: {
          email: adminEmail,
          name: "Administrator",
          passwordHash,
          role: "ADMIN",
          isActive: true,
        },
      });
      console.log("🎉 Default Administrator Account created successfully!");
    } else {
      console.log("ℹ️ Administrator Account already exists. Skipping user creation.");
    }

    // 4. Seed basic default System Settings if any
    console.log("\n⚙️ Seeding default system settings...");
    const defaultSettings = [
      {
        key: "MAX_FILE_SIZE_MB",
        value: process.env.MAX_FILE_SIZE_MB || "200",
        description: "Maximum uploaded file size in MB",
      },
      {
        key: "SMTP_FROM_EMAIL",
        value: process.env.SMTP_FROM_EMAIL || "no-reply@clouddrive.local",
        description: "SMTP Sender From Email Address",
      },
      {
        key: "SMTP_FROM_NAME",
        value: process.env.SMTP_FROM_NAME || "Power Drive Cloud",
        description: "SMTP Sender From Name display",
      },
    ];

    for (const setting of defaultSettings) {
      const existing = await prisma.systemSetting.findUnique({
        where: { key: setting.key },
      });

      if (!existing) {
        await prisma.systemSetting.create({
          data: {
            key: setting.key,
            value: setting.value,
            description: setting.description,
          },
        });
        console.log(`   └─ Setting '${setting.key}' seeded.`);
      }
    }

    console.log("✅ System settings checked and seeded successfully.");
    console.log("\n--------------------------------------------------");
    console.log("⭐ Database has been initialized perfectly!");
    console.log("--------------------------------------------------");

    await prisma.$disconnect();
  } catch (error: any) {
    console.error("\n❌ Database initialization failed!");
    console.error(error.message || error);
    process.exit(1);
  }
}

initDatabase();
