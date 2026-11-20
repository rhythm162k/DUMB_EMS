// The root administrator's employee record is view-only for everyone except the root
// administrator. The root administrator always edits their own record, including the profile
// photo, so the signed-in user's own record is never shown read-only.
export function isReadOnlyRootRecord({
  recordIsRoot,
  rootAdmin,
  isSelf,
}: {
  recordIsRoot: boolean | undefined;
  rootAdmin: boolean;
  isSelf: boolean;
}): boolean {
  return recordIsRoot === true && !rootAdmin && !isSelf;
}
