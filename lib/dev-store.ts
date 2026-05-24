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

type PutInput = { TableName: string; Item: Item; ConditionExpression?: string; ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, unknown> };
type GetInput = { TableName: string; Key: { pk: unknown; sk: unknown } };
type DeleteInput = {
  TableName: string;
  Key: { pk: unknown; sk: unknown };
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
  ReturnValues?: string;
};
type QueryInput = {
  TableName: string;
  KeyConditionExpression?: string;
  ExpressionAttributeValues?: Record<string, unknown>;
};
type UpdateInput = {
  TableName: string;
  Key: { pk: unknown; sk: unknown };
  UpdateExpression?: string;
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
};

type CmdName = "Put" | "Get" | "Delete" | "Query" | "Update";

type AnyCommand = {
  constructor: { name: string };
  input: PutInput | GetInput | DeleteInput | QueryInput | UpdateInput;
};

function cmdName(cmd: AnyCommand): CmdName {
  const n = cmd.constructor.name;
  if (n.startsWith("Put")) return "Put";
  if (n.startsWith("Get")) return "Get";
  if (n.startsWith("Delete")) return "Delete";
  if (n.startsWith("Query")) return "Query";
  if (n.startsWith("Update")) return "Update";
  throw new Error(`dev-store: unsupported command ${n}`);
}

function resolveName(name: string, names: Record<string, string> | undefined): string {
  if (name.startsWith("#") && names) return names[name] ?? name;
  return name;
}

function resolveValue(name: string, values: Record<string, unknown> | undefined): unknown {
  if (name.startsWith(":") && values) return values[name];
  return undefined;
}

/**
 * Split expr on top-level occurrences of `sep` (case-insensitive), respecting
 * parentheses. Returns the parts without the separator.
 */
function splitTopLevel(expr: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  const upper = expr.toUpperCase();
  const sepUpper = sep.toUpperCase();
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === "(") { depth++; cur += expr[i++]; continue; }
    if (expr[i] === ")") { depth--; cur += expr[i++]; continue; }
    if (depth === 0 && upper.startsWith(sepUpper, i)) {
      parts.push(cur.trim());
      cur = "";
      i += sep.length;
      continue;
    }
    cur += expr[i++];
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function evalCondition(
  expr: string,
  item: Item,
  names?: Record<string, string>,
  values?: Record<string, unknown>,
): boolean {
  // Supports:
  //   attribute_not_exists(#keys)
  //   contains(#keys, :slotKey)
  //   NOT contains(#keys, :slotKey)
  //   <a> OR <b>
  //   <a> AND <b>
  //   Nested: <a> AND (<b> OR <c>)
  const orParts = splitTopLevel(expr, " OR ");
  return orParts.some((p) =>
    splitTopLevel(p, " AND ").every((tok) => evalAtomic(tok.trim(), item, names, values)),
  );
}

function evalAtomic(
  tok: string,
  item: Item,
  names?: Record<string, string>,
  values?: Record<string, unknown>,
): boolean {
  let negate = false;
  let body = tok;
  if (body.toUpperCase().startsWith("NOT ")) {
    negate = true;
    body = body.slice(4).trim();
  }
  // Strip outer parentheses — but only if they are a matching pair wrapping
  // the whole expression. After stripping, recurse into evalCondition so that
  // compound sub-expressions like (A OR B) are handled correctly.
  if (body.startsWith("(") && body.endsWith(")")) {
    const inner = body.slice(1, -1).trim();
    // Verify the parens actually wrap the whole thing (not e.g. "foo(x) OR bar(y)")
    let depth = 0;
    let balanced = true;
    for (let ci = 0; ci < inner.length; ci++) {
      if (inner[ci] === "(") depth++;
      if (inner[ci] === ")") {
        if (depth === 0) { balanced = false; break; }
        depth--;
      }
    }
    if (balanced) {
      const r = evalCondition(inner, item, names, values);
      return negate ? !r : r;
    }
  }
  const m1 = body.match(/^attribute_not_exists\((.+)\)$/);
  if (m1) {
    const n = resolveName(m1[1].trim(), names);
    const r = !(n in item);
    return negate ? !r : r;
  }
  const m2 = body.match(/^attribute_exists\((.+)\)$/);
  if (m2) {
    const n = resolveName(m2[1].trim(), names);
    const r = n in item;
    return negate ? !r : r;
  }
  const m3 = body.match(/^contains\(([^,]+),\s*(.+)\)$/);
  if (m3) {
    const n = resolveName(m3[1].trim(), names);
    const v = resolveValue(m3[2].trim(), values);
    const arr = (item[n] as unknown[]) ?? [];
    const r = Array.isArray(arr) && arr.includes(v);
    return negate ? !r : r;
  }
  // Comparison operators: LHS = RHS  or  LHS > RHS
  const mEq = body.match(/^(.+?)\s*=\s*(.+)$/);
  if (mEq) {
    const lhsRaw = mEq[1].trim();
    const rhsRaw = mEq[2].trim();
    const lhsName = resolveName(lhsRaw, names);
    const lhsVal = lhsRaw.startsWith(":") ? resolveValue(lhsRaw, values) : item[lhsName];
    const rhsVal = rhsRaw.startsWith(":") ? resolveValue(rhsRaw, values) : item[resolveName(rhsRaw, names)];
    const r = lhsVal === rhsVal;
    return negate ? !r : r;
  }
  const mGt = body.match(/^(.+?)\s*>\s*(.+)$/);
  if (mGt) {
    const lhsRaw = mGt[1].trim();
    const rhsRaw = mGt[2].trim();
    const lhsName = resolveName(lhsRaw, names);
    const lhsVal = lhsRaw.startsWith(":") ? resolveValue(lhsRaw, values) : item[lhsName];
    const rhsVal = rhsRaw.startsWith(":") ? resolveValue(rhsRaw, values) : item[resolveName(rhsRaw, names)];
    const r = (lhsVal as number) > (rhsVal as number);
    return negate ? !r : r;
  }
  throw new Error(`dev-store: unsupported condition atom: ${tok}`);
}

function evalRhs(
  rhs: string,
  item: Item,
  names: Record<string, string>,
  values: Record<string, unknown>,
): unknown {
  const m1 = rhs.match(/^list_append\((.+),\s*(.+)\)$/);
  if (m1) {
    const a = evalRhs(m1[1].trim(), item, names, values) as unknown[];
    const b = evalRhs(m1[2].trim(), item, names, values) as unknown[];
    return [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  }
  const m2 = rhs.match(/^if_not_exists\(([^,]+),\s*(.+)\)$/);
  if (m2) {
    const n = resolveName(m2[1].trim(), names);
    if (n in item) return item[n];
    return evalRhs(m2[2].trim(), item, names, values);
  }
  if (rhs.startsWith(":")) return values[rhs];
  if (rhs.startsWith("#")) return item[resolveName(rhs, names)];
  // Bare name (no alias)
  return item[rhs];
}

function applyUpdateExpression(
  item: Item,
  expr: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
): void {
  if (!expr.toUpperCase().startsWith("SET ")) {
    throw new Error(`dev-store: only SET expressions supported, got: ${expr}`);
  }
  const body = expr.slice(4);
  // Split on commas not inside parens
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());

  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) throw new Error(`dev-store: malformed SET part: ${part}`);
    const lhs = part.slice(0, eq).trim();
    const rhs = part.slice(eq + 1).trim();
    const target = resolveName(lhs, names);
    item[target] = evalRhs(rhs, item, names, values);
  }
}

export const devDoc = {
  async send(cmd: AnyCommand): Promise<unknown> {
    const kind = cmdName(cmd);

    if (kind === "Put") {
      const { Item, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } = cmd.input as PutInput;
      const key = compoundKey(Item.pk, Item.sk);
      if (ConditionExpression) {
        const existing = store.get(key) ?? {};
        const ok = evalCondition(
          ConditionExpression,
          existing,
          ExpressionAttributeNames,
          ExpressionAttributeValues,
        );
        if (!ok) {
          const err = new Error("The conditional request failed");
          (err as { name: string }).name = "ConditionalCheckFailedException";
          throw err;
        }
      }
      store.set(key, { ...Item });
      return {};
    }

    if (kind === "Get") {
      const { Key } = cmd.input as GetInput;
      const item = store.get(compoundKey(Key.pk, Key.sk));
      return item ? { Item: { ...item } } : {};
    }

    if (kind === "Delete") {
      const { Key, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues, ReturnValues } = cmd.input as DeleteInput;
      const key = compoundKey(Key.pk, Key.sk);
      const existing = store.get(key);
      if (ConditionExpression) {
        const ok = evalCondition(
          ConditionExpression,
          existing ?? {},
          ExpressionAttributeNames,
          ExpressionAttributeValues,
        );
        if (!ok) {
          const err = new Error("The conditional request failed");
          (err as { name: string }).name = "ConditionalCheckFailedException";
          throw err;
        }
      }
      store.delete(key);
      if (ReturnValues === "ALL_OLD" && existing) {
        return { Attributes: { ...existing } };
      }
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

    if (kind === "Update") {
      const input = cmd.input as UpdateInput;
      const key = compoundKey(input.Key.pk, input.Key.sk);
      const existing = store.get(key) ?? {};

      // Evaluate ConditionExpression (only the patterns markNotifiedForProfile uses)
      if (input.ConditionExpression) {
        const ok = evalCondition(
          input.ConditionExpression,
          existing,
          input.ExpressionAttributeNames,
          input.ExpressionAttributeValues,
        );
        if (!ok) {
          const err = new Error("The conditional request failed");
          (err as { name: string }).name = "ConditionalCheckFailedException";
          throw err;
        }
      }

      // Apply UpdateExpression (only SET with list_append / if_not_exists)
      const updated: Item = { ...existing, pk: input.Key.pk, sk: input.Key.sk };
      applyUpdateExpression(
        updated,
        input.UpdateExpression ?? "",
        input.ExpressionAttributeNames ?? {},
        input.ExpressionAttributeValues ?? {},
      );
      store.set(key, updated);
      return {};
    }

    throw new Error(`dev-store: unsupported command ${kind}`);
  },
};

export function isDevLocal(): boolean {
  return process.env.LR_DEV_LOCAL === "1";
}

/** Test support: wipe the in-memory store between tests. */
export function _resetDevStore(): void {
  store.clear();
}

export const DEV_USER_SUB = "dev-user";

export function _resetDevStore(): void {
  store.clear();
}
