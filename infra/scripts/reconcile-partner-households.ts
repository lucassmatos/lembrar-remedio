// infra/scripts/reconcile-partner-households.ts
//
// One-shot reconciliation: make partner households symmetric. For every user
// that has a partner record, ensure each of their owned profiles is shared with
// the partner — both the profile's sharedWith entry AND the partner's share-link
// record. Older partner invites only shared the owner's profiles with the
// invitee (one direction); this backfills the missing direction so both members
// see the full roster and notifications fan out to both.
//
// Usage: AWS_PROFILE=... npx -p tsx tsx infra/scripts/reconcile-partner-households.ts [--dry-run]
//
// Idempotent: only writes the entries/links that are actually missing.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

const DEFAULT_TABLE = process.env.DDB_TABLE_NAME || "lembrar-remedio";
const REGION = process.env.AWS_REGION || "us-east-1";

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");

type ShareEntry = { sub: string; role: string; addedAt: number };
type Profile = {
  id: string;
  ownerSub?: string;
  sharedWith?: ShareEntry[];
  version?: number;
  [k: string]: unknown;
};

type ReconcileOptions = {
  /** Injectable DDB doc client (for tests using dev-store). Defaults to real client. */
  doc?: DynamoDBDocumentClient;
  /** Table name override. Defaults to DDB_TABLE_NAME or "lembrar-remedio". */
  table?: string;
  /** Dry run — log what would change, no writes. */
  dryRun?: boolean;
};

export type ReconcileReport = {
  pairsProcessed: number;
  sharedWithAdded: number;
  linksAdded: number;
};

const pkUser = (sub: string) => `user#${sub}`;
const skProfile = (id: string) => `profile#${id}`;
const skPartner = "partner";
const skShareLink = (ownerSub: string, profileId: string) => `shared#${ownerSub}#${profileId}`;

function makeDefaultDoc(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({ region: REGION });
  return DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

let _defaultDoc: DynamoDBDocumentClient | undefined;
function getDefaultDoc(): DynamoDBDocumentClient {
  if (!_defaultDoc) _defaultDoc = makeDefaultDoc();
  return _defaultDoc;
}

function stripKeys(item: Record<string, unknown>): Record<string, unknown> {
  const { pk: _pk, sk: _sk, ...rest } = item as { pk?: unknown; sk?: unknown };
  return rest;
}

async function listAllUsers(doc: DynamoDBDocumentClient, table: string): Promise<string[]> {
  const out: string[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": "users", ":sk": "user#" },
        ExclusiveStartKey: lek,
      }),
    );
    for (const it of res.Items ?? []) out.push(it.sub as string);
    lek = res.LastEvaluatedKey;
  } while (lek);
  return out;
}

async function getPartnerSub(
  doc: DynamoDBDocumentClient,
  table: string,
  sub: string,
): Promise<string | null> {
  const res = await doc.send(
    new GetCommand({ TableName: table, Key: { pk: pkUser(sub), sk: skPartner } }),
  );
  return (res.Item?.partnerSub as string | undefined) ?? null;
}

async function listOwnedProfiles(
  doc: DynamoDBDocumentClient,
  table: string,
  sub: string,
): Promise<Profile[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": pkUser(sub), ":sk": "profile#" },
    }),
  );
  return (res.Items ?? []).map((it) => stripKeys(it) as Profile);
}

async function linkExists(
  doc: DynamoDBDocumentClient,
  table: string,
  viewerSub: string,
  ownerSub: string,
  profileId: string,
): Promise<boolean> {
  const res = await doc.send(
    new GetCommand({
      TableName: table,
      Key: { pk: pkUser(viewerSub), sk: skShareLink(ownerSub, profileId) },
    }),
  );
  return !!res.Item;
}

export async function reconcilePartnerHouseholds(
  opts: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const doc = opts.doc ?? getDefaultDoc();
  const table = opts.table ?? DEFAULT_TABLE;
  const dryRun = opts.dryRun ?? false;
  const now = Date.now();

  const report: ReconcileReport = { pairsProcessed: 0, sharedWithAdded: 0, linksAdded: 0 };

  const users = await listAllUsers(doc, table);
  for (const sub of users) {
    const partnerSub = await getPartnerSub(doc, table, sub);
    if (!partnerSub) continue;
    report.pairsProcessed++;

    const owned = await listOwnedProfiles(doc, table, sub);
    for (const profile of owned) {
      const sharedWith = profile.sharedWith ?? [];
      const hasEntry = sharedWith.some((e) => e.sub === partnerSub);
      if (!hasEntry) {
        report.sharedWithAdded++;
        const next: Profile = {
          ...profile,
          ownerSub: profile.ownerSub ?? sub,
          sharedWith: [...sharedWith, { sub: partnerSub, role: "partner", addedAt: now }],
          version: (profile.version ?? 1) + 1,
        };
        console.log(
          `${dryRun ? "[dry] " : ""}share ${sub}/${profile.id} -> partner ${partnerSub}`,
        );
        if (!dryRun) {
          await doc.send(
            new PutCommand({
              TableName: table,
              Item: { pk: pkUser(sub), sk: skProfile(profile.id), ...next },
            }),
          );
        }
      }

      const hasLink = await linkExists(doc, table, partnerSub, sub, profile.id);
      if (!hasLink) {
        report.linksAdded++;
        console.log(
          `${dryRun ? "[dry] " : ""}link ${partnerSub} -> ${sub}/${profile.id}`,
        );
        if (!dryRun) {
          await doc.send(
            new PutCommand({
              TableName: table,
              Item: {
                pk: pkUser(partnerSub),
                sk: skShareLink(sub, profile.id),
                ownerSub: sub,
                profileId: profile.id,
                role: "partner",
                addedAt: now,
              },
            }),
          );
        }
      }
    }
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}done: pairs=${report.pairsProcessed} sharedWith+=${report.sharedWithAdded} links+=${report.linksAdded}`,
  );
  return report;
}

// Run as a standalone script (not when imported by tests).
if (process.argv[1] && process.argv[1].includes("reconcile-partner-households")) {
  reconcilePartnerHouseholds({ dryRun: DRY }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
