import simpleGit from "simple-git";

export async function commitWiki(root: string, message: string): Promise<string> {
  const git = simpleGit(root);
  const status = await git.status();
  if (status.isClean()) return "no-changes";
  await git.add("-A");
  const res = await git.commit(message);
  return res.commit || "unknown";
}
