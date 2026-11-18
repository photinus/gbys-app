import "dotenv/config";
import { db } from "./index";
import { credentialDefinitions, resources } from "./schema";

async function seed() {
  console.log("Seeding GBYS baseline credential definitions...");

  await db
    .insert(credentialDefinitions)
    .values([
      {
        code: "first_advantage_bg",
        name: "First Advantage Background Check",
        description: "National criminal & sex offender background screening (Cal Ripken / Babe Ruth / Partner).",
        defaultValidityMonths: 24,
      },
      {
        code: "safesport",
        name: "Abuse Prevention / SafeSport Training",
        description: "Mandatory youth athlete abuse prevention & mandatory reporting certification.",
        defaultValidityMonths: 12,
      },
      {
        code: "concussion",
        name: "Concussion Recognition & Protocol",
        description: "CDC Heads Up or NFHS concussion training certification.",
        defaultValidityMonths: 24,
      },
      {
        code: "code_of_conduct",
        name: "GBYS Volunteer Code of Conduct",
        description: "Annual signed volunteer conduct and safety agreement.",
        defaultValidityMonths: 12,
      },
    ])
    .onConflictDoNothing();

  console.log("Seeding sample Gold Beach facilities...");

  const [gym] = await db
    .insert(resources)
    .values({
      name: "Gold Beach High School Gym",
      locationAddress: "29516 Ellensburg Ave, Gold Beach, OR 97444",
    })
    .returning();

  if (gym) {
    await db.insert(resources).values([
      {
        parentResourceId: gym.id,
        name: "GBHS Gym - Mat 1 (North)",
        locationAddress: "29516 Ellensburg Ave, Gold Beach, OR 97444",
      },
      {
        parentResourceId: gym.id,
        name: "GBHS Gym - Mat 2 (South)",
        locationAddress: "29516 Ellensburg Ave, Gold Beach, OR 97444",
      },
    ]);
  }

  console.log("Seed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
