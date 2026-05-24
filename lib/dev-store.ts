// Dev-only in-memory DDB stand-in. Activated by LR_DEV_LOCAL=1.
// Persists across requests in a single Next dev process; dies on restart.
// Implements just the ops lib/ddb.ts uses: Put/Get/Delete + Query with
// "pk = :pk AND begins_with(sk, :sk)".

type Item = Record<string, unknown>;

const STORE_KEY = "__lr_dev_store__";
type Global = { [STORE_KEY]?: Map<string, Item> };
const g = globalThis as unknown as Global;
const store: Map<string, Item> = g[STORE_KEY] ?? new Map();
g[STORE_KEY] = store;

function compoundKey(pk: unknown, sk: unknown): string {
  return `${String(pk)}|${String(sk)}`;
}

type PutInput = { TableName: string; Item: Item };
type GetInput = { TableName: string; Key: { pk: unknown; sk: unknown } };
type DeleteInput = { TableName: string; Key: { pk: unknown; sk: unknown } };
type QueryInput = {
  TableName: string;
  KeyConditionExpression?: string;
  ExpressionAttributeValues?: Record<string, unknown>;
};

type CmdName = "Put" | "Get" | "Delete" | "Query";

type AnyCommand = {
  constructor: { name: string };
  input: PutInput | GetInput | DeleteInput | QueryInput;
};

function cmdName(cmd: AnyCommand): CmdName {
  const n = cmd.constructor.name;
  if (n.startsWith("Put")) return "Put";
  if (n.startsWith("Get")) return "Get";
  if (n.startsWith("Delete")) return "Delete";
  if (n.startsWith("Query")) return "Query";
  throw new Error(`dev-store: unsupported command ${n}`);
}

export const devDoc = {
  async send(cmd: AnyCommand): Promise<unknown> {
    const kind = cmdName(cmd);

    if (kind === "Put") {
      const { Item } = cmd.input as PutInput;
      const key = compoundKey(Item.pk, Item.sk);
      store.set(key, { ...Item });
      return {};
    }

    if (kind === "Get") {
      const { Key } = cmd.input as GetInput;
      const item = store.get(compoundKey(Key.pk, Key.sk));
      return item ? { Item: { ...item } } : {};
    }

    if (kind === "Delete") {
      const { Key } = cmd.input as DeleteInput;
      store.delete(compoundKey(Key.pk, Key.sk));
      return {};
    }

    if (kind === "Query") {
      const input = cmd.input as QueryInput;
      const expr = input.KeyConditionExpression ?? "";
      const vals = input.ExpressionAttributeValues ?? {};
      const pkVal = vals[":pk"];
      const skPrefix = vals[":sk"];
      const wantBeginsWith = expr.includes("begins_with(sk");
      const items: Item[] = [];
      for (const item of store.values()) {
        if (item.pk !== pkVal) continue;
        if (wantBeginsWith) {
          const sk = String(item.sk ?? "");
          if (!sk.startsWith(String(skPrefix))) continue;
        }
        items.push({ ...item });
      }
      return { Items: items };
    }

    throw new Error(`dev-store: unsupported command ${kind}`);
  },
};

export function isDevLocal(): boolean {
  return process.env.LR_DEV_LOCAL === "1";
}

export const DEV_USER_SUB = "dev-user";
