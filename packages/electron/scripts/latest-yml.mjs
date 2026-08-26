export const parseLatestYml = (content) => {
  const lines = content.split('\n');
  let releaseDate = '';
  let parsedVersion = '';
  const files = [];
  let current;

  const flush = () => {
    if (current?.url && current?.sha512 && current?.size) {
      files.push(current);
    }
    current = undefined;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const indented = line.startsWith('    ') || line.startsWith('  -');
    if (line.startsWith('version:')) {
      parsedVersion = line.slice('version:'.length).trim();
    } else if (line.startsWith('releaseDate:')) {
      releaseDate = line.slice('releaseDate:'.length).trim().replace(/^'|'$/g, '');
    } else if (trimmed.startsWith('- url:')) {
      flush();
      current = { url: trimmed.slice('- url:'.length).trim() };
    } else if (indented && current && trimmed.startsWith('sha512:')) {
      current.sha512 = trimmed.slice('sha512:'.length).trim();
    } else if (indented && current && trimmed.startsWith('size:')) {
      current.size = Number(trimmed.slice('size:'.length).trim());
    } else if (indented && current && trimmed.startsWith('blockMapSize:')) {
      current.blockMapSize = Number(trimmed.slice('blockMapSize:'.length).trim());
    } else if (!indented && current) {
      flush();
    }
  }

  flush();
  return { version: parsedVersion, releaseDate, files };
};

export const serializeLatestYml = (data) => {
  const lines = [`version: ${data.version}`, 'files:'];
  for (const file of data.files) {
    lines.push(`  - url: ${file.url}`);
    lines.push(`    sha512: ${file.sha512}`);
    lines.push(`    size: ${file.size}`);
    if (file.blockMapSize) {
      lines.push(`    blockMapSize: ${file.blockMapSize}`);
    }
  }
  lines.push(`releaseDate: '${data.releaseDate}'`);
  return `${lines.join('\n')}\n`;
};

export const hasArtifact = (files, name) => files.some((file) => (
  decodeURIComponent(String(file.url || '')).includes(name)
));

export const macArtifactArch = (url) => {
  const name = decodeURIComponent(String(url || ''));
  if (name.includes('-mac-arm64.')) return 'arm64';
  if (name.includes('-mac-x64.')) return 'x64';
  return null;
};

export const mergeLatestMacYml = (existing, incoming) => {
  if (!incoming?.files?.length) {
    throw new Error('incoming latest-mac.yml must list at least one file');
  }

  if (!existing) {
    return {
      version: incoming.version,
      releaseDate: incoming.releaseDate,
      files: [...incoming.files],
    };
  }

  const incomingArchs = new Set(
    incoming.files.map((file) => macArtifactArch(file.url)).filter(Boolean),
  );
  const incomingUrls = new Set(
    incoming.files.map((file) => decodeURIComponent(String(file.url || ''))),
  );
  const kept = existing.files.filter((file) => {
    const url = decodeURIComponent(String(file.url || ''));
    if (incomingUrls.has(url)) return false;
    const arch = macArtifactArch(url);
    return !(arch && incomingArchs.has(arch));
  });

  return {
    version: incoming.version,
    releaseDate: incoming.releaseDate || existing.releaseDate,
    files: [...kept, ...incoming.files],
  };
};
