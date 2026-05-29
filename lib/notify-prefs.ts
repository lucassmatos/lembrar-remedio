/**
 * Preferência de destinatário: de quais perfis um usuário quer receber
 * notificação de dose. Guardada em `Config.notifyProfileIds`.
 *
 * O fan-out manda uma dose de um perfil pra todos os membros pareados desse
 * perfil (dono + compartilhados). Esta função decide, por membro, se ele
 * realmente quer aquela notificação.
 *
 * Semântica do default:
 *  - `undefined` (nunca mexeu nos ajustes) → "só a própria pessoa": o membro
 *    recebe apenas dos perfis que ele mesmo é dono (`isOwner`). Perfis
 *    compartilhados por outros não notificam até ele optar.
 *  - lista explícita → recebe exatamente os perfis listados (lista vazia
 *    silencia tudo, inclusive os próprios).
 */
export function memberWantsProfileNotifications(
  notifyProfileIds: string[] | undefined,
  profileId: string,
  isOwner: boolean,
): boolean {
  if (notifyProfileIds === undefined) return isOwner;
  return notifyProfileIds.includes(profileId);
}

/**
 * Conjunto inicial de perfis "marcados" pra UI de ajustes, dada a config atual
 * e a lista de perfis acessíveis (com flag de quem é dono). Reflete o default
 * quando `notifyProfileIds` ainda é `undefined`.
 */
export function initialNotifyProfileIds(
  notifyProfileIds: string[] | undefined,
  profiles: Array<{ id: string; isOwner: boolean }>,
): string[] {
  return profiles
    .filter((p) => memberWantsProfileNotifications(notifyProfileIds, p.id, p.isOwner))
    .map((p) => p.id);
}
