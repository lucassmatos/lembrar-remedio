/**
 * End-to-end "completão": the whole sharing story in one test, exercising the
 * real lib functions the API routes call. Mocks only Telegram (network).
 *
 * Scenario: Lucas e Maria cuidam do Filho. Lucas cria o perfil + remédio,
 * convida Maria como parceira. Ambos pareiam Telegram. Na hora da dose, os
 * dois são notificados. Maria marca "tomei" — o card do Lucas vira "✅ Maria
 * marcou", e o histórico registra quem marcou. Uma babá é convidada como
 * cuidadora só do Filho: vê e marca, mas não edita.
 */
import { vi } from "vitest";

vi.hoisted(() => {
  process.env.LR_DEV_LOCAL = "1";
});

vi.mock("@/lib/telegram", () => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
  editMessage: vi.fn().mockResolvedValue(undefined),
  escapeHtml: (s: string) => s,
}));

import { describe, it, expect, beforeEach } from "vitest";
import { _resetDevStore } from "@/lib/dev-store";
import {
  putProfile,
  putReminderForProfile,
  putGenericToken,
  consumeGenericToken,
  setConfig,
  listProfilesForUser,
  getLogForProfile,
  setLogEntryForProfile,
} from "@/lib/ddb";
import {
  acceptInvite,
  requireProfileAccess,
  ForbiddenError,
  type InvitePayload,
} from "@/lib/sharing";
import { notifyOneDose, notifyOtherMembersOfTaken } from "@/lib/notify-one";
import { slotKey } from "@/lib/schedule";
import { sendMessage, editMessage } from "@/lib/telegram";
import type { Reminder } from "@/lib/types";

const LUCAS = "google|lucas";
const MARIA = "google|maria";
const BABA = "google|baba";
const PROFILE = "filho1";
const REMINDER = "dipirona";
const DATE = "2026-05-24";
const TIME = "08:00";
const KEY = slotKey(REMINDER, TIME);

const sm = vi.mocked(sendMessage);
const em = vi.mocked(editMessage);

beforeEach(() => {
  _resetDevStore();
  sm.mockClear();
  em.mockClear();
});

describe("completão: casal + filho + babá", () => {
  it("fluxo inteiro: criar, compartilhar, notificar, marcar, sincronizar", async () => {
    // --- Lucas pareia Telegram e cria o perfil do filho + remédio ---
    await setConfig(LUCAS, { chatId: 100, timezone: "UTC", name: "Lucas" });
    await putProfile(LUCAS, {
      id: PROFILE,
      name: "Filho",
      color: "sky",
      createdAt: 1,
      ownerSub: LUCAS,
      sharedWith: [],
      version: 1,
    });
    const reminder: Reminder = {
      id: REMINDER,
      kind: "medication",
      title: "Dipirona",
      schedule: { type: "daily-interval", intervalHours: 8, startTime: TIME },
      profileId: PROFILE,
      createdAt: 1,
    };
    await putReminderForProfile(reminder);

    // --- Maria pareia Telegram e aceita o convite de parceira ---
    await setConfig(MARIA, { chatId: 200, timezone: "UTC", name: "Maria" });
    const partnerToken = "tok-partner";
    const partnerPayload: InvitePayload = { ownerSub: LUCAS, mode: "partner" };
    await putGenericToken(partnerToken, JSON.stringify(partnerPayload), 3600);

    const consumed = await consumeGenericToken(partnerToken);
    expect(consumed).toBe(JSON.stringify(partnerPayload));
    await acceptInvite({
      callerSub: MARIA,
      callerEmail: "maria@example.com",
      callerName: "Maria",
      payload: JSON.parse(consumed!) as InvitePayload,
    });

    // Maria enxerga o Filho como parceira e pode editar
    const mariaProfiles = await listProfilesForUser(MARIA);
    const filhoForMaria = mariaProfiles.find((p) => p.profile.id === PROFILE);
    expect(filhoForMaria?.accessRole).toBe("partner");
    await expect(requireProfileAccess(MARIA, PROFILE, "editor")).resolves.toBeDefined();

    // --- Hora da dose: notifica todos os membros pareados ---
    const result = await notifyOneDose({
      profileId: PROFILE,
      ownerSub: LUCAS,
      reminderId: REMINDER,
      time: TIME,
    });
    expect(result.sent).toBe(true);

    // Mandou pro Lucas (100) e pra Maria (200)
    const notifiedChatIds = sm.mock.calls.map((c) => (c[0] as { chatId: number }).chatId).sort();
    expect(notifiedChatIds).toEqual([100, 200]);

    // --- Maria marca "tomei" pelo app ---
    await setLogEntryForProfile(PROFILE, DATE, KEY, true, MARIA, "Maria");
    await notifyOtherMembersOfTaken({
      profileId: PROFILE,
      date: DATE,
      slotKey: KEY,
      takenBySub: MARIA,
      takenByName: "Maria",
    });

    // O card do Lucas (100) foi editado pra "Maria marcou", o da Maria (200) não
    expect(em).toHaveBeenCalledTimes(1);
    const editArg = em.mock.calls[0][0] as { chatId: number; text: string };
    expect(editArg.chatId).toBe(100);
    expect(editArg.text).toContain("Maria");

    // --- Lucas abre o histórico e vê quem marcou ---
    const log = await getLogForProfile(PROFILE, DATE);
    expect(log[KEY].taken).toBe(true);
    expect(log[KEY].takenBy).toBe(MARIA);
    expect(log[KEY].takenByName).toBe("Maria");

    // --- Babá é convidada só pro Filho, como cuidadora ---
    const babaToken = "tok-baba";
    const babaPayload: InvitePayload = {
      ownerSub: LUCAS,
      mode: "caregiver",
      profileIds: [PROFILE],
      inviteeEmail: "baba@example.com",
    };
    await putGenericToken(babaToken, JSON.stringify(babaPayload), 3600);
    const babaConsumed = await consumeGenericToken(babaToken);
    await acceptInvite({
      callerSub: BABA,
      callerEmail: "baba@example.com",
      callerName: "Babá",
      payload: JSON.parse(babaConsumed!) as InvitePayload,
    });

    // Babá vê e marca (viewer), mas NÃO edita (editor)
    await expect(requireProfileAccess(BABA, PROFILE, "viewer")).resolves.toBeDefined();
    await expect(requireProfileAccess(BABA, PROFILE, "editor")).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Babá só enxerga o Filho, não os perfis do Lucas/Maria
    const babaProfiles = await listProfilesForUser(BABA);
    expect(babaProfiles.map((p) => p.profile.id)).toEqual([PROFILE]);
  });
});
