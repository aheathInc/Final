/**
 * Ranks clinicians for a case.
 *
 * Pure and deterministic so it can be tested and, more importantly, explained.
 * When a patient waited forty minutes, the offer rows show exactly who was
 * ranked, with what weights, and what each of them did about it.
 */

export interface Candidate {
  clinicianId: string;
  specialty: string;
  languages: string[];
  currentLoad: number;
  maxLoad: number;
  ratingAvg: number | null;
  lat?: number | null;
  lng?: number | null;
}

export interface MatchContext {
  requiredSpecialty: string;
  patientLanguage: string;
  patientLat?: number | null;
  patientLng?: number | null;
  urgency: 'routine' | 'urgent' | 'emergency';
}

export interface RankedCandidate {
  clinicianId: string;
  score: number;
  weights: Record<string, number>;
}

const WEIGHTS = {
  specialty: 0.35,
  language: 0.25,
  availability: 0.25,
  rating: 0.1,
  proximity: 0.05,
};

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function rank(candidates: Candidate[], ctx: MatchContext): RankedCandidate[] {
  return candidates
    .filter((c) => c.currentLoad < c.maxLoad)
    .map((c) => {
      const specialty =
        c.specialty === ctx.requiredSpecialty ? 1 : c.specialty === 'general_practice' ? 0.6 : 0.2;

      // Language is weighted heavily on purpose. A consultation conducted in a
      // language the patient half-follows is not a safe consultation, and given
      // the language spread here that is not an edge case.
      const language = c.languages.includes(ctx.patientLanguage)
        ? 1
        : c.languages.includes('sw') || c.languages.includes('en')
          ? 0.5
          : 0.1;

      const availability = 1 - c.currentLoad / Math.max(c.maxLoad, 1);

      // Unrated clinicians sit at the midpoint, not the bottom. Ranking them
      // last would mean a newly deployed graduate never gets a first case,
      // which defeats the point of employing them.
      const rating = c.ratingAvg === null ? 0.6 : Math.min(c.ratingAvg / 5, 1);

      let proximity = 0.5;
      if (ctx.patientLat != null && ctx.patientLng != null && c.lat != null && c.lng != null) {
        const km = haversineKm(ctx.patientLat, ctx.patientLng, c.lat, c.lng);
        proximity = Math.max(0, 1 - km / 100);
      }

      const weights = { specialty, language, availability, rating, proximity };
      const score =
        specialty * WEIGHTS.specialty +
        language * WEIGHTS.language +
        availability * WEIGHTS.availability +
        rating * WEIGHTS.rating +
        proximity * WEIGHTS.proximity;

      return { clinicianId: c.clinicianId, score: Number(score.toFixed(4)), weights };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Escalation widens the net rather than lowering the bar: more clinicians are
 * offered the case, but nobody unverified or over capacity is ever included.
 */
export function fanoutFor(urgency: string, escalationCount: number, base: number): number {
  const bonus = urgency === 'emergency' ? 3 : urgency === 'urgent' ? 1 : 0;
  return Math.min(base + bonus + escalationCount * 2, 25);
}
