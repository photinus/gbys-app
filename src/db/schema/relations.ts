import { relations } from "drizzle-orm";
import { users, sessions, accounts } from "./auth";
import { athletes, householdGuardians, householdInvites } from "./household";
import { programs, seasons, programRoles } from "./programs";
import { credentialDefinitions, userCredentials } from "./compliance";
import { resources, resourceBookings, auditLogs } from "./facilities";

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  guardianLinks: many(householdGuardians),
  programRoles: many(programRoles),
  credentials: many(userCredentials, { relationName: "credential_owner" }),
  reviewedCredentials: many(userCredentials, { relationName: "credential_reviewer" }),
  sentInvites: many(householdInvites, { relationName: "invite_sender" }),
  auditLogs: many(auditLogs),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const athletesRelations = relations(athletes, ({ many }) => ({
  guardians: many(householdGuardians),
}));

export const householdGuardiansRelations = relations(householdGuardians, ({ one }) => ({
  athlete: one(athletes, { fields: [householdGuardians.athleteId], references: [athletes.id] }),
  user: one(users, { fields: [householdGuardians.userId], references: [users.id] }),
}));

export const householdInvitesRelations = relations(householdInvites, ({ one }) => ({
  invitedBy: one(users, {
    fields: [householdInvites.invitedByUserId],
    references: [users.id],
    relationName: "invite_sender",
  }),
  acceptedBy: one(users, {
    fields: [householdInvites.acceptedByUserId],
    references: [users.id],
  }),
}));

export const programsRelations = relations(programs, ({ many }) => ({
  seasons: many(seasons),
  roles: many(programRoles),
}));

export const seasonsRelations = relations(seasons, ({ one }) => ({
  program: one(programs, { fields: [seasons.programId], references: [programs.id] }),
}));

export const programRolesRelations = relations(programRoles, ({ one }) => ({
  user: one(users, { fields: [programRoles.userId], references: [users.id] }),
  program: one(programs, { fields: [programRoles.programId], references: [programs.id] }),
  season: one(seasons, { fields: [programRoles.seasonId], references: [seasons.id] }),
}));

export const credentialDefinitionsRelations = relations(credentialDefinitions, ({ many }) => ({
  credentials: many(userCredentials),
}));

export const userCredentialsRelations = relations(userCredentials, ({ one }) => ({
  user: one(users, {
    fields: [userCredentials.userId],
    references: [users.id],
    relationName: "credential_owner",
  }),
  definition: one(credentialDefinitions, {
    fields: [userCredentials.definitionId],
    references: [credentialDefinitions.id],
  }),
  reviewer: one(users, {
    fields: [userCredentials.verifiedByUserId],
    references: [users.id],
    relationName: "credential_reviewer",
  }),
}));

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  parent: one(resources, {
    fields: [resources.parentResourceId],
    references: [resources.id],
    relationName: "resource_tree",
  }),
  children: many(resources, { relationName: "resource_tree" }),
  bookings: many(resourceBookings),
}));

export const resourceBookingsRelations = relations(resourceBookings, ({ one }) => ({
  resource: one(resources, { fields: [resourceBookings.resourceId], references: [resources.id] }),
  program: one(programs, { fields: [resourceBookings.programId], references: [programs.id] }),
  createdBy: one(users, { fields: [resourceBookings.createdByUserId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorUserId], references: [users.id] }),
}));
