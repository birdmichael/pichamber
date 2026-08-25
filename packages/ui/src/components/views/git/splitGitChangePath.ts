export function splitGitChangePath(path: string): { dir: string | null; name: string } {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash === -1) {
    return { dir: null, name: path };
  }
  return {
    dir: path.slice(0, lastSlash),
    name: path.slice(lastSlash + 1),
  };
}
