import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { birthdaysForHousehold, getConfig, putBirthday } from "@/lib/ddb";
import { daysUntilBirthday, nextBirthdayDate } from "@/lib/birthdays";
import { requireSession } from "@/lib/session";
import type { Birthday } from "@/lib/types";
import { BirthdayPostSchema, parseBody } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const tz = (await getConfig(s.sub)).timezone;
  const list = await birthdaysForHousehold(s.sub);
  const now = Date.now();
  const enriched = list
    .map((b) => ({
      ...b,
      nextDate: nextBirthdayDate(b, now, tz),
      daysAway: daysUntilBirthday(b, now, tz),
    }))
    .sort((a, b) => a.daysAway - b.daysAway);
  return NextResponse.json({ birthdays: enriched });
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (!s.ok) return s.response;
  const parsed = await parseBody(req, BirthdayPostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const b: Birthday = {
    id: nanoid(8),
    ownerSub: s.sub,
    name: body.name.trim(),
    month: body.month,
    day: body.day,
    createdAt: Date.now(),
  };
  await putBirthday(s.sub, b);
  return NextResponse.json({ birthday: b });
}
