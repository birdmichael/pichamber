export const normalizeSaveDialogFilters = (filters) => {
  if (!Array.isArray(filters)) {
    return [];
  }

  return filters
    .filter((filter) => filter && typeof filter === 'object')
    .map((filter) => ({
      name: typeof filter.name === 'string' && filter.name.trim().length > 0 ? filter.name.trim() : 'Files',
      extensions: Array.isArray(filter.extensions)
        ? filter.extensions.filter((extension) => typeof extension === 'string' && extension.trim().length > 0)
        : [],
    }))
    .filter((filter) => filter.extensions.length > 0);
};

export const resolveSaveDialogWritePath = (result) => {
  if (!result || result.canceled) {
    return null;
  }
  const filePath = typeof result.filePath === 'string' ? result.filePath.trim() : '';
  return filePath.length > 0 ? filePath : null;
};
