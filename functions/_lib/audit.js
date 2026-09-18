export async function writeAudit(db, { recipeId, action, source = 'manual', ipHash, actorUserId = null, before = null, after = null }) {
  await db.request('recipe_audit_log', {
    method: 'POST',
    body: { recipe_id: recipeId, action, source, actor_ip_hash: ipHash, actor_user_id: actorUserId, before, after },
  });
}
