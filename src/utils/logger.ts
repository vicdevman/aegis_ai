import { createLogger, format, transports } from "winston";
import { existsSync, mkdirSync } from "fs";

if (!existsSync("logs")) mkdirSync("logs");

export const logger = createLogger({
  level: process.env["NODE_ENV"] === "production" ? "info" : "debug",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.colorize(),
    format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`)
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "logs/error.log", level: "error" }),
    new transports.File({ filename: "logs/aegis.log" }),
  ],
});
