import type { SourceCandidate, SourcePlatform } from "@my-bookmark/ai";

const SOURCE_CONFIDENCE_THRESHOLD = 0.85;

interface PlatformPolicy {
  key: string;
  hosts: ReadonlySet<string>;
  isHandle: (handle: string) => boolean;
  profileUrl: (handle: string) => string;
}

const commonHandle = /^[\p{L}\p{N}._-]{1,100}$/u;
const instagramHandle = /^[A-Za-z0-9._]{1,30}$/;
const xHandle = /^[A-Za-z0-9_]{1,15}$/;
const tiktokHandle = /^[A-Za-z0-9._]{2,24}$/;

function isGitHubOwner(value: string): boolean {
  return (
    value.length <= 39 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(value) &&
    !value.includes("--")
  );
}

function isGitHubRepository(value: string): boolean {
  return (
    value.length <= 100 &&
    value !== "." &&
    value !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

const policies: Record<SourcePlatform, PlatformPolicy> = {
  youtube: {
    key: "유튜브",
    hosts: new Set(["youtube.com", "www.youtube.com", "youtu.be"]),
    isHandle: (handle) => commonHandle.test(handle),
    profileUrl: (handle) =>
      `https://www.youtube.com/@${encodeURIComponent(handle)}`,
  },
  instagram: {
    key: "인스타그램",
    hosts: new Set(["instagram.com", "www.instagram.com"]),
    isHandle: (handle) => instagramHandle.test(handle),
    profileUrl: (handle) => `https://www.instagram.com/${handle}/`,
  },
  threads: {
    key: "스레드",
    hosts: new Set(["threads.net", "www.threads.net"]),
    isHandle: (handle) => instagramHandle.test(handle),
    profileUrl: (handle) => `https://www.threads.net/@${handle}`,
  },
  x: {
    key: "X",
    hosts: new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]),
    isHandle: (handle) => xHandle.test(handle),
    profileUrl: (handle) => `https://x.com/${handle}`,
  },
  tiktok: {
    key: "틱톡",
    hosts: new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]),
    isHandle: (handle) => tiktokHandle.test(handle),
    profileUrl: (handle) => `https://www.tiktok.com/@${handle}`,
  },
  github: {
    key: "GitHub",
    hosts: new Set(["github.com", "www.github.com"]),
    isHandle: isGitHubOwner,
    profileUrl: (handle) => `https://github.com/${handle}`,
  },
};

function validatedPostUrl(
  policy: PlatformPolicy,
  candidate: string | null,
): string | null {
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !policy.hosts.has(url.hostname.toLowerCase()) ||
      (url.pathname === "/" && !url.search)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function githubRepositoryUrl(repository: string | null): string | null {
  if (!repository) {
    return null;
  }
  const parts = repository.split("/");
  if (
    parts.length !== 2 ||
    !isGitHubOwner(parts[0] ?? "") ||
    !isGitHubRepository(parts[1] ?? "")
  ) {
    return null;
  }
  return `https://github.com/${parts[0]}/${parts[1]}`;
}

export function buildSourceMetadataEntry(
  candidate: SourceCandidate | null | undefined,
): { key: string; value: string } | null {
  if (!candidate || candidate.confidence < SOURCE_CONFIDENCE_THRESHOLD) {
    return null;
  }
  const policy = policies[candidate.platform];
  if (!policy) {
    return null;
  }
  const postUrl = validatedPostUrl(policy, candidate.postUrl);
  if (postUrl) {
    return { key: policy.key, value: postUrl };
  }
  if (candidate.platform === "github") {
    const repositoryUrl = githubRepositoryUrl(candidate.repository);
    if (repositoryUrl) {
      return { key: policy.key, value: repositoryUrl };
    }
  }
  const handle = candidate.handle?.replace(/^@/, "") ?? "";
  if (!policy.isHandle(handle)) {
    return null;
  }
  return { key: policy.key, value: policy.profileUrl(handle) };
}
