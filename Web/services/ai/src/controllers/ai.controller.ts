import type { NextFunction, Request, Response } from 'express';
import { pathParam } from '@a-health/http';
import * as conversations from '../services/conversation.service.js';
import * as clinical from '../services/clinical.service.js';
import { resolveChatAdapter, resolveTranscribeAdapter } from '../services/provider-resolver.js';
import {
  createConversationSchema, drugInteractionSchema, sendMessageSchema,
  synthesizeSchema, transcribeSchema, triageSchema,
} from '../types/ai.types.js';

const caller = (req: Request) => ({
  sub: req.auth!.sub, role: req.auth!.role, ppid: req.auth!.ppid, cpid: req.auth!.cpid,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(status).json(await fn(req, res)); } catch (err) { next(err); }
  };

export const createConversation = handle(
  (req) => conversations.createConversation(caller(req), createConversationSchema.parse(req.body)), 201,
);

export const getConversation = handle((req) =>
  conversations.getConversation(pathParam(req, 'conversation_id'), caller(req)));

export const sendMessage = handle(
  (req) => conversations.sendMessage(
    pathParam(req, 'conversation_id'), caller(req), sendMessageSchema.parse(req.body), resolveChatAdapter(),
  ),
  201,
);

export const triage = handle((req) => clinical.suggestTriage(triageSchema.parse(req.body)));

export const drugInteractions = handle((req) => {
  const input = drugInteractionSchema.parse(req.body);
  return clinical.checkDrugInteractions(input.medications);
});

export const transcribe = handle((req) => {
  const input = transcribeSchema.parse(req.body);
  return clinical.transcribeAudio(input.audio_key, input.language ?? 'sw', resolveTranscribeAdapter());
});

export const synthesize = handle((req) => {
  const input = synthesizeSchema.parse(req.body);
  return clinical.synthesizeSpeech(input.text, input.language ?? 'sw');
});

export const listModels = handle(() => clinical.listModels());
