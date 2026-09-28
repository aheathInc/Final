import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '@a-health/database';

/**
 * Operations seed. Keyed on one marker so re-running removes only what it
 * made, and hashed at the same cost the auth service uses so the account logs
 * in through the real POST /auth/login rather than a back door.
 */
const ADMIN_EMAIL = 'msimamizi@dev.local';
const ADMIN_PASSWORD = 'Msimamizi#2026';
const MARKER = 'seed-admin';

async function wipe() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

  const emergencies = await prisma.emergencyRequest.findMany({
    where: { description: { startsWith: MARKER } },
    select: { id: true },
  });
  const ids = emergencies.map((e) => e.id);
  await prisma.emergencyEvent.deleteMany({ where: { emergencyId: { in: ids } } });
  await prisma.emergencyRequest.deleteMany({ where: { id: { in: ids } } });

  const units = await prisma.transportUnit.findMany({
    where: { callSign: { startsWith: 'SEED-' } },
    select: { id: true },
  });
  const unitIds = units.map((u) => u.id);
  await prisma.transportPing.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.transportUnit.deleteMany({ where: { id: { in: unitIds } } });

  const devices = await prisma.device.findMany({
    where: { serialNumber: { startsWith: 'SEED-' } },
    select: { id: true },
  });
  const deviceIds = devices.map((d) => d.id);
  await prisma.deviceAlertRecipient.deleteMany({ where: { alert: { deviceId: { in: deviceIds } } } });
  await prisma.deviceAlert.deleteMany({ where: { deviceId: { in: deviceIds } } });
  await prisma.deviceTelemetry.deleteMany({ where: { deviceId: { in: deviceIds } } });
  await prisma.device.deleteMany({ where: { id: { in: deviceIds } } });

  await prisma.incidentReport.deleteMany({ where: { description: { startsWith: MARKER } } });

  const facilities = await prisma.facility.findMany({
    where: { name: { startsWith: 'Hospitali ya Majaribio' } },
    select: { id: true },
  });
  const facilityIds = facilities.map((f) => f.id);
  await prisma.department.deleteMany({ where: { facilityId: { in: facilityIds } } });
  await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } });

  const pending = await prisma.user.findFirst({ where: { email: 'mgombea@dev.local' } });
  if (pending) {
    await prisma.clinicianProfile.deleteMany({ where: { userId: pending.id } });
    await prisma.user.delete({ where: { id: pending.id } }).catch(() => undefined);
  }

  if (admin) await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
}

async function main() {
  await wipe();

  await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
      role: 'platform_admin',
      status: 'active',
      fullName: 'Neema Kilonzo',
    },
  });

  const facility = await prisma.facility.create({
    data: {
      name: 'Hospitali ya Majaribio ya Mwananyamala',
      type: 'hospital',
      lat: -6.7789,
      lng: 39.2483,
      regionCode: 'DAR',
      contactPhone: '+255222761000',
      integrationLevel: 'none',
    },
  });

  await prisma.department.createMany({
    data: [
      { facilityId: facility.id, name: 'Dharura', specialty: 'other' as never },
      { facilityId: facility.id, name: 'Wazazi', specialty: 'obstetrics_gynaecology' as never },
    ],
  });

  // Two ambulances at different distances, so the dispatch panel's
  // nearest-first ordering is visible rather than theoretical.
  await prisma.transportUnit.createMany({
    data: [
      { callSign: 'SEED-A1', capability: 'advanced', status: 'available', lat: -6.78, lng: 39.25 },
      { callSign: 'SEED-B2', capability: 'basic', status: 'available', lat: -6.85, lng: 39.31 },
      { callSign: 'SEED-C3', capability: 'mass_casualty', status: 'out_of_service', lat: -6.80, lng: 39.28 },
    ],
  });

  // One of each shape the board renders differently: a mass-casualty event, an
  // ordinary unhandled report, and one already dispatched.
  const cases = [
    {
      scale: 'mass_casualty' as const, category: 'road_traffic' as const,
      description: `${MARKER}: Ajali ya basi barabara ya Morogoro, watu wengi wameumia.`,
      casualties: 14, lat: -6.8123, lng: 39.2201, status: 'reported' as const,
    },
    {
      scale: 'individual' as const, category: 'medical' as const,
      description: `${MARKER}: Mwanamke amezimia sokoni, hapumui vizuri.`,
      casualties: 1, lat: -6.7955, lng: 39.2688, status: 'reported' as const,
    },
    {
      scale: 'individual' as const, category: 'obstetric' as const,
      description: `${MARKER}: Mama mjamzito ana damu nyingi, yuko nyumbani.`,
      casualties: 1, lat: -6.7702, lng: 39.2410, status: 'triaged' as const,
    },
  ];

  for (const c of cases) {
    const e = await prisma.emergencyRequest.create({
      data: {
        scale: c.scale, category: c.category, source: 'bystander', status: c.status,
        lat: c.lat, lng: c.lng, estimatedCasualties: c.casualties, description: c.description,
      },
    });
    await prisma.emergencyEvent.create({
      data: { emergencyId: e.id, toStatus: c.status as never },
    });
  }

  // A licence waiting on a decision, so /verification is not empty.
  const candidate = await prisma.user.create({
    data: {
      phoneNumber: `+2557${randomInt(10_000_000, 99_999_999)}`,
      email: 'mgombea@dev.local',
      role: 'clinician',
      status: 'pending_verification',
      fullName: 'Baraka Shirima',
    },
  });
  await prisma.clinicianProfile.create({
    data: {
      userId: candidate.id,
      licenseNumber: `TMC-${randomInt(100000, 999999)}`,
      specialty: 'paediatrics',
      verificationStatus: 'pending',
    },
  });

  await prisma.device.create({
    data: {
      deviceType: 'vehicle_sensor',
      serialNumber: `SEED-${randomUUID().slice(0, 8)}`,
      vehicleRegistration: 'T123 ABC',
      label: 'Gari la kubeba wagonjwa',
      credentialHash: 'seed-placeholder-never-used-for-auth',
    },
  });

  await prisma.incidentReport.create({
    data: {
      category: 'delayed_response',
      severity: 'serious',
      description: `${MARKER}: Gari lilichelewa zaidi ya saa moja baada ya kuitwa.`,
      anonymous: true,
      escalatedToGovernance: true,
    },
  });

  console.log('\nAdmin seed complete.\n');
  console.log('  Log in at http://localhost:3200/login');
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
  console.log('\n  3 emergencies waiting, 3 ambulances, 1 licence pending, 1 incident report.\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
