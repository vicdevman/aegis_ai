import type { Server as IOServer } from "socket.io";
import type { AegisEventType } from "../../types/index.js";
import { logger } from "../../utils/logger.js";

let io: IOServer | null = null;

export function initEvents(socketServer: IOServer): void {
  io = socketServer;
  logger.info("[Events] Socket.io initialized");
}

export function emit(type: AegisEventType, payload: unknown): void {
  logger.debug(`[Event] ${type}`);
  if (io) io.emit("aegis_event", { type, payload, timestamp: Date.now() });
}
