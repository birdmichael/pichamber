export function shouldShowExtensionsSection(input: {
  loading: boolean;
  extensionCount: number;
  packageCount: number;
}): boolean {
  if (input.loading || input.extensionCount > 0) {
    return true;
  }
  // Omit the empty extensions block when installed packages are the useful data.
  return input.packageCount === 0;
}
