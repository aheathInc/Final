import { prisma } from '@a-health/database';
import { conflict, forbidden, notFound, unprocessable } from '@a-health/http';
import { env } from '../config/env.js';
import type { PublishSlotsInput } from '../types/doctor.types.js';

function serialise(s: {
  id: string;
  clinicianId: string;
  startsAt: Date;
  durationMin: number;
  modality: string;
  isBooked: boolean;
}) {
  return {
    id: s.id,
    clinician_id: s.clinicianId,
    starts_at: s.startsAt.toISOString(),
    duration_minutes: s.durationMin,
    modality: s.modality,
    is_booked: s.isBooked,
  };
}

export async function listSlots(clinicianId: string, from: string, to: string) {
  const clinician = await prisma.clinicianProfile.findUnique({ where: { id: clinicianId } });
  if (!clinician) throw notFound('Clinician not found');

  const rows = await prisma.slot.findMany({
    where: {
      clinicianId,
      isBooked: false,
      startsAt: {
        gte: new Date(`${from}T00:00:00.000Z`),
        lte: new Date(`${to}T23:59:59.999Z`),
        // A slot in the past is not bookable, whatever the requested window says.
        gt: new Date(),
      },
    },
    orderBy: { startsAt: 'asc' },
    take: 500,
  });

  return { data: rows.map(serialise) };
}

/**
 * Replaces the clinician's published slots inside a window.
 *
 * Booked slots are never removed. A patient holding an appointment is not
 * something a clinician can delete by republishing their calendar — cancelling
 * the appointment is a separate, visible act.
 */
export async function publishSlots(
  clinicianProfileId: string,
  input: PublishSlotsInput,
  now = new Date(),
) {
  const clinician = await prisma.clinicianProfile.findUnique({
    where: { id: clinicianProfileId },
  });
  if (!clinician) throw notFound('Clinician profile not found');
  if (clinician.verificationStatus !== 'verified') {
    throw forbidden('CLINICIAN_NOT_VERIFIED', 'Your licence has not been verified');
  }

  const windowStart = new Date(`${input.from}T00:00:00.000Z`);
  const windowEnd = new Date(`${input.to}T23:59:59.999Z`);
  if (windowEnd < windowStart) throw unprocessable('`to` is before `from`', 'to');

  const horizon = new Date(now.getTime() + env.MAX_SLOT_HORIZON_DAYS * 86_400_000);
  if (windowEnd > horizon) {
    throw unprocessable(
      `Slots may only be published ${env.MAX_SLOT_HORIZON_DAYS} days ahead`,
      'to',
    );
  }

  const parsed = input.slots
    .map((s) => ({
      startsAt: new Date(s.starts_at),
      durationMin: s.duration_minutes,
      modality: s.modality,
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  for (const slot of parsed) {
    if (slot.startsAt < now) {
      throw conflict('SLOT_IN_PAST', 'A slot cannot start in the past', 'slots');
    }
    if (slot.startsAt < windowStart || slot.startsAt > windowEnd) {
      throw unprocessable('A slot falls outside the requested window', 'slots');
    }
    if (slot.durationMin > env.MAX_SLOT_MINUTES) {
      throw unprocessable(`A slot may not exceed ${env.MAX_SLOT_MINUTES} minutes`, 'slots');
    }
  }

  // Overlap is the failure the unique constraint on (clinician, starts_at) does
  // not catch: 09:00 for 30 minutes and 09:15 for 30 minutes have different
  // start times and still double-book the same person.
  for (let i = 1; i < parsed.length; i += 1) {
    const prev = parsed[i - 1]!;
    const cur = parsed[i]!;
    if (cur.startsAt.getTime() < prev.startsAt.getTime() + prev.durationMin * 60_000) {
      throw conflict('SLOT_UNAVAILABLE', 'Two published slots overlap', 'slots');
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const booked = await tx.slot.findMany({
      where: {
        clinicianId: clinicianProfileId,
        isBooked: true,
        startsAt: { gte: windowStart, lte: windowEnd },
      },
    });

    await tx.slot.deleteMany({
      where: {
        clinicianId: clinicianProfileId,
        isBooked: false,
        startsAt: { gte: windowStart, lte: windowEnd },
      },
    });

    const bookedTimes = new Set(booked.map((b) => b.startsAt.getTime()));
    const toCreate = parsed.filter((s) => !bookedTimes.has(s.startsAt.getTime()));

    // A new slot must not overlap a booked one either.
    for (const s of toCreate) {
      for (const b of booked) {
        const overlap =
          s.startsAt.getTime() < b.startsAt.getTime() + b.durationMin * 60_000 &&
          b.startsAt.getTime() < s.startsAt.getTime() + s.durationMin * 60_000;
        if (overlap) {
          throw conflict(
            'SLOT_UNAVAILABLE',
            'A published slot overlaps an existing booking',
            'slots',
          );
        }
      }
    }

    await tx.slot.createMany({
      data: toCreate.map((s) => ({
        clinicianId: clinicianProfileId,
        startsAt: s.startsAt,
        durationMin: s.durationMin,
        modality: s.modality as never,
      })),
    });

    const published = await tx.slot.findMany({
      where: {
        clinicianId: clinicianProfileId,
        isBooked: false,
        startsAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { startsAt: 'asc' },
    });

    return { published, retained: booked };
  });

  return {
    published: result.published.map(serialise),
    retained: result.retained.map(serialise),
  };
}
