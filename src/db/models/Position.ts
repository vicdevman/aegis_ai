import mongoose, { Schema } from "mongoose";
import { config } from "../../config/env.js";
import { ModelSimulator } from "../simulator.js";
import type { Position } from "../../types/index.js";

const PositionSchema = new Schema({
  id:                { type: String, required: true, unique: true, index: true },
  pair:              { type: String, required: true },
  direction:         { type: String, enum: ["buy", "sell"], required: true },
  entryPrice:        { type: Number, required: true },
  currentPrice:      { type: Number },
  volume:            { type: Number, required: true },
  positionSizeUSD:   { type: Number, required: true },
  stopLoss:          { type: Number, required: true },
  takeProfit:        { type: Number, required: true },
  breakEvenTrigger:  { type: Number },
  stopLossAdjusted:  { type: Boolean, default: false },
  status:            { type: String, enum: ["open", "closed", "cancelled"], default: "open" },
  strategy:          { type: String, required: true },
  orderId:           { type: String },
  openedAt:          { type: Date, default: Date.now },
  closedAt:          { type: Date },
  closeReason:       { type: String },
  pnl:               { type: Number },
  pnlPct:            { type: Number },
}, { timestamps: true });

export const PositionModel = config.devMode 
  ? new ModelSimulator<Position>("Position") 
  : mongoose.model("Position", PositionSchema);
