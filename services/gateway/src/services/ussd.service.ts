import { prisma } from '@a-health/database';
import { env } from '../config/env.js';
import { mintTokenForPhone } from './internalAuth.js';
import { callInternal, type InternalCallResult } from './internalClient.js';

export interface UssdResult {
  response: string;
  terminate: boolean;
}

type UssdDependencies = {
  mintTokenForPhone: typeof mintTokenForPhone;
  callInternal: (
    baseUrl: string,
    path: string,
    method: 'GET' | 'POST',
    token: string,
    body?: unknown,
  ) => Promise<InternalCallResult>;
};

const MAIN_MENU =
  'A-Health\n1. Get medical help now\n2. Check my queue status\n0. Exit';

const NOT_REGISTERED =
  'This number is not registered. Download the A-Health app or visit a facility to register, then try again.';

/**
 * One interaction, one turn. The aggregator resends the FULL accumulated
 * input on every key press (its convention, not ours) — this only reads the
 * newest segment, since the session row already remembers where the caller
 * is in the tree.
 */
function lastSegment(text: string): string {
  const parts = text.split('*').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export async function handleUssdSession(
  sessionId: string, phoneNumber: string, text: string,
  dependencies: Partial<UssdDependencies> = {},
): Promise<UssdResult> {
  const mintToken = dependencies.mintTokenForPhone ?? mintTokenForPhone;
  const call = dependencies.callInternal ?? callInternal;
  const now = new Date();
  let session = await prisma.ussdSession.findUnique({ where: { sessionId } });

  if (session && session.phoneNumber !== phoneNumber) {
    return { response: 'Session caller mismatch. Start a new session.', terminate: true };
  }

  if (!session || session.expiresAt < now) {
    session = await prisma.ussdSession.upsert({
      where: { sessionId },
      create: {
        sessionId, phoneNumber, menuState: 'root', context: {},
        expiresAt: new Date(now.getTime() + env.USSD_SESSION_TTL_SECONDS * 1000),
      },
      update: {
        phoneNumber, menuState: 'root', context: {},
        expiresAt: new Date(now.getTime() + env.USSD_SESSION_TTL_SECONDS * 1000),
      },
    });
    // Never apply input received with a new/expired session id. This prevents
    // replayed menu text from immediately causing a consultation or lookup.
    return { response: MAIN_MENU, terminate: false };
  }

  const choice = lastSegment(text);

  const advance = async (menuState: string, context: Record<string, unknown> = {}) => {
    await prisma.ussdSession.update({
      where: { sessionId },
      data: { menuState, context: { ...(session!.context as object), ...context } as never,
              expiresAt: new Date(now.getTime() + env.USSD_SESSION_TTL_SECONDS * 1000) },
    });
  };
  const end = async () => {
    await prisma.ussdSession.delete({ where: { sessionId } }).catch(() => undefined);
  };

  if (session.menuState === 'root') {
    if (choice === '1') {
      await advance('awaiting_symptoms');
      return { response: 'Briefly describe what is wrong (reply with text):', terminate: false };
    }
    if (choice === '2') {
      const auth = await mintToken(phoneNumber);
      await end();
      if (!auth) return { response: NOT_REGISTERED, terminate: true };

      const result = await call(
        env.CONSULTATION_SERVICE_URL, '/consultations?limit=1', 'GET', auth.token,
      );
      if (!result.ok) return { response: 'Could not check your status right now. Try again shortly.', terminate: true };
      return { response: 'Check the A-Health app for full queue details.', terminate: true };
    }
    if (choice === '0' || choice === '') {
      await end();
      return { response: 'Goodbye.', terminate: true };
    }
    return { response: MAIN_MENU, terminate: false };
  }

  if (session.menuState === 'awaiting_symptoms') {
    const symptomText = choice;
    if (symptomText.trim().length === 0 || symptomText.trim().length > 500) {
      return {
        response: 'Please enter a short description of up to 500 characters.',
        terminate: false,
      };
    }
    const auth = await mintToken(phoneNumber);
    await end();
    if (!auth) return { response: NOT_REGISTERED, terminate: true };
    if (!auth.claims.ppid) {
      return { response: 'Your account has no patient profile. Please use the app to continue.', terminate: true };
    }

    const result = await call(
      env.CONSULTATION_SERVICE_URL, '/consultations', 'POST', auth.token,
      { channel: 'ussd', symptom_text: symptomText },
    );
    if (!result.ok) {
      return { response: 'Sorry, we could not submit your request. Please try again or visit a facility.', terminate: true };
    }
    return {
      response: 'Request received. A clinician will be with you shortly. You will get an SMS update.',
      terminate: true,
    };
  }

  await end();
  return { response: MAIN_MENU, terminate: false };
}
