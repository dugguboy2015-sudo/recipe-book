export async function countSince(db, table, column, value, sinceIso) {
  const filters = `${column}=eq.${encodeURIComponent(value)}&created_at=gte.${encodeURIComponent(sinceIso)}`;
  return db.count(table, filters);
}
