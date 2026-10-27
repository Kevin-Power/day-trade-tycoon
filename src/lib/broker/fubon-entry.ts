/**
 * Whether the desk shows the owner's 富邦唯讀行情 entry. Only the verified owner may read the feed, and the
 * owner is always a teacher account: guests ask nothing, students read only their own role, and only a
 * teacher asks the owner check (`/api/broker/quotes?access=1`). Any failure hides the entry.
 */
export async function fubonEntryAllowed(input: {
  signedIn: boolean;
  loadRole: () => Promise<string | null | undefined>;
  probe: () => Promise<boolean>;
}): Promise<boolean> {
  if (!input.signedIn) return false;
  try {
    if ((await input.loadRole()) !== "teacher") return false;
    return await input.probe();
  } catch {
    return false;
  }
}
